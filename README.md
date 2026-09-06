# Helios

The solar system at true scale, in a browser. Real body radii, real orbital
distances, real positions for any date — and a camera you can fly anywhere in it.

Almost every diagram of the solar system lies, because an honest one is mostly
empty. Helios doesn't. Earth is a 6,371 km speck 149.6 million km from a 696,000
km Sun, and you can go and look.

## Running it

No build step and no dependencies to install — three.js is vendored in `vendor/`.
ES modules need a real HTTP origin, so opening `index.html` over `file://` will
not work.

```sh
./serve.sh          # or: python3 serve.py 8000
```

`serve.py` is a development server and nothing else. It binds to loopback, and
its test-result endpoint is off unless `HELIOS_PROBE=1`. **Do not expose it.**
To put Helios on the internet, see [Deploying it](#deploying-it) below.

### A note on module caching

`serve.py` deliberately sends `Cache-Control: no-store`. With no bundler, a
browser holding a stale copy of one module beside fresh copies of the rest is a
real and very confusing failure: when the stale one is the shader noise library,
only the programs that call its missing functions fail to link, so some planets
render perfectly and others are simply *absent* — no error on screen, nothing
obviously broken, just missing worlds. If you ever see that, hard-reload with
**Ctrl+Shift+R**; the app also puts any shader build failure in a banner across
the top rather than leaving it in the console, and checks at startup that the
shader library actually contains the primitives the shaders expect.

The structural defence matters more than any of that, though: **a module that
changes carries its own new dependencies.** The level-of-detail helpers are
defined in `render/material.js`, beside the shaders that call them, rather than
in `render/shaders/noise.js` — which stays limited to long-stable primitives
(`snoise`, `fbm`, `ridged`). A browser holding an old copy of the noise library
therefore still links, because nothing new is asked of it. The helpers are also
named so they cannot collide with any earlier copy that did define them.

Then open <http://localhost:8000>.

## Flying

| | |
|---|---|
| **Drag** | look around (orbit the target when one is focused) |
| **W A S D** | fly; **R / F** for up and down |
| **Shift** | 8× boost |
| **Scroll** | speed multiplier (dolly when focused) |
| **Z / X** | zoom in / out, **C** resets to 55° |
| **Esc** | release focus |
| **P**, **[** **]** | pause, slow down / speed up time |

Your speed scales with the distance to the nearest surface, so the same controls
work hovering a metre above Europa's ice and crossing the gap to Saturn. You
never have to touch a setting.

## The two hard problems

A true-scale solar system is not hard to compute. It is hard to *render* and hard
to *navigate*, and most attempts quietly cheat on one or the other.

**Depth precision.** A 1,737 km moon and a 4.5-billion-km orbit have to share one
depth buffer — a range of about 10¹⁰. A conventional near/far setup z-fights
itself to pieces. Helios uses a logarithmic depth buffer, which spreads precision
evenly across the decades. Every custom shader splices in three's `logdepthbuf`
chunks; miss them on one material and that object ignores depth entirely.

Float32 vertex precision is a smaller problem than it looks. three computes
`modelViewMatrix` in JS doubles and only then downcasts, so meshes arrive at the
shader already camera-relative and small — no floating-origin rig needed, which
is the usual over-engineering reflex here. Orbit *lines* are the exception: their
vertices are absolute and reach 4.5e9 km, quantising to ~270 km steps. Those get
a floating origin that engages when the camera comes within 0.1% of the orbit's
radius, and a fade that dissolves the line entirely closer in. Measured, that is
101 km of error down to 0.0004 km.

**Navigability.** At true scale nearly everything is a sub-pixel dot, and flying
between planets at a fixed speed takes hours. Three things fix it:

- *Adaptive speed*, proportional to the empty space ahead — 350 m/s above
  Europa, 2.5×10⁸ km/s in open space, with no mode switch between them.
- *Reference frames*: the camera's position is stored as an offset from a nearby
  body, so 100,000× time warp doesn't strand you in empty space the moment you
  step back to look at something.
- *Minimum-size markers*, drawn as *hollow rings* and never filled discs. A ring
  reads as an annotation pointing at something; a disc would read as the planet
  and would quietly undo the entire premise. They fade in only as the true disc
  drops below a few pixels, and fade out again as you approach.

Zoom exists for the same reason: at 55° the Sun seen from Earth is four pixels
across. Narrowing the field is the only way to actually look at anything far
away, and it changes nothing physical — the readout reports true angular size
either way.

## Where the numbers come from

Planets use JPL's [approximate Keplerian
elements](https://ssd.jpl.nasa.gov/planets/approx_pos.html) (J2000 epoch plus
per-century rates, valid 1800–2050), propagated each frame and solved with
Newton–Raphson. Checked against JPL Horizons for 2026-01-01, every planet agrees
to within a few arcminutes; Saturn is the worst at 4.4′.

