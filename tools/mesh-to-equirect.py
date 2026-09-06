"""Cube atlas -> equirectangular by rasterising the mesh itself.

No fitting and no assumption about the atlas layout: each triangle is drawn into
lon/lat space and its UVs are interpolated barycentrically, so the result is
exactly the mapping the model uses. Triangles that straddle the +/-180 seam are
drawn twice, shifted, so the wrap is seamless.
"""
import json, struct, math, sys
from PIL import Image

GLB, ATLAS, OUT, W = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
BASE = sys.argv[5] if len(sys.argv) > 5 else None
H = W // 2

f = open(GLB, 'rb'); f.read(12)
clen, _ = struct.unpack('<II', f.read(8))
j = json.loads(f.read(clen).decode())
blen, _ = struct.unpack('<II', f.read(8))
buf = f.read(blen)

def read(i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = {'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
    fmt = {5126:'f', 5123:'H', 5125:'I'}[a['componentType']]
    stride = bv.get('byteStride') or n*struct.calcsize(fmt)
    return [struct.unpack_from('<'+fmt*n, buf, off+k*stride) for k in range(a['count'])]

prim = j['meshes'][0]['primitives'][0]
pos  = read(prim['attributes']['POSITION'])
uv   = read(prim['attributes']['TEXCOORD_0'])
idx  = [i[0] for i in read(prim['indices'])]

src = Image.open(ATLAS).convert('RGB'); SW, SH = src.size; sp = src.load()
out = (Image.open(BASE).convert('RGB').resize((W, H), Image.LANCZOS)
       if BASE else Image.new('RGB', (W, H)))
op = out.load()
covered = bytearray(W*H)

pts = []
for (x, y, z) in pos:
    n = math.sqrt(x*x + y*y + z*z) or 1.0
    x, y, z = x/n, y/n, z/n
    lon = math.atan2(x, z); lat = math.asin(max(-1.0, min(1.0, y)))
    pts.append(((lon/(2*math.pi) + 0.5)*W, (0.5 - lat/math.pi)*H))

def draw(p0, p1, p2, t0, t1, t2):
    minx = max(0, int(math.floor(min(p0[0], p1[0], p2[0]))))
    maxx = min(W-1, int(math.ceil(max(p0[0], p1[0], p2[0]))))
    miny = max(0, int(math.floor(min(p0[1], p1[1], p2[1]))))
    maxy = min(H-1, int(math.ceil(max(p0[1], p1[1], p2[1]))))
    if minx > maxx or miny > maxy: return
    d = (p1[1]-p2[1])*(p0[0]-p2[0]) + (p2[0]-p1[0])*(p0[1]-p2[1])
    if abs(d) < 1e-12: return
    for yy in range(miny, maxy+1):
        py = yy + 0.5
        row = yy*W
        for xx in range(minx, maxx+1):
            px = xx + 0.5
            a = ((p1[1]-p2[1])*(px-p2[0]) + (p2[0]-p1[0])*(py-p2[1])) / d
            if a < -0.001: continue
            b = ((p2[1]-p0[1])*(px-p2[0]) + (p0[0]-p2[0])*(py-p2[1])) / d
            if b < -0.001: continue
            c = 1.0 - a - b
            if c < -0.001: continue
            u = a*t0[0] + b*t1[0] + c*t2[0]
            v = a*t0[1] + b*t1[1] + c*t2[1]
            sx = int(u*SW); sy = int(v*SH)
            if sx < 0: sx = 0
            elif sx >= SW: sx = SW-1
            if sy < 0: sy = 0
            elif sy >= SH: sy = SH-1
            op[xx, yy] = sp[sx, sy]
            covered[row+xx] = 1

for k in range(0, len(idx), 3):
    i0, i1, i2 = idx[k], idx[k+1], idx[k+2]
    p = [list(pts[i0]), list(pts[i1]), list(pts[i2])]
    t = [uv[i0], uv[i1], uv[i2]]
    xs = [q[0] for q in p]
    if max(xs) - min(xs) > W/2:                       # straddles the seam
        shifted = [[q[0] + (W if q[0] < W/2 else 0), q[1]] for q in p]
        draw(shifted[0], shifted[1], shifted[2], *t)
        back = [[q[0] - W, q[1]] for q in shifted]
        draw(back[0], back[1], back[2], *t)
    else:
        draw(p[0], p[1], p[2], *t)

gaps = sum(1 for c in covered if not c)
print(f'  rasterised {100*(1-gaps/(W*H)):.2f}% of pixels; the rest keep the base')
out.save(OUT)
print(f'  wrote {OUT}  {W}x{H}')
