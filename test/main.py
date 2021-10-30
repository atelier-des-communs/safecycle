import sys, os
sys.path.append(os.getcwd())

from lib.utils import render_profile

def test_render_profile():
    print(render_profile(mountainBike=True))

if __name__ == '__main__':
    test_render_profile()