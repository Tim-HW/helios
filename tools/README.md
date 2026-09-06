# tools

One-off scripts, not part of the app and not in the image.

## Turning a model's cube-map atlas into an equirectangular map

Several planet models pack their surface as a **cube-map cross** — a 4x3 grid of
square faces — which fits only the mesh it shipped with, not the sphere Helios
generates. That is why those textures went unused for a long time.

Two scripts convert one:

```sh
# extract the embedded textures from a .glb first, then:
python3 tools/cubemap-to-equirect.py  model.glb atlas.png base.png  2048
python3 tools/mesh-to-equirect.py     model.glb atlas.png out.png   2048 base.png
```

`mesh-to-equirect.py` is the accurate one: it rasterises the model's own
triangles into longitude/latitude and interpolates their UVs, so the atlas
layout is never assumed — the result is exactly the mapping the model uses.
Triangles crossing the ±180° seam are drawn twice, shifted, so the wrap is
seamless.

It leaves roughly 3-4% of pixels uncovered, all at the poles, where triangles
span the pole itself and the seam rule mishandles them.
`cubemap-to-equirect.py` fills those: it derives each cube face's placement in
the atlas by least-squares fitting the model's UVs, then samples bilinearly, so
it has no gaps. Run it first to make the base, then composite the rasteriser
over it.

Needs Pillow. No numpy — the rasteriser is pure Python and takes about two
seconds for a 3,000-triangle model at 2048x1024.

## Turning a USGS global mosaic into a surface map

```sh
python3 tools/usgs-mosaic-to-map.py Io.tif io.jpg '#d6c85a'
```

Downloads from <https://planetarymaps.usgs.gov/mosaic/> are simple-cylindrical
GeoTIFFs of 60-190 MB, so a straight resize to 2048x1024 *is* the reprojection.
The script also fills the no-data gaps and tints the greyscale toward the body's
colour; `CREDITS.md` explains why both are done and what they do not change.
