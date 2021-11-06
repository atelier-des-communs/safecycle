import json
from collections import defaultdict

import requests
from flask import Response
from hashlib import md5

from .cache import cache
from .config import Config
from .model import Itinerary, Path, Coord, UNSAFE
import haversine as hs
import re
import sys
from concurrent.futures import ThreadPoolExecutor

MAX_DISTANCE = 10

def debug(*args, **kwargs):
    if Config.FLASK_ENV == "development":

        if kwargs :
            for key, val in kwargs.items():
                args += "%s=%s" % (key, str(val)),

        print(*args)

def error(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def profile_fullname(profile_name) :
    if profile_name in Config.DEFAULT_PROFILES:
        profile = render_profile(profile_name)
        return "custom_" + profile_name + "_" + md5_hash(profile)
    return profile_name

def post_profile(profile_name) :

    profile = render_profile(profile_name)
    url = Config.BROUTER_ROOT + "/profile/" + profile_fullname(profile_name)
    res = requests.post(url, profile)

    if res.status_code != 200:
        debug("Upload failed !")
        raise HttpError(url, res.status_code, res.text)



def md5_hash(val) :
    return md5(val.encode("utf8")).hexdigest()


@cache.memoize()
def get_route(from_latlon, to_latlon, profile=None, alternative=0):

    f_lat, f_lon = from_latlon
    t_lat, t_lon = to_latlon

    params = "format=geojson" + \
        "&profile=%s" % profile_fullname(profile) + \
        "&lonlats=%f,%f|%f,%f" % (f_lon, f_lat, t_lon, t_lat)

    params += "&alternativeidx=%d" % alternative

    url = Config.BROUTER_ROOT + "?" + params



    res = requests.get(url)

    debug("Calling Brouter ", url, res.status_code)
    if res.status_code == 200:
        res = process_message(res.json())
        res.alternative = alternative
        res.profile = profile
        res.id = "%s-%d" %(profile,  alternative)
        return res
    else:
        raise HttpError(url, res.status_code, res.text)

def get_route_safe(from_latlon, to_latlon, profile=None, alternative=0) :

    try:
        return get_route(from_latlon, to_latlon, profile, alternative)
    except HttpError as ex:
        if ex.status == 500 and profile in Config.DEFAULT_PROFILES:
            # Missing profile => upload it and try again
            post_profile(profile)
            return get_route(from_latlon, to_latlon, profile, alternative)

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

    iti = Itinerary(time)

    def new_path() :
        path = Path()
        iti.paths.append(path)
        return path

    curr_path = new_path()
    message_it = iter(messages)
    curr_message = next(message_it)

    for coords in coordinates:
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

            try:
                curr_message = next(message_it)
            except StopIteration :
                break

            curr_path = new_path()
            curr_path.coords.append(coord)

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



def unsafe_distance(iti) :
    res = 0
    for path in iti.paths :
        if path.type() in UNSAFE :
            res += path.length

    return res



def not_worth(iti, other_iti) :
    """Return false if iti is almost similar or worse then other_iti for both KPI"""
    return iti.time > other_iti.time - Config.SIGNIFICANT_TIME_DIFF and unsafe_distance(iti) > unsafe_distance(other_iti) - Config.SIGNIFICANT_SAFE_DIFF

def same_itineraries(iti1, iti2) :
    if len(iti1.paths) != len(iti2.paths) :
        return False
    for path1, path2 in zip(iti1.paths, iti2.paths) :
        dist = hs.haversine(
            (path1.coords[0].lat, path1.coords[0].lon),
            (path2.coords[0].lat, path2.coords[0].lon))
        if dist > MAX_DISTANCE :
            return False
    return True


def purge_bad_itineraries(itis) :
    """Remove itineraries that are neither faster or safer than others"""
    winners = []

    for iti in itis :
        for other_iti in itis :
            if iti != other_iti and not_worth(iti, other_iti) :
                break
        else :
            winners.append(iti)
    res= []

    # Remove duplicates
    for winner in winners :
        for other in res :
            if same_itineraries(winner, other):
                break
        else:
            res.append(winner)
    return res


PARAM_PATTERN=r"^\s*assign\s+(\w+)\s*=\s*(\S+)\s*(#\s*%(\w+)%.*)$"

def valStr(val) :
    if isinstance(val, bool) :
        return "true" if val else "false"
    return str(val)

@cache.memoize()
def render_profile(profile_name, **overrides) :
    """Render profile file, replacing args with values"""
    params = {
        **Config.DEFAULT_PROFILES[profile_name],
        **overrides}

    debug("render_profile triggered for : %s" % profile_name, **params)

    res = ""
    with open("res/profile.txt", "r") as f:
        for line in f:
            match = re.match(PARAM_PATTERN, line)
            if match:
                vname, value, comment, pname = match.groups()
                if pname in params :
                    val = params[pname]
                    res += "assign %s = %s %s" % (vname, valStr(val), comment)
                    continue
            res += line
    return res

def get_all_itineraries(start, end, profile_type):

    profiles = ["route"] if profile_type == "route" else ["route", "vtt"]
    alternatives = range(1, 4)

    combinations = [(prof, alt) for prof in profiles for alt in alternatives]

    def process_fn(args):
        prof, alt = args
        return get_route_safe(start, end, prof, alt)

    # Execute in parallel
    with ThreadPoolExecutor(max_workers=4) as executor:
        itis = list(executor.map(process_fn, combinations))
        return purge_bad_itineraries(itis)


class NestedDefaultDict(defaultdict):
    def __init__(self, *args, **kwargs):
        super(NestedDefaultDict, self).__init__(NestedDefaultDict, *args, **kwargs)

    def __repr__(self):
        return repr(dict(self))











