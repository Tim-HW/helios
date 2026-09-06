# Credits

Helios generates its own geometry and, by default, its own surfaces. Where a real
photographic map is available it is used instead, and the source is recorded
here. Every one of these requires attribution.

## Surface maps in use

| Body | Source | Author | Licence |
|---|---|---|---|
| Jupiter | [Realistic Jupiter](https://sketchfab.com/3d-models/realistic-jupiter-993ba62a539e4c308e9e3137df454ed6) | [Shady Tex](https://sketchfab.com/ShadyTex4u) | CC-BY-4.0 |
| Mercury | [Mercury](https://sketchfab.com/3d-models/mercury-32347fa4ec1a4987b71f461a401d91c4) | [Akshat](https://sketchfab.com/shooter24994) | CC-BY-4.0 |
| Enceladus, Mimas | [Saturn](https://sketchfab.com/3d-models/saturn-c09a1970148c43ad99db134a9d6d00b5) | [Nestaeric](https://sketchfab.com/Nestaeric) | CC-BY-4.0 |
| Miranda | [Uranus](https://sketchfab.com/3d-models/uranus-0009a69dbace44608c0bd09af9ba20db) | [NestaEric](https://sketchfab.com/Nestaeric) | CC-BY-4.0 |
| Mars | `24881_Mars_1_6792.glb` — see below | **unconfirmed** | **unconfirmed** |
| Sun, Venus, Earth (day + clouds), Saturn, Uranus, Neptune, the Moon | [Solar System Scope](https://www.solarsystemscope.com/textures/) | INOVE | CC-BY-4.0 |

Solar System Scope also publishes maps for bodies that have never been imaged
well enough to have one -- Ceres, Eris, Makemake and others, all named
`*_fictional`. Those are invented, and Helios does not use them: a body with no
real map keeps its procedural surface, which is honest about being a guess.

Only the **textures** are used from the Sketchfab models above. Their spheres are
not: Helios generates its own, which carry real polar flattening, axial tilt and
rotation period, and take part in the eclipse shadowing, atmospheric scattering
and level-of-detail work that a stock glTF material could not.

## Mars — source not yet confirmed

`assets/textures/mars.jpg` was reprojected from `assets/24881_Mars_1_6792.glb`,
which arrived without a `license.txt` and records no provenance of its own: its
glTF `asset` block carries only `"generator": "Khronos Blender glTF 2.0 I/O"`,
and a `strings` sweep finds no author, licence or URL. Its mesh is `Cube.001`,
its material `Default OBJ.005`, and its two embedded textures are named
`mars_diff.jpg` and `mars_norm.jpg`.

The `24881_` filename prefix and the OBJ-derived material name both resemble how
NASA's 3D Resources models are packaged, and the ISS model in this project came
from exactly there — but that is a resemblance, not a provenance, and the same
reasoning was wrong to rely on once already. **Confirm the source before this
ships publicly.** If it is NASA's, it is a US government work and no attribution
is required; if it is the Sketchfab model whose licence is in
`assets/licenses/mars.txt`, it is CC-BY-4.0 and Nestaeric must be credited.

### How the map was made

The model's texture is not an equirectangular map: it is a **cube-map cross**,
2048x1536, four 512px faces across by three down, which is why this texture sat
unused for so long — it fits only the mesh it came with.

It was reprojected by rasterising the model's own triangles into longitude and
latitude and interpolating their UVs, so the atlas layout is never guessed: the
result is exactly the mapping the model uses. Triangles crossing the ±180° seam
are drawn twice, shifted, so the wrap is seamless. The 3.6% of pixels the
rasteriser leaves uncovered are all at the poles, where triangles span the pole
itself; those fall back to an analytic cube lookup whose per-face placement is
least-squares fitted from the same mesh.

The output is 2048x1024, the 2:1 ratio the sphere shader expects. The model's
normal map is present too and was reprojected identically, but is not wired up:
the material derives its own terrain normals.

## Spacecraft models

The JWST model's own `license.txt` asks for this credit verbatim wherever the
work is shared, so here it is, and it also appears in the Credits panel in the
app itself — the app is the thing that gets shared:

> This work is based on ["JWST (james webb space
> telescope)"](https://sketchfab.com/3d-models/jwst-james-webb-space-telescope-6c92c08a672640afb58ee44d248fd0fe)
> by [Paul (Sketchfab)](https://sketchfab.com/paul_sketch) licensed under
> [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/).

Unlike the planet textures, the JWST **geometry** is used, not just its maps.

## The ISS

`assets/iss/scene.gltf` is NASA's own model of the station, from
[science.nasa.gov](https://science.nasa.gov/resource/international-space-station-3d-model/),
made by **NASA's Visualization Technology Applications and Development (VTAD)**
team and published 2019-04-22.

> Credit: NASA Visualization Technology Applications and Development (VTAD)

As a work of the United States government it is not subject to copyright and is
free to use, including commercially. NASA asks that its material not be used to
imply endorsement, and requests — rather than requires — a credit line. Helios
gives one anyway, in the app's Credits panel.

This is the one asset whose *geometry* is used rather than just its maps,
because the station is not a sphere and nothing here could generate it.

### The file shipped here is a derivative

NASA's download is a single-file `ISS_stationary.glb` of 42.43 MB. What ships
here is that model repacked with glTF-Transform v4.5.0 into separated form —
`scene.gltf` plus `scene.bin` and 26 PNG textures, **40.5 MB** in total.

The geometry is untouched, and that is checked rather than assumed: node, mesh,
accessor, material, image and primitive counts all match the original exactly
(132 / 131 / 1372 / 28 / 26 / 343), as does the total element count across every
accessor (1,718,763). Only `bufferViews` differ — 1398 against 344 — which is
glTF-Transform consolidating them on repack.

Draco was deliberately not used: the app constructs a bare `GLTFLoader` with no
`DRACOLoader`, so Draco-compressed geometry would simply fail to load.

**The size saving is small; the caching win is not.** Separating the file cut
only 1.9 MB, but it changed what a CDN will hold: a `.glb` is not in
Cloudflare's default cacheable-extension list and was served uncached from the
origin every time, whereas `.bin` and `.png` are cached at the edge. Nearly all
of the 40 MB now comes from the CDN instead of the server.

The textures are PNG. Re-encoding them to WebP would take this to roughly 16 MB,
and the vendored `GLTFLoader` does support `EXT_texture_webp`, so that remains
open as a further step.

### Identifying it

The file arrived without the `license.txt` that accompanies the Sketchfab
models, so its origin was unknown for a while, and it records nothing itself:
the original's glTF `asset` block carried only `"generator": "Khronos Blender
glTF 2.0 I/O"`, and a `strings` sweep of all 42 MB found no author, licence or
URL. What identified it in the end was the source being named directly —
corroborated by the download on that page being a glTF of **42.43 MB**, exactly
the size of the original this was converted from, and by its 89 nodes named as
numbered ISS elements in assembly order (`01 Zarya - (FGB) Funtional Cargo
Block`, `34 Poisk (MRM-2) Mini Research Module`), which is how NASA's multi-part
model is structured.

## Source models, removed

The textures above were extracted from Sketchfab models that were kept in
`assets/` during development. Those originals were **deleted on 2026-09-05** —
320 MB that nothing loaded. Their `license.txt` files were kept, in
`assets/licenses/`, because for Jupiter, Mercury, Enceladus/Mimas (from
`saturn`) and Miranda (from `uranus`) they are the primary attribution evidence
for textures that are still shipped.

Four of the eight backed nothing that shipped — `mars`, `moon`, `neptune`,
`pluto`. Their textures were laid out as UV atlases (an equirectangular band
plus separate polar caps) that only fit the meshes they came with, not a
generated sphere, so they were never usable without re-projection. If that work
is picked up later, the models have to be downloaded again; `assets/licenses/`
records exactly which ones and from whom.

Worth remembering that **`pluto` was CC-BY-SA-4.0**, not CC-BY — a share-alike
obligation reaching any adaptation. That mattered only while the file was here,
and it never shipped, but it will matter again if it is fetched a second time.

## Ephemerides and small bodies

Planetary positions use JPL's *Keplerian Elements for Approximate Positions of
the Major Planets*; the 22,491 asteroids and Trojans come from JPL's Small-Body
Database. Both are public-domain US government works.

## Software

three.js r180 (MIT) is vendored in `vendor/`, along with its `GLTFLoader` and
`BufferGeometryUtils`. The simplex noise in `src/render/shaders/noise.js` is
Ashima Arts / Stefan Gustavson's implementation, MIT licensed.

Vendoring means nothing would notice if those ~2 MB were altered, so they are
verified against the published release rather than trusted. Checked
byte-for-byte against `https://unpkg.com/three@0.180.0/` on 2026-09-05:

| file | sha256 (first 16) | vs upstream |
|---|---|---|
| `three.module.js` | `c8211c69345d2e99` | identical |
| `three.core.js` | `eb077d2417f61d3e` | identical |
| `BufferGeometryUtils.js` | `fda7e946b8e0b5ab` | identical |
| `GLTFLoader.js` | `adbbafe8ce404165` | **one line changed** |

The one modification, and the only one, is that `vendor/` is flat while the npm
layout is not, so GLTFLoader's sibling import had to be rewritten:

```diff
-import { toTrianglesDrawMode } from '../utils/BufferGeometryUtils.js';
+import { toTrianglesDrawMode } from './BufferGeometryUtils.js';
```

`tests/verify-vendor.sh` re-checks the pinned hashes offline, and with
`--upstream` re-fetches npm and asserts that this is still the *only* difference.
