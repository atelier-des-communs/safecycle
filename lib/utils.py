import json

import requests
from flask import Response
from hashlib import md5

from .cache import cache
from .config import Config
from .model import Itinerary, Path, Coord

def profile_fullname(profile) :
    if profile in Config.PROFILES :
        return "custom_" + profile + Config.APP_ID
    return profile

def post_profile(profile) :
    url = Config.BROUTER_ROOT + "/profile/" + profile_fullname(profile)
    res = requests.post(url, Config.PROFILES[profile])
    print("Posted", url, res)
    if res.status_code != 200:
        raise HttpError(url, res.status_code, res.text)


@cache.memoize()
def get_route(from_latlon, to_latlon, profile=None, alternative=0) :

    f_lat, f_lon = from_latlon
    t_lat, t_lon = to_latlon

    params = "format=geojson" + \
        "&profile=%s" % profile_fullname(profile) + \
        "&lonlats=%f,%f|%f,%f" % (f_lon, f_lat, t_lon, t_lat)

    params += "&alternativeidx=%d" % alternative

    url = Config.BROUTER_ROOT + "?" + params

    res = requests.get(url)
    if res.status_code == 200:
        return process_message(res.json())
    else :
        raise HttpError(url, res.status_code, res.text)

def get_route_safe(from_latlon, to_latlon, profile=None, alternative=0) :

    try :
        return get_route(from_latlon, to_latlon, profile, alternative)
    except HttpError as ex:
        if ex.status == 500 and profile in Config.PROFILES:
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

        coord = Coord(lon, lat)
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


def hash_itinerary(itinerary: Itinerary):
    val = ""
    for path in itinerary.paths:
        coord = path.coords[0]
        val += "%f:%f" % (coord.lat, coord.lon)
    return md5(val.encode("utf-8"))