The Moon gets more care, because the Earth–Moon gap is the most misrepresented
distance in the solar system. Its mean anomaly advances at the anomalistic rate,
its node and perigee carry their own precession rates, and the main solar
perturbation terms (evection, variation, the annual equation) are applied. Those
matter: a pure two-body ellipse can only reach a(1−e) = 363,300 km, so the real
perigee of 356,500 km is otherwise unreachable and the Moon never looks as large
as it really gets. Checked against Horizons, distance lands within 70–450 km.

Moons other than our own use fixed elements in their parent's *equatorial* frame,
so Titan follows Saturn's 26.7° tilt and stays in the ring plane, and Triton
keeps its retrograde inclination.

Jupiter uses a real photographic map (see `CREDITS.md`); every other surface is
procedural, and Jupiter falls back to procedural bands if the image is missing.
Only the texture is used — the sphere that shipped with it is not, because the
one Helios generates carries the real 6.5% polar flattening, the axial tilt and
rotation, and takes part in the eclipse shadowing and atmosphere that the model's
own material could not.

Saturn's rings use real radii with a real Cassini division, and cast the planet's
shadow onto themselves analytically, because no shadow map can resolve a 140,000
km disc that is tens of metres thick.

Sunlight is **not** attenuated by distance by default. Physically Neptune gets
1/900th of Earth's illumination, which renders as black; the true figure is
reported in the HUD instead, and a toggle dials real inverse-square falloff back
in for anyone who wants to see how dark it is out there.

## The asteroid belt

22,491 real objects — 17,983 main-belt asteroids and 4,508 Jupiter Trojans,
everything brighter than absolute magnitude 14 (roughly 6 km across and up) —
with orbital elements from JPL's Small-Body Database at a common epoch. The four
largest (Ceres, Vesta, Pallas, Hygiea) are lifted out of the swarm and rendered
as real bodies you can fly to.

Kepler's equation is solved for all of them **in the vertex shader**. On the CPU
that would be 22,491 Newton iterations every frame; on the GPU it is free, the
elements upload once, and only the date changes — so the swarm animates
correctly at any time warp for nothing.

Because the elements are real, the structure is real:

- **The Kirkwood gaps.** Asteroids whose orbital period is a simple fraction of
  Jupiter's get kicked repeatedly until they leave. The 3:1 gap at 2.50 AU comes
  out completely empty in this data — 0% of the surrounding density — and the
  5:2 and 7:3 gaps at 24% and 28%. Nothing in this codebase puts them there.
- **The Trojan clouds.** The two swarms sharing Jupiter's orbit sit at +63.0° and
  −62.8° from the planet, against a theoretical ±60°. The fact that the leading
  cloud holds more objects than the trailing one (2,681 vs 1,825) is a real and
  still-unexplained asymmetry of the solar system, not an artefact.

Packed to 14 bytes per object — six 16-bit elements plus magnitude — the whole
catalogue is 315 KB. The coarsest quantum is 0.0055° of anomaly, about 21,000 km
at 3 AU, far below anything resolvable on an object drawn as a single speck.

