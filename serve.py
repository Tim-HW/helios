#!/usr/bin/env python3
"""Dev server for Helios. NOT for public exposure — see SECURITY.md.

Plain `python3 -m http.server` lets the browser cache modules, which in a
project with no build step is actively harmful: you edit a file, reload, and get
a mix of old and new modules. That failure is vicious because it is silent and
selective -- a stale noise.js, for instance, breaks only the shaders that call
the functions it is missing, so some planets keep rendering perfectly while
others quietly disappear.

So: tell the browser to store nothing.
"""

import base64
import binascii
import os
import pathlib
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


PROBE_ENABLED = os.environ.get('HELIOS_PROBE') == '1'


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Probes POST their results here instead of relying on a screenshot.
    #
    # Headless Firefox takes its screenshot on the load event, which races any
    # asynchronous work and silently captures a half-finished page. Letting the
    # page hand its results back removes the race.
    #
    # This writes files to disk on an unauthenticated request, and this same
    # server then serves that directory — so anything uploaded is served back
    # from this origin. On a public host that is stored XSS plus a way to fill
    # the disk. It is therefore OFF unless HELIOS_PROBE=1 is set, and the server
    # binds to localhost unless told otherwise.
    def do_POST(self):
        if not PROBE_ENABLED:
            self.send_error(403, 'probe endpoint disabled')
            return
        if not self.path.startswith('/_probe/'):
            self.send_error(404)
            return
        name = os.path.basename(self.path[len('/_probe/'):]) or 'out.txt'
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', name) or name.startswith('.'):
            self.send_error(400, 'bad probe name')
            return
        # A negative Content-Length made rfile.read(-1) read to EOF, which walked
        # straight past the size cap it was there to enforce; a non-numeric one
        # raised ValueError and answered with a traceback.
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self.send_error(400, 'bad content length')
            return
        if not 0 <= length <= 32 * 1024 * 1024:
            self.send_error(413, 'probe payload too large')
            return
        body = self.rfile.read(length)
        out = pathlib.Path('.probe')
        out.mkdir(exist_ok=True)
        if body.startswith(b'data:image/png;base64,'):
            try:
                body = base64.b64decode(body[len(b'data:image/png;base64,'):],
                                        validate=True)
            except binascii.Error:
                self.send_error(400, 'bad base64 payload')
                return
        (out / name).write_bytes(body)
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '200' not in (args[1] if len(args) > 1 else ''):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # Loopback by default. This server has no rate limiting, no timeouts and no
    # security headers, and Python's own documentation says SimpleHTTPRequestHandler
    # is not for production. Binding to every interface by accident is how a dev
    # server ends up on the internet.
    host = os.environ.get('HELIOS_HOST', '127.0.0.1')
    print(f'Helios running at http://{host}:{port}  (caching disabled'
          + (', probe endpoint ENABLED' if PROBE_ENABLED else '') + ')')
    if host not in ('127.0.0.1', 'localhost', '::1'):
        print('  ! bound beyond loopback — this is a development server, '
              'not something to expose. See SECURITY.md.')
    ThreadingHTTPServer((host, port), partial(NoCacheHandler)).serve_forever()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
