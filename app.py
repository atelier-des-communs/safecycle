#!/usr/bin/env python3
from flask import Flask, render_template, Response, request
import json

from lib.cache import cache
from lib.config import Config
from lib.utils import *

from flask_compress import Compress

app = Flask(__name__)

app.config.update(Config.__dict__)

cache.init_app(app)

Compress(app)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/api/itineraries")
def get_itineraries():

    start = list(map(lambda s: float(s), request.args["start"].split(",")))
    end = list(map(lambda s: float(s), request.args["end"].split(",")))
    prof = request.args["profile"]

    try :
        itis = get_all_itineraries(start, end, prof)
    except HttpError as e:
        if e.status == 400:
            return "No itinerary found", 400
        error("Error happened", e)

    car_distance = None
    try :
        car_iti = get_route_safe(start, end, "car-fast", 1)
        car_distance = car_iti.length()
    except:
        pass

    return js_response(dict(
        itineraries=itis,
        car_distance=car_distance))

@app.route("/api/gpx")
def gpx() :

    start = list(map(lambda s: float(s), request.args["start"].split(",")))
    end = list(map(lambda s: float(s), request.args["end"].split(",")))
    profile = request.args["profile"]
    alternative = int(request.args["alt"])

    iti = get_route_safe(start, end, profile, alternative)

    points = []
    for path in iti.paths :
        points += path.coords[0:-1]
    points.append(iti.paths[-1].coords[-1])

    out = render_template("route.xml", points=points)

    return Response(
        out,
        mimetype="application/gpx+xml",
        headers={'Content-Disposition' : 'attachment;filename=route.gpx'})


if __name__ == '__main__':
    app.run()

    #res = get_route(from_latlon, to_latlon, "safety")

    #print(dumps(res, indent=2))

    #with open("res/itinerary.json") as f :
    #    iti = process_message(json.load(f))
    #    print(to_json(iti))
    #    print("nb Paths", len(iti.paths))
    #    print("nb Coords", sum(len(path.coords) for path in iti.paths))
