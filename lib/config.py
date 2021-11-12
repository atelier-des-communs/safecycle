import dotenv, os
import json

dotenv.load_dotenv()

def env(key, default=None):
    res = os.environ.get(key, default)
    if res is None :
        raise Exception("Missing env :", key)
    return res

def load_js(path) :
    with open(path, "r") as f:
        return json.load(f)


class Config:

    FLASK_ENV = env("FLASK_ENV")

    BROUTER_ROOT="http://brouter.de/brouter"

    CACHE_TYPE="SimpleCache"  # Flask-Caching related configs

    CACHE_DEFAULT_TIMEOUT = int(env("CACHE_DEFAULT_TIMEOUT", 24*3600))

    STATIC_CACHE_TIMOUT = int(env("STATIC_CACHE_TIMOUT", 24 * 3600))

    # In seconds
    SIGNIFICANT_TIME_DIFF = int(env("RELEVANT_TIME_DIFF", 60))

    # Difference in lowe than this in unsafe distance will be considered identic
    SIGNIFICANT_SAFE_DIFF = int(env("RELEVANT_SAFE_DIFF", 100))


    LANGUAGES= env("LANGUAGES", "fr,en").split(",")



    DEFAULT_PROFILES = load_js("res/default_profiles.json")

    # Secret key for session : anything
    SECRET_KEY = env("SECRET_KEY")

    # Initial center : lat,lon
    CENTER = list(map(lambda x : float(x), env("CENTER").split(",")))

    # Inititial zoom
    INIT_ZOOM = int(env("INIT_ZOOM", 14))

    # Country to search for adresses
    COUNTRY=env("COUNTRY", "")

