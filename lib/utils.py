import json
from collections import defaultdict

import requests
from flask import Response
from hashlib import md5

from .cache import cache
from .config import Config
from .model import Itinerary, Path, Coord


import re
import sys
from concurrent.futures import ThreadPoolExecutor

MAX_DISTANCE = 10

EQUAL="equal"
BETTER="better"
WORSE="worse"

def debug(*args, **kwargs):
    if Config.FLASK_ENV == "development":

        if kwargs :
            for key, val in kwargs.items():
                args += "%s=%s" % (key, str(val)),

        print(*args)

def error(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def profile_fullname(profile_name, **params) :
    if profile_name in Config.DEFAULT_PROFILES:
        profile = render_profile(profile_name, **params)
        return "custom_" + profile_name + "_" + md5_hash(profile)
    return profile_name

def post_profile(profile_name, **params) :

    profile = render_profile(profile_name, **params)
    url = Config.BROUTER_ROOT + "/profile/" + profile_fullname(profile_name, **params)
    res = requests.post(url, profile)

    if res.status_code != 200:
        debug("Upload failed !")
        raise HttpError(url, res.status_code, res.text)

    error = res.json().get("error", None)
    if error:
        raise Exception("Error in profile %s :\n%s" %(profile_name, error))



def md5_hash(val) :
    return md5(val.encode("utf8")).hexdigest()


@cache.memoize()
def get_route(from_latlon, to_latlon, profile, fullname, alternative=0):

    f_lat, f_lon = from_latlon
    t_lat, t_lon = to_latlon

    params = "format=geojson" + \
        "&profile=%s" % fullname + \
        "&lonlats=%f,%f|%f,%f" % (f_lon, f_lat, t_lon, t_lat)

    params += "&alternativeidx=%d" % alternative

    url = Config.BROUTER_ROOT + "?" + params

    res = requests.get(url)

    debug("Calling Brouter ", url, res.status_code)
    if res.status_code == 200:

        #debug(json.dumps(res.json(), indent=2))

        res = process_message(res.json())
        res.alternative = alternative
        res.profile = profile
        res.id = "%s-%d" %(profile,  alternative)
        return res
    else:
        raise HttpError(url, res.status_code, res.text)


def get_route_safe(from_latlon, to_latlon, profile, alternative=0, **params):

    fullname = profile_fullname(profile, **params)

    try:
        return get_route(from_latlon, to_latlon, profile, fullname, alternative)
    except HttpError as ex:
        if ex.status == 500 and profile in Config.DEFAULT_PROFILES:
            # Missing profile => upload it and try again
            post_profile(profile, **params)
            return get_route(from_latlon, to_latlon, profile, fullname, alternative)

        # Other error
        raise ex


def process_message(js) :

    features = js["features"][0]
    props = features["properties"]
    messages = props["messages"]
    coordinates = features["geometry"]["coordinates"]
    header = messages.pop(0)
    messages = list(dict((k, v) for k, v in zip(header, message)) for message in messages)

    time = int(props["total-time"])
    cost = int(props["cost"])
    length = int(props["track-length"])

    iti = Itinerary(time, length, cost)

    def new_path() :
        path = Path()
        iti.paths.append(path)
        return path

    curr_path = new_path()
    message_it = iter(messages)
    curr_message = next(message_it)

    for i_coord, coords in enumerate(coordinates):
        lon, lat, height = coords

        lon_str = str(int(lon * 1000000))
        lat_str = str(int(lat * 1000000))

        coord = Coord(lon, lat, height)

        curr_path.coords.append(coord)

        if curr_message is not None and lat_str == curr_message["Latitude"] and lon_str == curr_message["Longitude"]:
            # Match : update properties !
            for tag in curr_message["WayTags"].split(" ") :
                k, v = tag.split("=")
                curr_path.tags[k] = v

            curr_path.length = int(curr_message["Distance"])
            for key, name in dict(CostPerKm="per_km", ElevCost="elevation", TurnCost="turn", NodeCost="node", InitialCost="initial").items() :
                curr_path.costs[name] = float(curr_message[key])

            try:
                curr_message = next(message_it)
                curr_path = new_path()
                curr_path.coords.append(coord)
            except StopIteration :

                if i_coord < len(coordinates) - 1:
                    error("There was still coordinates!")
                break
    try:
        next(message_it)
        debug("There was still messages")
    except:
        pass


    return iti


class HttpError(Exception) :

    def __init__(self, url, status, text) :
        self.status = status
        Exception.__init__(self, "Http error %d on '%s' :\n%s" % (status, url, text))


def to_json(obj):

    def default_fn(obj) :
        if hasattr(obj, "__json__"):
            return obj.__json__()
        return obj.__dict__

    return json.dumps(obj, default=default_fn, indent=2)


def js_response(obj):
    return Response(to_json(obj), mimetype="application/json")



def compare(cost1, cost2, min_diff) :
    """Compare costs"""
    if abs(cost1-cost2) < min_diff :
        return EQUAL
    if cost1 > cost2 :
        return WORSE
    else:
        return BETTER





def check_kpis(iti : Itinerary, other_iti: Itinerary, status) :
    """Return true if iti is equal or worse than other_iti for both KPI"""

    res = compare(iti.time, other_iti.time, Config.SIGNIFICANT_TIME_DIFF) == status \
            and compare(iti.unsafe_score(), other_iti.unsafe_score(), Config.SIGNIFICANT_SAFE_DIFF) in status
    debug(
        iti1=iti.id, iti2=other_iti.id,
        iti1_time=iti.time, iti2_time=other_iti.time,
        iti1_unsafe=iti.unsafe_score(), iti2_unsafe=other_iti.unsafe_score(),
        status=status,
        res=res)
    return res




def purge_bad_itineraries(itis) :
    """Remove itineraries that are neither faster or safer than others"""
    res = []

    for iti in itis :
        for other_iti in itis :
            if iti != other_iti and check_kpis(iti, other_iti, WORSE):
                break
        else :
            # iti was better than at least one other itinerary, for one KPI (time or safety) : worth keeping
            res.append(iti)
    debug("Purge bad itis. Before:%d. After:%d" % (len(itis), len(res)))
    return res


def purge_doublons(itis) :
    res = []
    for iti in itis :
        for other in res :
            if check_kpis(iti, other, EQUAL):
                break
        else:
            # No same itineraries yet
            res.append(iti)
    debug("Purge doublons. Before:%d. After:%d" % (len(itis), len(res)))
    return res


PARAM_PATTERN=r"^\s*assign\s+(\w+)\s*=\s*(\S+)\s*(#\s*%(\w+)%.*)$"

def valStr(val) :
    if isinstance(val, bool) :
        return "true" if val else "false"
    return str(val)

@cache.memoize()
def render_profile(profile_name, **params_overrides) :
    """Render profile file, replacing args with values"""
    params = {
        **Config.DEFAULT_PROFILES[profile_name],
        **params_overrides}

    res = ""
    with open("res/profile.txt", "r") as f:
        for line in f:
            match = re.match(PARAM_PATTERN, line)
            if match:
                vname, value, comment, pname = match.groups()
                if pname in params :
                    val = params[pname]
                    res += "assign %s = %s %s\n" % (vname, valStr(val), comment)
                    continue
            res += line

    debug("render_profile triggered for : %s" % profile_name, **params)
    #debug("\nProfile:\n", res)
    return res

def get_all_itineraries(start, end, best_only=False,  **params):

    profiles = ["fast", "medium", "safe"]
    alternatives = [1, 2, 3]

    combinations = [(prof, alt) for prof in profiles for alt in alternatives]

    def process_fn(args):
        prof, alt = args
        return get_route_safe(start, end, prof, alt, **params)

    # Execute in parallel
    with ThreadPoolExecutor(max_workers=4) as executor:
        itis = list(executor.map(process_fn, combinations))

    if best_only:
        itis = purge_bad_itineraries(itis)
        itis = purge_doublons(itis)

    return itis



class NestedDefaultDict(defaultdict):
    def __init__(self, *args, **kwargs):
        super(NestedDefaultDict, self).__init__(NestedDefaultDict, *args, **kwargs)

    def __repr__(self):
        return repr(dict(self))


def str2bool(val) :
    if val is None :
        return False
    return val.lower() in ["1", "true", "yes"]








