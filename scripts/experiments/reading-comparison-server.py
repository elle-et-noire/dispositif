"""Serve one captured production build under Astro's /dispositif/ base.
Usage: python3 scripts/experiments/reading-comparison-server.py PORT BUILD_DIR
Bind only to localhost; run one server per comparison mode.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
import sys


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/dispositif/'):
            path = path[len('/dispositif'):]
        return super().translate_path(path)


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])),
                        partial(Handler, directory=sys.argv[2])).serve_forever()
