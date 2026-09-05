#!/usr/bin/env bash
# Supply-chain check for the vendored dependency.
#
# three.js is committed into vendor/ rather than installed, which is what makes
# the app work offline with no build step -- and also means nothing would notice
# if one of those files were altered. Every other check in this repo audits
# configuration written here; this one audits the ~2 MB of third-party code that
# everything else trusts implicitly.
#
#   tests/verify-vendor.sh              # offline: hashes must match the pins
#   tests/verify-vendor.sh --upstream   # also re-fetch npm and diff
#
set -u
cd "$(dirname "$0")/.."
VERSION=0.180.0            # three.js r180
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  ok   %s\n' "$1"
       else fail=$((fail+1)); printf '  FAIL %s\n       got  %s\n       want %s\n' "$1" "$3" "$2"; fi; }

# Pinned sha256 of the files as they are shipped. Verified byte-for-byte against
# https://unpkg.com/three@0.180.0/ on 2026-09-05; three of the four are
# identical to upstream, and GLTFLoader.js differs by exactly one line (below).
declare -A PIN=(
  [vendor/three.module.js]=c8211c69345d2e9949dc7a8ac969380497aa0600a5a8ac6a459c8cd02dd9cb8a
  [vendor/three.core.js]=eb077d2417f61d3e6d9264c317cabc4ea35769ed6b0ab533067292a550784c20
  [vendor/BufferGeometryUtils.js]=fda7e946b8e0b5ab39b779206589e7a1079a22eb24efb89d7223e03fdfb1f751
  [vendor/GLTFLoader.js]=adbbafe8ce40416525b6be0ee5cac0d3782482bcf0122c8ca8ec1ffa77d3440b
)

echo "pinned hashes (offline):"
for f in "${!PIN[@]}"; do
  ck "$f" "${PIN[$f]}" "$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)"
done

ck "three.js reports r180" "REVISION = '180'" \
   "$(grep -oE "REVISION = '[0-9]+'" vendor/three.core.js | head -1)"

if [ "${1:-}" = "--upstream" ]; then
  echo
  echo "against https://unpkg.com/three@$VERSION (network):"
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  declare -A SRC=(
    [vendor/three.module.js]=build/three.module.js
    [vendor/three.core.js]=build/three.core.js
    [vendor/GLTFLoader.js]=examples/jsm/loaders/GLTFLoader.js
    [vendor/BufferGeometryUtils.js]=examples/jsm/utils/BufferGeometryUtils.js
  )
  for f in "${!SRC[@]}"; do
    if ! curl -sfL -o "$tmp/$(basename "$f")" "https://unpkg.com/three@$VERSION/${SRC[$f]}"; then
      echo "  SKIP $f (fetch failed)"; continue
    fi
    d=$(diff "$tmp/$(basename "$f")" "$f" | grep -c '^[<>]')
    if [ "$f" = vendor/GLTFLoader.js ]; then
      # The one intentional modification. vendor/ is flat, so GLTFLoader's
      # sibling import has to be rewritten:
      #   -import { toTrianglesDrawMode } from '../utils/BufferGeometryUtils.js';
      #   +import { toTrianglesDrawMode } from './BufferGeometryUtils.js';
      # Anything beyond those two lines is undocumented and must be inspected.
      ck "$f: only the documented import-path change" "2" "$d"
      ck "$f: that change is the import line" "yes" \
         "$(diff "$tmp/GLTFLoader.js" "$f" | grep -c "toTrianglesDrawMode.*BufferGeometryUtils" | grep -q '^2$' && echo yes || echo no)"
    else
      ck "$f: identical to upstream" "0" "$d"
    fi
  done
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
