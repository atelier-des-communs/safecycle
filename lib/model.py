from collections import defaultdict
from typing import List, Dict


BIKE = "bike"
PATH = "path"
DANGER = "danger"
MEDIUM = "medium_traffic"
LOW = "low_traffic"

UNSAFE = [DANGER, MEDIUM]

class Coord :
    def __init__(self, lon:float, lat:float, elevation:float=None):
        self.lat = lat
        self.lon = lon
        self.elevation = elevation

class Path :
    def __init__(self):
        self.tags : Dict[str, str] = {}
        self.length = 0
        self.coords : List[Coord] = []

    def type(self):

        def tag_eq(key, value):
            return self.tags.get(key) == value

        def tag_in(key, values) :
            return self.tags.get(key) in values

        def tag(key) :
            return tag_eq(key, "yes")

        isbike = tag("bicycle_road") \
                 or tag_in("bicycle", ["yes", "permissive", "designated"]) \
                 or tag("lcn") \
                 or tag_eq("highway", "cycleway")
        ispaved = tag_in("surface", ["paved", "asphalt", "concrete", "paving_stones"])
        isunpaved = not (ispaved or tag_eq("surface", "") or tag_in("surface", ["fine_gravel", "cobblestone"]))
        probablyGood = ispaved or (not isunpaved and (isbike or tag_eq("highway", "footway")))

        if isbike :
            return BIKE

        if tag_in("highway", ["track", "road", "path", "footway"]) and not probablyGood :
            return PATH

        if tag_in("highway", ["trunk", "trunk_link", "primary", "primary_link"]) :
            return DANGER

        if tag_in("highway", ["secondary", "secondary_link"]):
            return MEDIUM

        return LOW


    def slope(self):
        if len(self.coords) < 2 or self.length == 0:
            return 0
        return (self.coords[-1].elevation - self.coords[0].elevation) / self.length * 100

    def __json__(self):
        return {
            **self.__dict__,
            "type": self.type(),
            "slope" : self.slope()}


class Itinerary:
    def __init__(self, time):
        self.time = time
        self.profile = None
        self.alternative = None
        self.paths : List[Path] = []

    def shares(self):

        counts = defaultdict(lambda : 0)
        length = self.length()

        for path in self.paths :
            counts[path.type()] += path.length
        return dict((k, count/length) for k, count in counts.items())

    def length(self):
        return sum(path.length for path in self.paths)

    def __json__(self):
        return {**self.__dict__,
                "shares":self.shares(),
                "length":self.length()}

