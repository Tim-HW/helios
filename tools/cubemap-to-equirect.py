"""Cube-map cross -> equirectangular, using the model's own UVs.

The atlas layout (which of the 4x3 cells holds which cube face, and how each is
rotated or flipped) is not guessed: it is fitted from the mesh, by taking every
vertex, deciding which cube face its direction belongs to, and least-squares
fitting the affine map from face-local (s,t) to the UV the model actually uses.
"""
import json, struct, math, sys
from PIL import Image

GLB, ATLAS, OUT, W = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
H = W // 2

f = open(GLB, 'rb'); f.read(12)
clen, _ = struct.unpack('<II', f.read(8))
j = json.loads(f.read(clen).decode())
blen, _ = struct.unpack('<II', f.read(8))
buf = f.read(blen)

def read(acc_i):
    a = j['accessors'][acc_i]
    bv = j['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = {'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
    fmt = {5126:'f', 5123:'H', 5125:'I'}[a['componentType']]
    sz = struct.calcsize(fmt)
    stride = bv.get('byteStride') or n*sz
    out = []
    for i in range(a['count']):
        base = off + i*stride
        out.append(struct.unpack_from('<'+fmt*n, buf, base))
    return out

prim = j['meshes'][0]['primitives'][0]
pos = read(prim['attributes']['POSITION'])
uv  = read(prim['attributes']['TEXCOORD_0'])

def face_st(x, y, z):
    ax, ay, az = abs(x), abs(y), abs(z)
    if ax >= ay and ax >= az: return ('X+' if x > 0 else 'X-'), z/ax, y/ax
    if ay >= az:              return ('Y+' if y > 0 else 'Y-'), x/ay, z/ay
    return ('Z+' if z > 0 else 'Z-'), x/az, y/az

# Group vertices by face, dropping those near an edge: a vertex exactly on a
# cube seam belongs to two faces and its UV picks one arbitrarily, which would
# poison the fit.
groups = {}
for (x, y, z), (u, v) in zip(pos, uv):
    n = math.sqrt(x*x + y*y + z*z)
    if n == 0: continue
    fc, s, t = face_st(x/n, y/n, z/n)
    if max(abs(s), abs(t)) > 0.97: continue
    groups.setdefault(fc, []).append((s, t, u, v))

def fit(rows):
    """least squares for  u = a*s + b*t + c  (and the same for v)"""
    def solve(target):
        A = [[0.0]*3 for _ in range(3)]; B = [0.0]*3
        for s, t, u, v in rows:
            x = (s, t, 1.0); y = u if target == 'u' else v
            for i in range(3):
                for k in range(3): A[i][k] += x[i]*x[k]
                B[i] += x[i]*y
        for c in range(3):                       # gaussian elimination
            p = max(range(c, 3), key=lambda r: abs(A[r][c]))
            A[c], A[p] = A[p], A[c]; B[c], B[p] = B[p], B[c]
            for r in range(3):
                if r == c or A[c][c] == 0: continue
                m = A[r][c]/A[c][c]
                for k in range(c, 3): A[r][k] -= m*A[c][k]
                B[r] -= m*B[c]
        return [B[i]/A[i][i] if A[i][i] else 0.0 for i in range(3)]
    return solve('u'), solve('v')

FIT = {}
for fc, rows in groups.items():
    cu, cv = fit(rows)
    err = max(abs(cu[0]*s + cu[1]*t + cu[2] - u) + abs(cv[0]*s + cv[1]*t + cv[2] - v)
              for s, t, u, v in rows)
    FIT[fc] = (cu, cv)
    print(f'  face {fc}: {len(rows):4} verts   max residual {err:.5f}')

src = Image.open(ATLAS).convert('RGB')
SW, SH = src.size
px = src.load()
out = Image.new('RGB', (W, H))
op = out.load()

for yy in range(H):
    lat = (0.5 - (yy + 0.5)/H) * math.pi           # +pi/2 at top
    cl, sl = math.cos(lat), math.sin(lat)
    for xx in range(W):
        lon = ((xx + 0.5)/W - 0.5) * 2*math.pi     # -pi .. +pi, 0 at centre
        # Y is the polar axis in this model's frame.
        x, y, z = cl*math.sin(lon), sl, cl*math.cos(lon)
        fc, s, t = face_st(x, y, z)
        cu, cv = FIT[fc]
        u = cu[0]*s + cu[1]*t + cu[2]
        v = cv[0]*s + cv[1]*t + cv[2]
        # Bilinear: at the poles a single 512px cube face is stretched across
        # the whole width, and nearest-neighbour turns that into visible steps.
        fx = min(SW-1.001, max(0.0, u*SW - 0.5))
        fy = min(SH-1.001, max(0.0, v*SH - 0.5))
        x0, y0 = int(fx), int(fy)
        dx, dy = fx - x0, fy - y0
        a = px[x0, y0]; b = px[x0+1, y0]; c = px[x0, y0+1]; d = px[x0+1, y0+1]
        op[xx, yy] = (
            int(a[0]*(1-dx)*(1-dy) + b[0]*dx*(1-dy) + c[0]*(1-dx)*dy + d[0]*dx*dy),
            int(a[1]*(1-dx)*(1-dy) + b[1]*dx*(1-dy) + c[1]*(1-dx)*dy + d[1]*dx*dy),
            int(a[2]*(1-dx)*(1-dy) + b[2]*dx*(1-dy) + c[2]*(1-dx)*dy + d[2]*dx*dy))

out.save(OUT)
print(f'  wrote {OUT}  {W}x{H}')
