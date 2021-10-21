#!/usr/bin/env python3
from flask import Flask, render_template, Response, request
import json

from lib.cache import cache
from lib.config import Config
from lib.utils import get_route, process_message, to_json, js_response, get_route_safe, hash_itinerary, HttpError

app = Flask(__name__)

app.config.update(Config.__dict__)

cache.init_app(app)

TO = (43.61531, 7.052784)
FROM  = (43.623687, 7.013062)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/itineraries")
def get_itineraries():

    iti_by_hash = {}

    start = list(map(lambda s: float(s), request.args["start"].split(",")))
    end = list(map(lambda s: float(s), request.args["end"].split(",")))
    profile = request.args["profile"]

    try:
        for alternative in range(1, 4):
            iti = get_route_safe(start, end, profile, alternative)
            iti.id = "%s-%d" %(profile,  alternative)
            iti_by_hash[hash_itinerary(iti)] = iti

        unique_itis = list(iti_by_hash.values())

        return js_response(unique_itis)

    except HttpError as e:
        if e.status == 400:
            return "No itinerary found", 400


if __name__ == '__main__':
    app.run()

    #res = get_route(from_latlon, to_latlon, "safety")

    #print(dumps(res, indent=2))

    #with open("res/itinerary.json") as f :
    #    iti = process_message(json.load(f))
    #    print(to_json(iti))
    #    print("nb Paths", len(iti.paths))
    #    print("nb Coords", sum(len(path.coords) for path in iti.paths))