**These dots are markers, not bodies.** An asteroid a few km across is invisible
from any distance you would view it at, so they are drawn at a fixed small pixel
size, exactly like the hollow rings on the planets. What is honest is the
geometry — every dot is a real object where it really is.

Which leaves the belt's defining property, emptiness, impossible to draw: an
empty screen shows nothing. So the model reports it as a number instead. The
**Nearest rock** readout sweeps the entire catalogue and tells you how far the
closest one actually is. Standing in the thick of the belt at 2.7 AU, that is
about **4.4 million km — eleven times the distance to the Moon**. You could fly
straight across the belt and never come near anything. The sweep runs in slices
so no single frame pays for all of it (worst slice ~1 ms against a 16.7 ms
budget), with the first answer computed in one pass so the readout is never
blank.

Two viewpoints go with it: *Inside the belt*, where the lesson is the empty
screen and the readout beside it, and *The belt from above*, which holds the
gaps and both Trojan clouds in one frame.

## Making the worlds look like worlds

Surfaces are procedural GLSL — no textures, no downloads, works offline — but a
painted sphere reads as plastic. Three things fix that, and all three are forced
by the same fact: at true scale you can actually fly down and land.

**Relief.** Each surface style supplies a height field alongside its colour, and
the shader bends the sphere normal by that field's gradient (three samples per
pixel). Craters then catch light on one rim and shadow the other, instead of
being grey paint. Styles opt in simply by defining `surfaceHeight()`; cloud decks
and the Sun don't, and stay smooth.

**Detail that tracks how close you are.** The scale that matters is the *ground
sample distance* — how much surface one pixel covers — and not the body's
apparent size, which saturates as you approach: a disc can only fill so much of
the sky, so between 400 km and 4 km up the apparent size barely moves while what
a pixel covers changes a hundredfold. At altitude `h` above radius `R`, a pixel
spans `h/pxPerRadian` of ground and a noise cycle at frequency `f` spans `R/f`,
so matching them gives `f = R · pxPerRadian / h`. Far away `h` tends to the
distance and this reduces to apparent size, so one formula covers both regimes.
A sliding noise band rides that frequency, and the Moon's local contrast goes
from 0.008 to 0.29 between orbit and 4 km up.

Two details make it hold together. Octaves finer than a pixel are dropped
(`lodOctaves`), because summing what the screen cannot resolve just adds white
noise — that is what turns a terminator into salt and pepper, and the limit is
*half* the sampling rate, not the sampling rate. And the sliding band's amplitude
falls as 1/frequency, so it contributes the same slope as the octaves it
continues rather than swinging the normal further and further as you descend.

**Air.** Bodies with atmospheres carry a slightly larger shell that glows where
the line of sight passes through more of it. Density falls exponentially with
altitude — computed from the impact parameter of each view ray, its closest
approach to the planet's centre — so the glow fades outward instead of stopping
at a hard ring, which is the usual giveaway of a fake atmosphere. Scattering is
biased forward, so a backlit limb flares while the night side keeps a thin
twilight arc, and the surface itself hazes toward the limb where you are looking
through the most air.

The clearest check is `tests/surface-probe.html`'s backlit row: Earth, Titan and
Venus flare into rings, and the airless Moon stays a bare crescent.

Cost, measured on the probe: a planet filling 1600×900 renders in **2.17 ms**,
and the Moon from 4 km up in 1.75 ms.

### Two bugs worth recording

**Enlarged bodies swallowed the camera.** The size-exaggeration slider scaled the
meshes, but every camera calculation kept using the TRUE radius — so "park at 4.2
radii" aimed at the real size and landed inside the enlarged geometry. Back faces
are culled, so the planet did not look wrong, it looked *absent*: stars and orbit
lines visible straight through it, and a completely clean console. Navigation now
measures against a `renderRadius` — what is actually drawn — while every readout
still reports the true one. Two things made it easy to hit without realising: in
Firefox a mouse wheel over a range input changes it, and the wheel is the flight
speed control, so scrolling with the pointer over that panel silently enlarged
everything. The slider now ignores the wheel, adopts whatever value a reload
restored, rejects NaN, and stops at 100× — beyond about 60× the Sun's drawn
radius exceeds Mercury's orbit and bodies genuinely do contain one another.

