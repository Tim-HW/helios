#!/usr/bin/env bash
# Checks the hardening claims in SECURITY.md against a running container, so
# they stay claims that are tested rather than claims that were once true.
#
#   docker build -t helios:test . && tests/verify-container.sh
#
# Runs the image with the same flags as docker-compose.yml, asserts, tears down.
set -u
IMAGE=${1:-helios:test}
NAME=helios-verify
PORT=8099
B="http://127.0.0.1:$PORT"
pass=0; fail=0

docker rm -f "$NAME" >/dev/null 2>&1
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" --read-only \
  --tmpfs /tmp:uid=101,gid=101,mode=1777 \
  --tmpfs /var/cache/nginx:uid=101,gid=101,mode=0700 \
  --tmpfs /var/run:uid=101,gid=101,mode=0755 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 256m --pids-limit 128 "$IMAGE" >/dev/null || exit 1
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT
for _ in $(seq 40); do curl -sf -o /dev/null "$B/" && break; sleep 0.25; done

ck() { # ck <description> <expected> <actual>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  ok   %-46s %s\n' "$1" "$3"
  else fail=$((fail+1)); printf '  FAIL %-46s got %s, want %s\n' "$1" "$3" "$2"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
hdr()  { curl -sI "$B$1" | grep -i "^$2:" | sed "s/^[^:]*: //I" | tr -d '\r'; }

echo "reachable:"
ck "GET /"                200 "$(code $B/)"
ck "GET /src/main.js"     200 "$(code $B/src/main.js)"
ck "GET /vendor/three.module.js" 200 "$(code $B/vendor/three.module.js)"
ck "GET /CREDITS.md"      200 "$(code $B/CREDITS.md)"

echo "not reachable:"
ck "directory listing /src/"   404 "$(code $B/src/)"
ck "dotfile /.git/config"      404 "$(code $B/.git/config)"
ck "dev server /serve.py"      404 "$(code $B/serve.py)"
ck "test page /tests/smoke.html" 404 "$(code $B/tests/smoke.html)"
ck "probe endpoint /_probe/x"  404 "$(code $B/_probe/x)"
# assets/ used to hold 320 MB of source models excluded by .dockerignore; they
# were deleted from the repo instead. What matters now is the stronger property:
# nothing is served from assets/ that the app does not load, licences aside.
ck "no stray dir under assets/" 404 "$(code $B/assets/textures/)"
ck "assets/ is only what ships" "21" "$(docker exec $NAME sh -c 'find /usr/share/nginx/html/assets -type f | wc -l' | tr -d ' ')"
ck "/Dockerfile"               404 "$(code $B/Dockerfile)"
ck "traversal"                 400 "$(code --path-as-is "$B/../../etc/passwd")"

echo "no write path:"
# The stock nginx image compiles in the WebDAV module. It is not configured, but
# the method filter is what actually guarantees that, so test the DAV verbs too.
for m in POST PUT DELETE PATCH MKCOL COPY MOVE PROPFIND FROBNICATE; do
  ck "$m /" 405 "$(code -X $m -d x $B/)"
done
ck "POST /_probe/evil.html"    405 "$(code -X POST -d '<script>' $B/_probe/evil.html)"

echo "headers (must survive add_header inheritance):"
ck "CSP frame-ancestors none"  "yes" "$(hdr / Content-Security-Policy | grep -q "frame-ancestors 'none'" && echo yes || echo no)"
ck "X-Content-Type-Options"    "nosniff"     "$(hdr / X-Content-Type-Options)"
ck "Referrer-Policy"           "no-referrer" "$(hdr / Referrer-Policy)"
ck "COOP"                      "same-origin" "$(hdr / Cross-Origin-Opener-Policy)"
ck "CSP present on an asset"   "yes" "$([ -n "$(hdr /assets/textures/mercury.jpg Content-Security-Policy)" ] && echo yes || echo no)"
ck "CSP present on a 404"      "yes" "$([ -n "$(hdr /nope Content-Security-Policy)" ] && echo yes || echo no)"
ck "no version in Server"      "nginx" "$(hdr / Server)"

echo "mime (a types{} block would break these):"
ck "index.html"          "text/html; charset=utf-8"       "$(hdr /index.html Content-Type)"
ck "main.js"             "application/javascript; charset=utf-8" "$(hdr /src/main.js Content-Type)"
ck "CREDITS.md"          "text/markdown"                  "$(hdr /CREDITS.md Content-Type)"
ck "scene.gltf"          "model/gltf+json"                "$(hdr /assets/james-web/scene.gltf Content-Type)"
ck "ISS_stationary.glb"  "model/gltf-binary"              "$(hdr /assets/ISS_stationary.glb Content-Type)"

echo "redirects (Host header must not be reflected):"
loc() { curl -s -o /dev/null -D- -H 'Host: evil.example.com' "$B$1" | grep -i '^location:' | sed 's/^[^:]*: //I' | tr -d '\r'; }
ck "/src -> relative Location"    "/src/"    "$(loc /src)"
ck "/assets -> relative Location" "/assets/" "$(loc /assets)"
ck "internal port not leaked"     "no" "$(loc /src | grep -q 8080 && echo yes || echo no)"

echo "csp is not broader than the app needs:"
ck "blob: allowed for gltf textures" "yes" "$(hdr / Content-Security-Policy | grep -q "img-src 'self' data: blob:" && echo yes || echo no)"
ck "no worker-src (app has no Worker)" "no" "$(hdr / Content-Security-Policy | grep -q 'worker-src' && echo yes || echo no)"

echo "big model still serves correctly under limit_rate:"
ck "full download"     "44495916" "$(curl -s -o /dev/null -w '%{size_download}' $B/assets/ISS_stationary.glb)"
ck "range requests ok" "206" "$(code -H 'Range: bytes=0-99' $B/assets/ISS_stationary.glb)"

echo "no stray files from the base image:"
ck "50x.html not served"   404 "$(code $B/50x.html)"
ck "served root is 5 items" "5" "$(docker exec $NAME sh -c 'ls /usr/share/nginx/html | wc -l' | tr -d ' ')"

echo "no CORS grant (nothing here is meant to be read cross-origin):"
ck "no Access-Control-Allow-Origin" "" "$(hdr / Access-Control-Allow-Origin)"

echo "attribution required by CC-BY is actually in the shipped page:"
ck "JWST author credited" "yes" "$(curl -s $B/ | grep -q 'paul_sketch' && echo yes || echo no)"
ck "JWST source linked"   "yes" "$(curl -s $B/ | grep -q 'jwst-james-webb-space-telescope' && echo yes || echo no)"
ck "CC links are https"   "0"   "$(curl -s $B/ | grep -c 'http://creativecommons.org' | tr -d ' ')"

echo "malformed and hostile HTTP:"
# Raw sockets, because curl will not send most of these.
raw() { printf '%b' "$1" | timeout 4 python3 -c 'import socket,sys
d=sys.stdin.buffer.read()
s=socket.create_connection(("127.0.0.1",'"$PORT"'),timeout=3); s.sendall(d)
b=b""
while len(b)<400:
    try: c=s.recv(4096)
    except Exception: break
    if not c: break
    b+=c
sys.stdout.write((b.split(b"\r\n",1)[0].decode("latin1") or "CLOSED"))'; }
ck "HTTP/0.9 gets no headerless page" "CLOSED" "$(raw 'GET /\r\n')"
ck "HTTP/1.0 still served"     "HTTP/1.1 200 OK"  "$(raw 'GET / HTTP/1.0\r\n\r\n')"
ck "CL+TE smuggling refused"   "HTTP/1.1 400 Bad Request" "$(raw 'POST / HTTP/1.1\r\nHost: h\r\nContent-Length: 6\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n')"
ck "duplicate Host refused"    "HTTP/1.1 400 Bad Request" "$(raw 'GET / HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n')"
ck "duplicate Content-Length refused" "HTTP/1.1 400 Bad Request" "$(raw 'POST / HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nhello')"
ck "CRLF in path not injected" "HTTP/1.1 404 Not Found" "$(raw 'GET /a%0d%0aINJECTED:%201 HTTP/1.1\r\nHost: h\r\n\r\n')"
ck "NUL in path refused"       "HTTP/1.1 400 Bad Request" "$(raw 'GET /index.html%00.txt HTTP/1.1\r\nHost: h\r\n\r\n')"
ck "multi-range not assembled" "HTTP/1.1 200 OK" "$(raw 'GET /index.html HTTP/1.1\r\nHost: h\r\nRange: bytes=0-1,2-3,4-5,6-7,8-9\r\n\r\n')"
ck "single range still works"  "HTTP/1.1 206 Partial Content" "$(raw 'GET /index.html HTTP/1.1\r\nHost: h\r\nRange: bytes=0-99\r\n\r\n')"
ck "Host never reflected" "no" "$(curl -s -D- -o /dev/null -H 'Host: evil.example.com' $B/src | grep -q evil.example.com && echo yes || echo no)"

echo "caching:"
ck "code is not cached hard" "no-cache" "$(hdr /src/main.js Cache-Control)"
ck "assets are"  "public, max-age=2592000, immutable" "$(hdr /assets/textures/mercury.jpg Cache-Control)"

echo "container:"
ck "runs unprivileged"  "101"  "$(docker exec $NAME id -u)"
ck "rootfs read-only"   "true" "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' $NAME)"
ck "all caps dropped"   "[ALL]" "$(docker inspect -f '{{.HostConfig.CapDrop}}' $NAME)"
ck "cannot write root"  "1"    "$(docker exec $NAME sh -c 'touch /usr/share/nginx/html/x 2>/dev/null; echo $?')"
ck "no symlinks in served root" "0" "$(docker exec $NAME sh -c 'find /usr/share/nginx/html -type l | wc -l' | tr -d ' ')"
ck "nothing in root is writable"  "0" "$(docker exec $NAME sh -c 'find /usr/share/nginx/html -user nginx -o -perm -o+w | wc -l' | tr -d ' ')"
ck "base image pinned by digest"  "yes" "$(grep -q '^FROM .*@sha256:' Dockerfile && echo yes || echo no)"
ck "every source file 200" "0" "$(for f in $(docker exec $NAME sh -c 'cd /usr/share/nginx/html && find src vendor -type f'); do curl -s -o /dev/null -w '%{http_code}\n' "$B/$f"; done | grep -cv 200)"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
