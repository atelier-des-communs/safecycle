from collections import defaultdict
from typing import List, Dict


BIKE = "bike"
PATH = "path"
DANGER = "danger"
MEDIUM = "medium_traffic"
LOW = "low_traffic"

# Cost added to unsafe cost, for low traffic (1 is for MEDIUM)
UNSAFE_SCORE = {
    BIKE:0,
    PATH:0,
    DANGER:10,
    MEDIUM:1,
    LOW:0.1
}


class Coord :
    def __init__(self, lon:float, lat:float, elevation:float=None):
        self.lat = lat
        self.lon = lon
        self.elevation = elevation

class Path :
    def __init__(self):
        self.tags : Dict[str, str] = {}
        self.length = 0
        self.costs = dict()
        self.coords : List[Coord] = []

    def type(self):

        def tag_eq(key, value):
            return self.tags.get(key) == value

        def tag_in(key, values) :
            return self.tags.get(key) in values

        def tag(key) :
            return tag_eq(key, "yes")

        lanes = ["lane", "opposite", "opposite_lane", "track", "opposite_track", "share_busway", "share_lane"]

        isprotected = tag("bicycle_road") \
                 or tag_eq("bicycle", "designated") \
                 or tag_eq("highway", "cycleway") \
                 or tag_in("cycleway", lanes) \
                 or tag_in("cycleway:right", lanes) \
                 or tag_in("cycleway:left", lanes)

        isbike = isprotected or tag_in("bicycle", ["yes", "permissive"])
        ispaved = tag_in("surface", ["paved", "asphalt", "concrete", "paving_stones"])
        isunpaved = not (ispaved or tag_eq("surface", "") or tag_in("surface", ["fine_gravel", "cobblestone"]))
        probablyGood = ispaved or (not isunpaved and (isbike or tag_eq("highway", "footway")))

        if isprotected:
            return BIKE

        if tag_in("highway", ["track", "road", "path", "footway"]) and not probablyGood:
            return PATH

        if tag_in("highway", ["trunk", "trunk_link", "primary", "primary_link"]) :
            return DANGER

        if tag_in("highway", ["secondary", "secondary_link"]):
            return MEDIUM

        return LOW


    def slope(self):
        if len(self.coords) < 2 or self.length == 0:
            return 0
        if self.coords[-1].elevation is None or self.coords[0].elevation is None :
            return 0
        return (self.coords[-1].elevation - self.coords[0].elevation) / self.length * 100

    def __json__(self):
        return {
            **self.__dict__,
            "type": self.type(),
            "slope" : self.slope()}


class Itinerary:
    def __init__(self, time, length, cost):
        self.time = time
        self.profile = None
        self.alternative = None
        self.paths : List[Path] = []
        self.cost = cost
        self.length = length


    def shares(self):

        counts = defaultdict(lambda : 0)

        for path in self.paths:
            counts[path.type()] += path.length
        return dict((k, count/self.length) for k, count in counts.items())



    def unsafe_score(self):

        res = 0
        for path in self.paths:
            path_type = path.type()
            res += path.length * UNSAFE_SCORE[path_type]
        return res

    def __json__(self):
        return {**self.__dict__,
                "shares":self.shares(),
                "unsafe_score" : self.unsafe_score()}