**Sunlight arrived in the wrong frame.**

The sun direction was being computed in each body's *tilt* frame, while the
surface shaders work in its *spin* frame. Sunlight therefore arrived missing the
planet's rotation: the terminator sat at an arbitrary angle per body, and — worse
— it turned with the surface, so day and night never advanced. Every frame looked
plausible on its own, which is why it survived until the shading got good enough
to notice. `tests/checks.js` now asserts that the direction handed to each shader
is the true direction to the Sun in that frame, and that it *moves* as the body
turns (Mars sweeps 73° in five hours).

## Eclipses

Bodies shadow each other, and because the positions are real the shadows are
real events rather than an effect.

The Sun is treated as a **disc, not a point** — half a degree wide from Earth, a
tenth of a degree from Jupiter, a fiftieth from Neptune. For every surface point
the shader works out how much of that disc is hidden by each nearby body, using
the exact circle-overlap area. That is where umbra and penumbra come from: a
point source would give a hard-edged circle, which is both wrong and looks it.
It is also why a total eclipse is total only along a narrow track while a much
wider region sees a partial one.

Only local bodies are considered — a moon can be eclipsed by its planet or by a
sibling, a planet by its own moons — ranked by apparent size so the ones that
could actually darken something get the four available slots. Venus does transit
the Sun as seen from Earth, but it covers a thirty-thousandth of the disc, well
below anything the tone mapping would show.

What this produces, checked in `tests/eclipse-probe.html`:

- **Lunar eclipses work.** On 2026-03-03, a real total lunar eclipse, the Moon
  renders completely dark; a week later it is a full bright disc. The geometry is
  asserted independently in `tests/checks.js`: the Moon's centre sits 0.84 lunar
  radii inside Earth's umbra that night, and 226 radii outside it a week later.
- **Moon shadows on Jupiter work.** The Galilean moons throw crisp black dots
  across the disc, as they really do — a familiar sight in a small telescope.
- **Solar eclipses on Earth do not.** With the Moon forced exactly onto the
  Earth–Sun line the shader blocks 89% of the Sun at the sub-solar point, so the
  shadow maths is sound. But sweeping ±6 hours around the real total eclipse of
  2026-08-12 produces no umbra at all. The reason is ephemeris precision, not
  shading: the lunar model is good to about 0.7% of the Earth–Moon distance,
  roughly 2,700 km, which is ~0.4° seen from Earth — larger than the Moon's own
  0.26° disc. Lunar eclipses survive that error because Earth's shadow at the
  Moon's distance is some 9,000 km wide; a solar umbra is about 100 km, and
  missing by 0.4° means missing entirely. Getting those right needs a proper
  lunar theory, not more terms bolted onto this one.

Cost: none worth measuring. A planet filling 1600×900 still renders in 2.0 ms.

## The interface

The right-hand side is one scrollable sidebar of collapsible sections rather than
two stacked panels. That was a real bug, not a style choice: the destinations
list grew into the options panel below it, so on a 1280×720 window everything
from Saturn onwards — and the whole viewpoints section — was silently
unreachable. Panels cannot collide now because there is only one.

**Labels are placed, not just projected.** Each frame every visible body proposes
a label; they are sorted by rank (planets and the Sun first, then by distance)
and placed greedily, skipping any that would overlap one already placed or fall
behind a panel. Before this the inner planets collapsed into an unreadable knot
near the Sun and names drew through the sidebar.

**You can go to a date.** Type `2026-03-03 10:53` — always UTC, because a
local-time date is a different sky — or pick from **Moments**, a short list of
things this model actually reproduces:

