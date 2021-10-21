
def load_profile(profile) :
    with open("res/profile-%s.txt" % profile, "r") as f:
        return f.read()

class Config:
    BROUTER_ROOT="http://brouter.de/brouter"
    PROFILES = dict(
        route=load_profile("route"),
        vtt=load_profile("vtt"))

    # Unique ID, public to prevent collisions
    APP_ID="FOOBAR23"
    CACHE_TYPE="SimpleCache"  # Flask-Caching related configs
    CACHE_DEFAULT_TIMEOUT=24*3600

