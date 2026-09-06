"""USGS global mosaic -> a surface map the app can use.

Three steps, each of which is a choice worth stating:

  1. Resize to 2048x1024. These products are already simple-cylindrical
     (lon/lat), so a straight resize IS the reprojection.

  2. Fill no-data. The mosaics have gaps where no spacecraft imaged the
     surface -- 3-4% for the Galileans, mostly polar. Left alone they are pure
     black and read as dark terrain, which is a lie of a worse kind than a
     procedural guess. They are filled by repeated blur-and-composite, so the
     gap takes the tone of what surrounds it and reads as nothing in
     particular.

  3. Tint. The Voyager/Galileo mosaics are single-band greyscale; these moons
     are not grey. The luminance is multiplied by the body's documented colour,
     normalised so overall brightness is unchanged. That colours the map without
     inventing any detail -- every feature is still the real one.
"""
import sys, os
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None

src, dst, hexcol = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else None)
im = Image.open(src)
w, h = im.size
im = im.convert('L').resize((2048, 1024), Image.LANCZOS)

# Normalised convolution. Blurring an image that still contains the hole just
# spreads the hole's blackness into it; the fix is to blur only the VALID
# pixels and divide by the blurred coverage, so the gap takes the average of
# what actually surrounds it rather than an average that includes itself.
hole  = im.point(lambda v: 255 if v <= 4 else 0)      # 255 inside a gap
valid = im.point(lambda v: 0 if v <= 4 else 255)
gaps  = sum(hole.histogram()[255:])
filled = im
for radius in (8, 24, 64, 160):
    num = Image.merge('RGB', (filled, filled, filled)).convert('L')
    num = Image.composite(filled, Image.new('L', filled.size, 0), valid)
    num = num.filter(ImageFilter.GaussianBlur(radius))
    den = valid.filter(ImageFilter.GaussianBlur(radius))
    npx, dpx, fpx, hpx = num.load(), den.load(), filled.load(), hole.load()
    W, H = filled.size
    for y in range(H):
        for x in range(W):
            if hpx[x, y] and dpx[x, y] > 2:
                fpx[x, y] = min(255, int(npx[x, y] * 255 / dpx[x, y]))
    # anything now filled counts as valid for the next, wider pass
    valid = filled.point(lambda v: 0 if v <= 4 else 255)
    hole = filled.point(lambda v: 255 if v <= 4 else 0)
    if sum(hole.histogram()[255:]) == 0: break
out = filled

if hexcol:
    r, g, b = (int(hexcol[i:i+2], 16) for i in (1, 3, 5))
    lum = (0.2126*r + 0.7152*g + 0.0722*b) or 1
    # Pulled two-thirds of the way toward the body's colour, not all of it.
    # A full-strength tint drives one channel to nearly zero and the map stops
    # looking like a photograph and starts looking like a colour filter.
    T = 0.65
    sr, sg, sb = (1 - T + T*r/lum, 1 - T + T*g/lum, 1 - T + T*b/lum)
    out = Image.merge('RGB', (
        out.point(lambda v: min(255, int(v*sr))),
        out.point(lambda v: min(255, int(v*sg))),
        out.point(lambda v: min(255, int(v*sb)))))
else:
    out = out.convert('RGB')

out.save(dst, 'JPEG', quality=90, optimize=True, progressive=True)
print(f'  {os.path.basename(src):16} {w}x{h} -> 2048x1024   '
      f'no-data {100*gaps/(2048*1024):.2f}% filled   {os.path.getsize(dst)/1024:.0f} KB')