| | |
|---|---|
| Total lunar eclipse | 2026-03-03 — the Moon 1.4 of its own radii inside Earth's umbra |
| Io's shadow on Jupiter | 2026-08-03 — a black dot crossing the cloud tops |
| Earth at perihelion | 2027-01-04 — 147.10 million km |
| Mars at opposition | 2027-02-20 — 101 million km, as close as it gets this decade |

Each was found by searching the model rather than looked up and asserted, and
`tests/checks.js` re-checks the two that carry a physical claim. There is
deliberately no solar eclipse in the list — see the eclipses section for why
offering one would be staging it.


## Assets

Helios generates its own geometry and, by default, its own surfaces. Real
photographic maps are used where one exists and fits; see `CREDITS.md`, because
all of them require attribution.

**Textures, not meshes.** Every planet model that has been dropped in is a UV
sphere, and the sphere Helios generates is the better one — it carries real polar
flattening, the correct axial tilt and rotation period, and takes part in the
eclipse shadowing, atmospheric scattering and level-of-detail work that a stock
glTF material cannot. So the texture is lifted out and the mesh discarded. Bodies
opt in with one line of data (`map:`), and fall back to their procedural surface
if the image is missing.

In use: Sun, Mercury, Venus, Earth (day + clouds), Jupiter, Enceladus, Miranda,
Mimas — the last two arriving alongside their textures as new moons. 6.3 MB in
total, after downscaling; Mercury's map came in at 8192×4096 and 20 MB.

**What could not be used, and why.** The Mars, Moon, Neptune, Saturn and Uranus
textures are laid out as UV atlases — an equirectangular band plus separate polar
caps — which fit only the meshes they shipped with. Applying one to a generated
sphere smears the poles across the equator. Using them means either adopting
those meshes (Mars and the Moon are 1,574 vertices, visibly faceted from orbit,
let alone from the 4 km altitude this app lets you reach) or reprojecting the
atlas back to equirectangular. Proper 2:1 maps for those bodies are freely
available and would be a smaller job than either.

Their ring textures are a different matter: Saturn, Uranus and Neptune all ship
real radial ring maps, and Uranus and Neptune have no rings in Helios at all yet.
That is the most valuable thing left in the folder.

## The ISS

The one asset whose *geometry* is used, because a space station is not a sphere.
It is scaled so its longest axis is the real 109 m, orbits at 413 km on the real
51.64° inclination with a 92.9-minute period, keeps one face toward Earth, and
its orbital plane regresses about 5° a day as J2 makes it.

It is also the sharpest true-scale statement in the model: 109 m against a 12,756
km Earth is one part in 117,000, so it drops below a single pixel beyond about
110 km. From anywhere Earth looks like a planet, the station is a marker ring and
nothing more — you have to go and find it.

At 44 MB it is fetched lazily, the first time the camera comes within 200 km, and
lit by an actual directional light because it arrives with ordinary PBR materials
rather than this app's shaders. The near plane dropped from 100 m to 2 m to stop
it being sliced in half at close range; a logarithmic depth buffer makes those
extra decades essentially free.

**Its licence is unknown** — it came without the `license.txt` every other model
here carries. That needs resolving before this is shared. See `CREDITS.md`.


## Deploying it

```sh
docker compose -f docker/docker-compose.yml up --build   # http://127.0.0.1:8080
tests/verify-container.sh          # 68 assertions against the running image
tests/verify-vendor.sh --upstream  # 10 assertions: vendored three.js vs npm
```

The compose file lives in `docker/` but builds from the repository root — that
is where `index.html`, `src/`, `vendor/`, `assets/` and `.dockerignore` are.

The image is nginx serving five things — `index.html`, `src/`, `vendor/`, the 21
files in `assets/`, and `CREDITS.md` — read-only, unprivileged, with every
capability dropped and no method but `GET`/`HEAD` accepted. It publishes on
`127.0.0.1` on purpose: a TLS terminator goes in front.

It excludes `serve.py` and `tests/` entirely. The 320 MB of Sketchfab source
models the repo used to carry were deleted outright — their textures had already
been extracted into `assets/textures`, and nothing loaded the originals. Their
licences were kept in `assets/licenses/`; see [`CREDITS.md`](CREDITS.md).

