# Helios is a static site. There is no build step and nothing to compile, so the
# image is just the files plus a real web server — deliberately NOT the Python
# dev server in this repo, which exists for development and says so.

# Pinned by digest, not just by tag: `nginx:1.27-alpine` is a moving target, so
# a tag-only build is not the image that was audited. Bump both together.
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

# Drop the stock config so nothing is served that we did not ask for.
RUN rm -f /etc/nginx/conf.d/*.conf
COPY docker/nginx.conf /etc/nginx/conf.d/helios.conf

WORKDIR /usr/share/nginx/html
# The base image ships its own index.html and 50x.html here. Ours replaces the
# first; the second would otherwise be served as a page we did not write.
RUN rm -f /usr/share/nginx/html/*
COPY index.html CREDITS.md ./
COPY src/    ./src/
COPY vendor/ ./vendor/
COPY assets/ ./assets/

# nginx:alpine already runs workers as the unprivileged `nginx` user; listening
# on 8080 rather than 80 means the master does not need root either.
USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
