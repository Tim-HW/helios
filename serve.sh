#!/usr/bin/env bash
# ES modules need a real HTTP origin; opening index.html over file:// will not
# work. No build step, no dependencies to install -- just serve the folder.
#
# Uses serve.py rather than `python3 -m http.server` so the browser is told not
# to cache: with no bundler, a half-stale set of modules is a real and very
# confusing failure mode.
cd "$(dirname "$0")"
# The probe endpoint writes files to disk on an unauthenticated request, and
# this same server then serves that directory back. Defaulting it to 1 here
# quietly undid the safe default in serve.py, so it is off unless asked for:
#
#   HELIOS_PROBE=1 ./serve.sh        # only when running the browser probes
#
exec python3 serve.py "${1:-8000}"
