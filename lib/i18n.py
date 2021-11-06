from collections import defaultdict
from csv import DictReader

from lib.cache import cache
from flask import request, session

from lib.config import Config
from lib.utils import NestedDefaultDict, debug


@cache.memoize()
def _messages(lang):
    res = NestedDefaultDict()

    with open("i18n/languages.csv") as f :
        csv = DictReader(f, delimiter=";")
        for row in csv :
            keys = row["key"].split(".")
            val = row[lang]

            # Loop though nested keys
            dic=res
            for key in keys[:-1] :
                dic=dic[key]
            dic[keys[-1]] = val

    debug(messages=res)
    return res

def set_lang(lang) :
    session['language'] = lang

def get_lang():
    try:
        return session['language']
    except KeyError:
        return request.accept_languages.best_match(Config.LANGUAGES)

def messages():
    return _messages(get_lang())