Two nginx behaviours in that config look like clutter and are not, so both carry
a comment saying so. `add_header` does not accumulate: one inside a `location`
discards every header inherited from the `server` block, which is why
`Cache-Control` comes from a `map`. And `types { ... }` replaces the MIME table
rather than extending it, which is why the three extra content types are set with
`default_type` instead. Both fail silently, and both are asserted in
[`tests/verify-container.sh`](tests/verify-container.sh).

## Checking it

Open <http://localhost:8000/tests/smoke.html> — 36 assertions, no toolchain.

The one that matters most is the eclipse test. Seen from Earth the Sun and the
Moon are very nearly the *same* apparent size, ~0.5°, which is the entire reason
total solar eclipses are possible. Four independent numbers — two radii and two
distances — must be simultaneously right for that to come out. If it passes, the
sizes and the distances are both sound.

Two further pages render through a real GL context and read the pixels back:

- `tests/render-probe.html` — shader compilation, log-depth, and lit-pixel counts
  for the Sun, Earth, Saturn and Jupiter.
- `tests/viewpoint-probe.html` — every saved viewpoint, plus the Sun and Moon
  discs *measured off the rendered image*: 0.537° and 0.549°, a ratio of 0.979.
- `tests/belt-probe.html` — the belt and Trojans from above, edge-on, and from
  inside.
- `tests/surface-probe.html` — every surface close up, at raking light and
  backlit, descending to 4 km, with frame costs.
- `tests/eclipse-probe.html` — forced and real eclipse geometry, swept in time.
- `tests/ui-probe.html` — loads the real app in a frame and drives it: clicks
  every moment, types good and bad dates, checks nothing overlaps and everything
  is reachable.
- `tests/jupiter-probe.html` — the photographic map against the procedural
  fallback.
- `tests/iss-probe.html` — the station's orbit, scale and geometry, and the
  distance at which it stops being visible at all.

Probes hand their results back to the dev server (`POST /_probe/…`, written to
`.probe/`) instead of relying on a screenshot. Headless Firefox captures on the
load event and then exits, so anything asynchronous still in flight — a texture
decoding, an import resolving — simply never finishes; several debugging rounds
went into half-captured pages before `tests/probe-io.js` existed.
- `tests/sweep-probe.html` — lit-pixel counts for each body across distance,
  zoom and exaggeration, which is what located the vanishing-planet bug.
- `tests/app-scene-probe.html` — the scene assembled exactly as `main.js` does
  it, flown to each body through the real camera code.

There is also `node tests/lint-glsl.mjs`, which guards a trap this codebase fell
into twice: a backtick inside a GLSL template literal — nearly always in a
comment quoting an identifier — silently ends the string, and everything after
it is parsed as JavaScript. The resulting error names a token deep in the shader
and points nowhere useful.

## Layout

```
index.html              import map, HUD markup, styles
serve.sh                python3 -m http.server
vendor/                 three.js r180, vendored for offline use
src/
  main.js               bootstrap and the frame loop
  core/       renderer (log depth), sim clock, startup self-check
  camera/     adaptive fly camera; log-space travel between bodies
  solar/      data, Kepler solver, scene graph, orbit lines, rings,
              asteroid catalogue and the GPU-propagated belt
  render/     shared shader base, procedural surfaces, billboards, stars
  ui/         HUD, projected labels, saved viewpoints, formatting
tests/        checks.js + three runnable pages
```

## Not in scope

Keplerian elements, not N-body — no perturbations beyond the lunar terms above,
and no spacecraft trajectories. No comets and no Kuiper belt; the asteroid belt is Keplerian too, so its
objects do not migrate or collide. No
shadow maps; eclipse shadowing is analytic and currently only on Saturn's rings.
Each planet's obliquity is applied about the ecliptic x-axis, since the data
carries the tilt angle but not the direction of lean — relative geometry within
each system is right, absolute pole azimuth is not.
