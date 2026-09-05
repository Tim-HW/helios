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
| Sun, Venus, Earth (day + clouds) | [Solar System Scope](https://www.solarsystemscope.com/textures/) | INOVE | CC-BY-4.0 |

Only the **textures** are used from the Sketchfab models above. Their spheres are
not: Helios generates its own, which carry real polar flattening, axial tilt and
rotation period, and take part in the eclipse shadowing, atmospheric scattering
and level-of-detail work that a stock glTF material could not.

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

`assets/ISS_stationary.glb` — **licence unknown.** It arrived without the
`license.txt` that accompanies every other model here, so its author and terms
could not be recorded. It is the one asset whose *geometry* is used, because the
station is not a sphere and nothing here could generate it.

**This needs resolving before the project is shared.** If it came from Sketchfab
it is almost certainly CC-BY and simply needs its author credited; if it is
NASA's own model it is public domain and no attribution is required, though it is
usually given. Until the source is known, treat this file as not clearable for
redistribution.

### What the file itself says

Its glTF `asset` block carries only `"generator": "Khronos Blender glTF 2.0
I/O"` — no `copyright` field — and a `strings` sweep of all 44 MB turns up no
author, licence or URL. So the file records nothing.

Its structure does, though. It has 132 nodes, **89 of them named as numbered ISS
elements in assembly order** — `01 Zarya - (FGB) Funtional Cargo Block`,
`02 Unity Node 1`, `05 Zvezda (SM) Service Module`, `13 Pirs Docking Compartment
(DC) and Airlock`, `34 Poisk (MRM-2) Mini Research Module` — including the
misspelling *Funtional*, which is a searchable fingerprint.

**A lead, not an answer:** NASA's 3D Resources publishes a high-resolution ISS
model "in many parts … which preserves the configuration of the component
parts", in Lightwave format, at the station's February 2011 configuration. A
many-part model numbered in assembly order is consistent with that, and NASA's
models are US-government public domain. But the NASA page does not publish its
part list, so this could not be confirmed, and a licence question is not
something to settle on a resemblance.

To settle it: download the NASA hi-res ISS model and compare the part names — if
the numbering and the *Funtional* typo match, the file is public domain and the
question closes. Otherwise search Sketchfab for the same naming scheme. Whoever
downloaded this file may also simply remember.

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
