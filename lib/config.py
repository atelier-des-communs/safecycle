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
    BROUTER_ROOT="http://brouter.de/brouter"

    CACHE_TYPE="SimpleCache"  # Flask-Caching related configs

    CACHE_DEFAULT_TIMEOUT = 24*3600

    FLASK_ENV = env("FLASK_ENV")

    DEFAULT_PROFILES = load_js("res/default_profiles.json")

