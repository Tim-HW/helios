import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise.js';
import { assetUrl } from '../core/assets.js';

// Every body surface is procedural GLSL -- no textures, no downloads, works
// offline. Each style below supplies one function:
//
//   vec3 surfaceAlbedo(vec3 p)   // p = unit direction on the sphere, object space
//
// and the shared main() handles lighting, log depth, tone mapping and colour
// space identically for all of them.
//
// Two things here are deliberate and worth knowing before editing:
//
// 1. LIGHTING IS DONE IN OBJECT SPACE. uSunDir is the direction to the Sun
//    rotated into the body's own frame on the CPU each frame. That sidesteps
//    normal matrices entirely (the giants are visibly oblate, so world-space
//    normals would need an inverse transpose) and makes surface features rotate
//    with the planet for free.
//
// 2. SUNLIGHT IS NOT ATTENUATED BY DISTANCE by default. Physically Neptune gets
//    1/900th of Earth's illumination, which renders as black. The true figure
//    is reported in the HUD instead; uSunIntensity lets the UI dial real
//    inverse-square falloff back in for anyone who wants to see it.


// Level-of-detail helpers, defined HERE rather than in the noise library, and
// under names that have never existed in it.
//
// That is not tidiness, it is cache safety. These modules load separately, and
// a browser will serve a fresh copy of one beside a stale copy of another. When
// new shader code called new functions that lived in the OLDER file, a stale
// copy of that file broke every surface shader while clouds and atmospheres
// kept working -- planets vanished with nothing but a GLSL error to show for it.
//
// Keeping new helpers beside their callers inverts that: the file that changes
// is the file that carries its own dependencies, so an out-of-date copy of the
// stable primitives (snoise, fbm, ridged -- unchanged for a long time) still
// links correctly. The distinct names matter too: a cached copy that happens to
// define the OLD helper names would otherwise collide with these, so whichever
// version of noise.js a browser is holding, this links.
const LOD_GLSL = /* glsl */`
// --- Level of detail --------------------------------------------------------
// Octaves finer than a pixel cannot be resolved; summing them anyway just adds
// white noise, which is what turns a terminator into salt and pepper. These
// stop adding octaves at the pixel scale, so the surface is band-limited to
// what the screen can actually show -- and gains detail again as you approach.
//
// With lacunarity 2 and gain 0.5 every octave contributes about the same slope,
// so dropping the unresolvable ones costs shape but not ruggedness.
// pixelFreq is the SAMPLING rate, so usable content stops at half of it.
// Allowing octaves right up to it -- as the obvious version of this does --
// leaves every feature one pixel wide, which is exactly the white noise this is
// meant to prevent. The 2.5 keeps a little margin beyond plain Nyquist.
int lodBandOctaves(float baseFreq, int maxOct, float pixelFreq) {
  float limit = pixelFreq / 2.5;
  float allowed = log2(max(limit / max(baseFreq, 1e-4), 1.0)) + 1.0;
  return int(clamp(allowed, 1.0, float(maxOct)));
}

float fbmBand(vec3 p, float freq, int maxOct, float pixelFreq) {
  return fbm(p * freq, lodBandOctaves(freq, maxOct, pixelFreq), 2.0, 0.5);
}

float ridgedBand(vec3 p, float freq, int maxOct, float pixelFreq) {
  return ridged(p * freq, lodBandOctaves(freq, maxOct, pixelFreq));
}
`;

const VERTEX = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vDir;      // object-space unit direction (drives the noise)
varying vec3 vNrm;      // object-space normal (drives the lighting)
varying vec3 vViewNrm;  // view-space normal (drives limb/rim effects)
varying vec3 vViewDir;
varying vec2 vUv;       // equirectangular, for bodies that have a real map

void main() {
  vUv = uv;
  vDir = normalize(position);
  vNrm = normalize(normal);
  vViewNrm = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewDir = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FRAG_HEAD = /* glsl */`
#include <logdepthbuf_pars_fragment>

uniform vec3  uSunDir;
uniform vec3  uColor;
uniform float uTime;
uniform float uAmbient;
uniform float uSunIntensity;
uniform float uSeed;

// Solidity. A painted sphere reads as plastic; what makes a world look like a
// world is terrain that catches light on one side and shadows on the other.
uniform vec3  uCameraObj;    // camera position in this body's own frame, km
uniform float uRadius;       // km, so surface points can be placed in that frame
uniform float uBumpScale;    // how hard the height field bends the normal
uniform float uDetailAmp;    // fades in the fine octaves as you approach
uniform float uDetailFreq;   // ...at roughly one cycle per pixel

// Air. Even on the ground-facing side, a thick atmosphere washes the surface
// out toward the limb, where you are looking through far more of it.
uniform vec3  uAtmoColor;
uniform float uAtmoDensity;

// Eclipses. Bodies that might come between this surface and the Sun, in this
// body's own frame: xyz is the centre in km, w the radius.
#define MAX_OCCLUDERS 4
uniform vec4  uOccluders[MAX_OCCLUDERS];
uniform int   uOccluderCount;
uniform float uSunAngularRadius;   // radians, as seen from here

varying vec3 vDir;
varying vec3 vNrm;
varying vec3 vViewNrm;
varying vec3 vViewDir;
varying vec2 vUv;

// A real photographic map, where one exists. Bodies without one stay procedural,
// so the app still works with no assets at all -- and so does this one if the
// image fails to load.
uniform sampler2D uMap;
uniform float uHasMap;

${NOISE_GLSL}
${LOD_GLSL}
`;

// Styles that model relief define surfaceHeight(); those that don't (clouds,
// gas giants, the Sun) get this and are shaded as smooth spheres.
const DEFAULT_HEIGHT = /* glsl */`
float surfaceHeight(vec3 p) { return 0.0; }
`;
const DEFAULT_GLOSS = /* glsl */`
float surfaceGloss(vec3 p) { return 0.0; }
`;

const SHADOW_GLSL = /* glsl */`
// How much of the Sun is still visible from a point on the surface.
//
// The Sun is not a point, and that is the whole reason eclipse shadows look the
// way they do: a disc roughly half a degree wide seen from Earth, a tenth of a
// degree from Jupiter. Treating it as a point gives a hard-edged circle, which
// is wrong and looks it. Working out how much of its DISC is hidden gives the
// umbra and the soft penumbra around it for free -- and, on Earth, the reason a
// total eclipse is total only along a narrow track while a much wider region
// sees a partial one.

// Fraction of a disc of angular radius rs that is covered by one of radius ro
// whose centre is sep away. Exact lens-area formula. (PI is spelled out because
// three only defines it in the <common> chunk, which this fragment stage does
// not include.)
float discOverlap(float rs, float ro, float sep) {
  if (sep >= rs + ro) return 0.0;                  // clear of each other
  if (sep <= ro - rs) return 1.0;                  // Sun entirely behind it
  if (sep <= rs - ro) return (ro * ro) / (rs * rs); // occluder wholly inside
  float d = max(sep, 1e-9);
  float a = clamp((d * d + rs * rs - ro * ro) / (2.0 * d * rs), -1.0, 1.0);
  float b = clamp((d * d + ro * ro - rs * rs) / (2.0 * d * ro), -1.0, 1.0);
  float area = rs * rs * acos(a) + ro * ro * acos(b)
             - 0.5 * sqrt(max((-d + rs + ro) * (d + rs - ro)
                            * (d - rs + ro) * (d + rs + ro), 0.0));
  return clamp(area / (3.141592653589793 * rs * rs), 0.0, 1.0);
}

float sunVisibility(vec3 P) {
  float vis = 1.0;
  for (int i = 0; i < MAX_OCCLUDERS; i++) {
    if (i >= uOccluderCount) break;
    vec3 toOcc = uOccluders[i].xyz - P;
    float along = dot(toOcc, uSunDir);
    if (along <= 0.0) continue;                    // it is behind us, not between
    float perp = length(toOcc - along * uSunDir);
    // Angular radius of the occluder, and its angular distance from the Sun's
    // centre, both as seen from this point.
    vis *= 1.0 - discOverlap(uSunAngularRadius, uOccluders[i].w / along, perp / along);
  }
  return clamp(vis, 0.0, 1.0);
}
`;

const FRAG_MAIN_LIT = /* glsl */`
// Bend the sphere normal by the gradient of the height field. Three samples --
// the point and two tangent steps -- is enough, and it is what turns painted
// craters into craters that actually catch the light.
vec3 terrainNormal(vec3 p, vec3 n) {
  if (uBumpScale <= 0.0) return n;
  vec3 up = abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, p));
  vec3 b = cross(p, t);
  // Step in step with the detail: sampling finer than the noise you actually
  // have just returns noise, and coarser flattens everything out.
  float eps = max(1.6 / max(uDetailFreq, 24.0), 2.0e-5);
  float h0 = surfaceHeight(p);
  float ht = surfaceHeight(normalize(p + t * eps));
  float hb = surfaceHeight(normalize(p + b * eps));
  vec3 grad = ((ht - h0) * t + (hb - h0) * b) / eps;
  return normalize(n - uBumpScale * grad);
}

void main() {
  vec3 p = normalize(vDir);
  vec3 albedo = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : surfaceAlbedo(p);
  vec3 nGeom = normalize(vNrm);
  vec3 n = terrainNormal(p, nGeom);

  // Ease the relief out as the light grazes. Near the terminator the lighting
  // is nearly a step function of the normal, so any bump at all flips pixels
  // between lit and unlit -- and it is also where a rough surface really is
  // mostly self-shadowed, so the average is genuinely flatter than the relief
  // suggests. Blending back toward the sphere normal there is both the cure and
  // the more truthful shading.
  float graze = smoothstep(-0.05, 0.30, dot(nGeom, uSunDir));
  n = normalize(mix(nGeom, n, 0.25 + 0.75 * graze));

  float ndl = dot(n, uSunDir);
  // A soft terminator: a hard step looks like a knife edge on a 6000 km ball.
  float lit = smoothstep(-0.08, 0.18, ndl) * sunVisibility(p * uRadius);
  vec3 col = albedo * (lit * uSunIntensity + uAmbient);

  // Specular. Only water, ice and haze have any, but where it exists it is the
  // difference between an ocean and a blue-painted floor.
  float gloss = surfaceGloss(p);
  if (gloss > 0.001) {
    vec3 V = normalize(uCameraObj - p * uRadius);
    vec3 H = normalize(V + uSunDir);
    float spec = pow(max(dot(n, H), 0.0), 60.0);
    col += vec3(1.0, 0.97, 0.90) * spec * gloss * lit * uSunIntensity;
  }

  // Aerial perspective: looking through more air near the limb than at the
  // centre of the disc, so the surface fades into its own sky there.
  if (uAtmoDensity > 0.001) {
    vec3 V = normalize(uCameraObj - p * uRadius);
    float rim = 1.0 - max(dot(n, V), 0.0);
    float haze = uAtmoDensity * pow(rim, 3.0) * clamp(lit + 0.10, 0.0, 1.0);
    col = mix(col, uAtmoColor * (0.45 + 0.55 * lit), clamp(haze * 0.75, 0.0, 0.92));
  }

  gl_FragColor = vec4(col, 1.0);
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FRAG_MAIN_EMISSIVE = /* glsl */`
void main() {
  vec3 p = normalize(vDir);
  // A photograph of the photosphere still wants the limb darkening and the
  // headroom the procedural version applies, so modulate rather than replace.
  vec3 emissive = uHasMap > 0.5
    ? texture2D(uMap, vUv).rgb * 2.6 * (0.40 + 0.60 * pow(
        clamp(dot(normalize(vViewNrm), normalize(vViewDir)), 0.0, 1.0), 0.55))
    : surfaceAlbedo(p);
  gl_FragColor = vec4(emissive, 1.0);
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// --- Surface styles ---------------------------------------------------------

const STYLES = {
  // Airless, heavily cratered: Mercury, Pluto, Phobos, Deimos.
  rocky: /* glsl */`
    // Ridged noise makes crater rims; the fine band fades in as you approach so
    // the ground does not turn to mush when you get close enough to land.
    float surfaceHeight(vec3 p) {
      return ridgedBand(p + uSeed, 18.0, 4, uDetailFreq) * 0.35
           + fbmBand(p + uSeed, 4.0, 4, uDetailFreq) * 0.20
           + uDetailAmp * ridged(p * uDetailFreq * 0.05 + uSeed, 3);
    }
    vec3 surfaceAlbedo(vec3 p) {
      float craters = ridged(p * 18.0 + uSeed, 4);
      float broad = fbm(p * 4.0 + uSeed, 4, 2.0, 0.5);
      float v = 0.78 + 0.30 * broad + 0.28 * (craters - 0.62);
      return uColor * v;
    }
  `,

  // Icy or dusty satellites with dark plains: the Moon, the outer Galileans,
  // Enceladus, Triton, Charon.
  moon: /* glsl */`
    float surfaceHeight(vec3 p) {
      // Maria are basins -- lower as well as darker, which is why they read as
      // flat plains rather than grey paint.
      float maria = smoothstep(0.10, 0.44, fbmBand(p + uSeed, 2.4, 4, uDetailFreq));
      return ridgedBand(p + uSeed, 24.0, 4, uDetailFreq) * 0.30
           - maria * 0.10
           + fbmBand(p + uSeed, 9.0, 3, uDetailFreq) * 0.10
           + uDetailAmp * ridged(p * uDetailFreq * 0.05 + uSeed, 3);
    }
    vec3 surfaceAlbedo(vec3 p) {
      float maria = smoothstep(0.10, 0.44, fbm(p * 2.4 + uSeed, 4, 2.0, 0.5));
      float craters = ridged(p * 24.0 + uSeed, 4);
      float v = 1.0 - 0.40 * maria;
      v *= 0.84 + 0.32 * fbm(p * 9.0 + uSeed, 3, 2.0, 0.5) + 0.16 * (craters - 0.62);
      return uColor * v;
    }
  `,

  earth: /* glsl */`
    float earthElevation(vec3 p) {
      return fbm(p * 1.9 + 11.0, 6, 2.1, 0.5) + 0.32 * fbm(p * 5.0, 4, 2.0, 0.5);
    }
    float surfaceHeight(vec3 p) {
      float h = earthElevation(p);
      // Oceans are flat. Only land gets relief, and only above the shoreline.
      float land = smoothstep(0.02, 0.09, h);
      return (h - 0.02) * land * 0.5
           + land * (ridgedBand(p, 26.0, 3, uDetailFreq) - 0.6) * 0.10
           + uDetailAmp * land * ridged(p * uDetailFreq * 0.05, 3);
    }
    // Water and ice are mirrors at a glancing angle; rock and vegetation are not.
    float surfaceGloss(vec3 p) {
      float h = earthElevation(p);
      float sea = 1.0 - smoothstep(0.0, 0.05, h);
      float ice = smoothstep(0.72, 0.88, abs(p.y) + 0.10 * fbm(p * 6.0, 3, 2.0, 0.5));
      return max(sea * 0.85, ice * 0.35);
    }
    vec3 surfaceAlbedo(vec3 p) {
      float h = fbm(p * 1.9 + 11.0, 6, 2.1, 0.5) + 0.32 * fbm(p * 5.0, 4, 2.0, 0.5);
      float land = smoothstep(0.02, 0.09, h);
      vec3 ocean = mix(vec3(0.015, 0.075, 0.20), vec3(0.05, 0.22, 0.40),
                       smoothstep(-0.35, 0.02, h));
      float dry = smoothstep(0.20, 0.62, fbm(p * 3.3 + 5.0, 4, 2.0, 0.5));
      vec3 ground = mix(vec3(0.11, 0.28, 0.11), vec3(0.46, 0.38, 0.21), dry);
      ground = mix(ground, vec3(0.30, 0.28, 0.23), smoothstep(0.28, 0.55, h));
      vec3 col = mix(ocean, ground, land);
      float ice = smoothstep(0.72, 0.88, abs(p.y) + 0.10 * fbm(p * 6.0, 3, 2.0, 0.5));
      return mix(col, vec3(0.93, 0.95, 0.98), ice);
    }
  `,

  mars: /* glsl */`
    float surfaceHeight(vec3 p) {
      return fbmBand(p + 2.0, 3.0, 5, uDetailFreq) * 0.30
           + ridgedBand(p, 16.0, 4, uDetailFreq) * 0.22
           + uDetailAmp * ridged(p * uDetailFreq * 0.05, 3);
    }
    vec3 surfaceAlbedo(vec3 p) {
      float d = fbm(p * 3.0 + 2.0, 5, 2.0, 0.5);
      vec3 col = mix(vec3(0.76, 0.37, 0.19), vec3(0.44, 0.21, 0.13),
                     smoothstep(-0.05, 0.30, d));
      col *= 0.86 + 0.28 * ridged(p * 16.0, 4);
      float ice = smoothstep(0.90, 0.975, abs(p.y) + 0.035 * fbm(p * 8.0, 3, 2.0, 0.5));
      return mix(col, vec3(0.93, 0.91, 0.89), ice);
    }
  `,

  // A featureless sulphuric cloud deck; the surface is never visible.
  venus: /* glsl */`
    vec3 surfaceAlbedo(vec3 p) {
      float swirl = fbm(vec3(p.x * 2.0, p.y * 7.0, p.z * 2.0)
                        + vec3(uTime * 0.008, 0.0, 0.0), 5, 2.0, 0.5);
      vec3 col = mix(vec3(0.87, 0.78, 0.60), vec3(0.99, 0.96, 0.87),
                     0.5 + 0.5 * swirl);
      return mix(col, vec3(0.93, 0.88, 0.75), smoothstep(0.80, 1.0, abs(p.y)));
    }
  `,

  jupiter: /* glsl */`
    vec3 surfaceAlbedo(vec3 p) {
      // Domain-warping the latitude is what turns painted stripes into
      // turbulent belts and zones.
      float warp = fbm(vec3(p.x * 2.2, p.y * 3.0, p.z * 2.2), 5, 2.2, 0.55);
      float lat = p.y + 0.05 * warp;
      float bands = 0.5 + 0.5 * sin(lat * 21.0);
      bands = mix(bands, smoothstep(0.28, 0.72, bands), 0.65);
      float fine = fbm(vec3(p.x * 8.0, p.y * 26.0, p.z * 8.0), 4, 2.0, 0.5);
      vec3 col = mix(vec3(0.60, 0.42, 0.29), vec3(0.92, 0.86, 0.71), bands);
      col *= 0.92 + 0.16 * fine;
      col = mix(col, vec3(0.54, 0.48, 0.46), smoothstep(0.80, 0.99, abs(p.y)));

      // The Great Red Spot: 22 degrees south, drifting slowly in longitude.
      float dl = atan(p.z, p.x) - uTime * 0.03;
      dl = atan(sin(dl), cos(dl));
      vec2 sp = vec2(dl * sqrt(max(1.0 - p.y * p.y, 0.0)) * 3.0, (p.y + 0.375) * 6.5);
      float spot = 1.0 - smoothstep(0.30, 1.0, length(sp));
      return mix(col, vec3(0.70, 0.33, 0.21), spot * 0.85);
    }
  `,

  saturn: /* glsl */`
    vec3 surfaceAlbedo(vec3 p) {
      float warp = fbm(vec3(p.x * 1.8, p.y * 2.4, p.z * 1.8), 4, 2.2, 0.55);
      float lat = p.y + 0.035 * warp;
      float bands = 0.5 + 0.5 * sin(lat * 15.0);
      float fine = fbm(vec3(p.x * 7.0, p.y * 20.0, p.z * 7.0), 4, 2.0, 0.5);
      vec3 col = mix(vec3(0.76, 0.66, 0.44), vec3(0.95, 0.90, 0.74), bands);
      col *= 0.94 + 0.12 * fine;
      return mix(col, vec3(0.62, 0.60, 0.56), smoothstep(0.82, 1.0, abs(p.y)));
    }
  `,

  // Uranus and Neptune: almost featureless methane hazes. Neptune's darker
  // storms come from the base colour being deeper blue.
  iceGiant: /* glsl */`
    vec3 surfaceAlbedo(vec3 p) {
      float bands = 0.5 + 0.5 * sin(p.y * 9.0 + 0.6 * fbm(p * 2.0, 4, 2.0, 0.5));
      float storm = smoothstep(0.55, 0.85, fbm(p * 3.4 + uSeed, 4, 2.0, 0.5));
      vec3 col = uColor * (0.90 + 0.14 * bands);
      col = mix(col, uColor * 0.62, storm * 0.5);
      return mix(col, mix(uColor, vec3(1.0), 0.25), smoothstep(0.85, 1.0, abs(p.y)));
    }
  `,

  io: /* glsl */`
    float surfaceHeight(vec3 p) {
      // Io is resurfaced by volcanism faster than craters can accumulate, so it
      // is smooth apart from the volcanic constructs themselves.
      return fbmBand(p, 3.2, 5, uDetailFreq) * 0.10
           + smoothstep(0.32, 0.58, fbmBand(p + 3.0, 7.0, 4, uDetailFreq)) * 0.10
           + uDetailAmp * 0.4 * fbm(p * uDetailFreq * 0.05, 3, 2.0, 0.5);
    }
    vec3 surfaceAlbedo(vec3 p) {
      float a = fbm(p * 3.2, 5, 2.0, 0.5);
      float b = fbm(p * 7.0 + 3.0, 4, 2.0, 0.5);
      vec3 col = mix(vec3(0.82, 0.72, 0.28), vec3(0.96, 0.92, 0.74),
                     smoothstep(-0.22, 0.30, a));
      col = mix(col, vec3(0.58, 0.30, 0.11), smoothstep(0.32, 0.58, b));
      col = mix(col, vec3(0.42, 0.14, 0.08), smoothstep(0.60, 0.80, b));
      return col;
    }
  `,

  titan: /* glsl */`
    vec3 surfaceAlbedo(vec3 p) {
      float h = fbm(p * 2.5, 4, 2.0, 0.5);
      vec3 col = mix(vec3(0.72, 0.48, 0.16), vec3(0.93, 0.74, 0.36), 0.5 + 0.5 * h);
      return mix(col, vec3(0.86, 0.74, 0.50), smoothstep(0.72, 0.96, abs(p.y)));
    }
  `,

  sun: /* glsl */`
    vec3 surfaceAlbedo(vec3 p) {
      float gran = fbm(p * 40.0 + vec3(0.0, uTime * 0.04, 0.0), 4, 2.2, 0.55);
      float spots = smoothstep(0.54, 0.74, fbm(p * 6.0 + 20.0, 4, 2.0, 0.5));
      vec3 col = mix(vec3(1.00, 0.58, 0.16), vec3(1.00, 0.96, 0.84), 0.5 + 0.5 * gran);
      col = mix(col, vec3(0.62, 0.26, 0.09), spots * 0.55);
      // Limb darkening: the disc really is dimmer and redder at the edge,
      // because you are looking through more of the photosphere at a slant.
      float mu = clamp(dot(normalize(vViewNrm), normalize(vViewDir)), 0.0, 1.0);
      col *= 0.40 + 0.60 * pow(mu, 0.55);
      return col * 2.8;   // headroom for the tone mapper
    }
  `,
};


// A shader library and the shaders that use it are separate modules, and a
// browser will happily serve a fresh copy of one beside a stale copy of the
// other. The result is a GLSL link failure whose message ("no matching
// overloaded function") describes the symptom and not the cause, buried in a
// console. Catch the mismatch here, where we can name it.
const REQUIRED_NOISE = ['snoise', 'fbm', 'ridged'];

let noiseChecked = false;
function checkNoiseLibrary() {
  if (noiseChecked) return;
  noiseChecked = true;
  const missing = REQUIRED_NOISE.filter(
    (fn) => !new RegExp(`\\b(float|int|vec[234])\\s+${fn}\\s*\\(`).test(NOISE_GLSL),
  );
  if (missing.length) {
    console.error(
      `[helios] Stale shader library: render/shaders/noise.js is missing `
      + `${missing.join(', ')}. The surface shaders will fail to build and those `
      + `bodies will not render. This is a cached copy of an older file -- `
      + `restart the dev server (./serve.sh, which disables caching) and `
      + `hard-reload with Ctrl+Shift+R.`,
    );
  }
}

// A 1x1 placeholder so the sampler is always bound, even for bodies that have
// no map. Sampling it never happens -- uHasMap gates that -- but leaving a
// sampler unbound is asking for driver-specific trouble.
const BLANK_MAP = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
BLANK_MAP.needsUpdate = true;

const EMISSIVE_STYLES = new Set(['sun']);

// Slope is roughly constant per octave, so these are in units of "how far the
// normal is allowed to swing". Airless rock is rugged; a resurfaced or
// weathered world is smoother; cloud has no solid relief and stays at zero.
const BUMP = {
  rocky: 0.026,
  moon: 0.024,
  mars: 0.018,
  io: 0.010,
  earth: 0.013,
};

export function createBodyMaterial(style, { color = '#ffffff', seed = 0 } = {}) {
  checkNoiseLibrary();
  const body = STYLES[style] ?? STYLES.rocky;
  const main = EMISSIVE_STYLES.has(style) ? FRAG_MAIN_EMISSIVE : FRAG_MAIN_LIT;

  // Styles opt in to relief and shine simply by defining the functions; anything
  // that doesn't gets the flat default, so adding either is a local change.
  const defaults = (body.includes('surfaceHeight') ? '' : DEFAULT_HEIGHT)
                 + (body.includes('surfaceGloss') ? '' : DEFAULT_GLOSS);

  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAG_HEAD + SHADOW_GLSL + defaults + body + main,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uAmbient: { value: 0.015 },       // starlight, barely there
      uSunIntensity: { value: 1 },
      uSeed: { value: seed },
      uCameraObj: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uBumpScale: { value: BUMP[style] ?? 0 },
      uDetailAmp: { value: 0 },
      uDetailFreq: { value: 64 },
      uAtmoColor: { value: new THREE.Color('#ffffff') },
      uAtmoDensity: { value: 0 },
      uMap: { value: BLANK_MAP },
      uHasMap: { value: 0 },
      uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(),
                            new THREE.Vector4(), new THREE.Vector4()] },
      uOccluderCount: { value: 0 },
      uSunAngularRadius: { value: 0.00465 },
    },
  });
}

// --- Atmosphere shell -------------------------------------------------------
//
// A slightly larger sphere carrying the glow that extends BEYOND the planet's
// silhouette -- the part that makes a world look like it has air rather than a
// painted edge. Front faces only, added rather than blended, so it brightens
// what is behind it instead of hiding it.
//
// Two things are being approximated. Depth: near the limb the line of sight
// passes through far more atmosphere, which is the rim term. And direction:
// air scatters forward much more than back, so a backlit limb flares while the
// night side keeps only a thin twilight arc.

const ATMO_FRAG = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform vec3  uAtmoColor;
uniform float uAtmoDensity;
uniform float uSunIntensity;
uniform vec3  uSunDir;
uniform vec3  uCameraObj;
uniform float uRadius;        // the shell
uniform float uPlanetRadius;  // the solid body beneath it
uniform float uScaleHeight;   // e-folding height of the air
varying vec3 vDir;
varying vec3 vNrm;
varying vec3 vViewNrm;
varying vec3 vViewDir;

void main() {
  vec3 p = normalize(vDir);
  vec3 n = normalize(vNrm);
  vec3 P = p * uRadius;
  vec3 V = normalize(uCameraObj - P);

  // Slant path: grazing the limb looks through the most air.
  float rim = 1.0 - max(dot(n, V), 0.0);
  float depth = pow(clamp(rim, 0.0, 1.0), 2.6);

  // Air thins with altitude, so the glow has to fade outward rather than stop
  // at the shell. The impact parameter of the view ray -- its closest approach
  // to the planet's centre -- gives the lowest altitude that ray passes
  // through, and the density there is what sets its brightness. Without this
  // the shell ends in a hard ring, which is the giveaway of a fake atmosphere.
  float impact = length(cross(P, V));
  float altitude = max(impact - uPlanetRadius, 0.0);
  float density = exp(-altitude / uScaleHeight);
  depth *= density;

  // Illumination, wrapped a little past the geometric terminator because air
  // keeps scattering light around the curve -- that is what twilight is.
  float sun = smoothstep(-0.35, 0.25, dot(n, uSunDir));

  // Forward scattering: a limb with the Sun behind it flares brightest.
  float forward = pow(max(dot(V, -uSunDir), 0.0), 8.0);

  float a = uAtmoDensity * depth * (0.12 + 0.88 * sun) * (1.0 + 1.6 * forward);
  a = clamp(a, 0.0, 1.0) * uSunIntensity;
  if (a < 0.004) discard;

  vec3 col = uAtmoColor * (0.55 + 0.45 * sun) + vec3(1.0, 0.92, 0.80) * forward * 0.35;
  gl_FragColor = vec4(col * a, a);
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createAtmosphereMaterial(color, density) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: ATMO_FRAG,
    uniforms: {
      uAtmoColor: { value: new THREE.Color(color) },
      uAtmoDensity: { value: density },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunIntensity: { value: 1 },
      uCameraObj: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uPlanetRadius: { value: 1 },
      uScaleHeight: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// --- Clouds -----------------------------------------------------------------
// A separate translucent shell a little above the surface. Earth only.

export function createCloudMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAG_HEAD + SHADOW_GLSL + DEFAULT_HEIGHT + DEFAULT_GLOSS + /* glsl */`
      void main() {
        vec3 p = normalize(vDir);
        float cover;
        if (uHasMap > 0.5) {
          // A cloud map is white on black, so its brightness is its opacity.
          vec3 c3 = texture2D(uMap, vUv).rgb;
          cover = clamp(max(c3.r, max(c3.g, c3.b)) * 1.15, 0.0, 1.0);
        } else {
          vec3 q = p + vec3(uTime * 0.004, 0.0, 0.0);
          float c = fbm(q * 2.6, 6, 2.2, 0.55) + 0.4 * fbm(q * 7.0, 4, 2.0, 0.5);
          cover = smoothstep(0.06, 0.42, c);
        }
        float ndl = dot(normalize(vNrm), uSunDir);
        float lit = smoothstep(-0.06, 0.14, ndl) * sunVisibility(p * uRadius);
        gl_FragColor = vec4(vec3(1.0) * (lit * uSunIntensity + uAmbient), cover * 0.85);
        #include <logdepthbuf_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uColor: { value: new THREE.Color('#ffffff') },
      uTime: { value: 0 },
      uAmbient: { value: 0.015 },
      uSunIntensity: { value: 1 },
      uSeed: { value: 0 },
      uCameraObj: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uBumpScale: { value: 0 },
      uDetailAmp: { value: 0 },
      uDetailFreq: { value: 64 },
      uAtmoColor: { value: new THREE.Color('#ffffff') },
      uAtmoDensity: { value: 0 },
      uMap: { value: BLANK_MAP },
      uHasMap: { value: 0 },
      uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(),
                            new THREE.Vector4(), new THREE.Vector4()] },
      uOccluderCount: { value: 0 },
      uSunAngularRadius: { value: 0.00465 },
    },
    transparent: true,
    depthWrite: false,
  });
}


// --- Surface maps -----------------------------------------------------------

const textureCache = new Map();
let textureLoader = null;

// Attach a photographic map to a body's material. Asynchronous on purpose: the
// procedural surface renders immediately and the map replaces it when it
// arrives, so a slow or missing file costs nothing but detail.
export function applySurfaceMap(material, path) {
  // The map is an enhancement, never a requirement. Without a DOM there is
  // nothing to decode an image with, so stay procedural -- which keeps the whole
  // model layer usable outside a browser, including in the test runner.
  if (typeof document === 'undefined') return null;

  const url = assetUrl(path);
  let tex = textureCache.get(url);
  if (!tex) {
    textureLoader = textureLoader ?? new THREE.TextureLoader();
    tex = textureLoader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.anisotropy = 8;
        t.needsUpdate = true;
      },
      undefined,
      () => console.warn(`[helios] surface map failed to load: ${url} `
        + '— falling back to the procedural surface'),
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    textureCache.set(url, tex);
  }
  material.uniforms.uMap.value = tex;
  material.uniforms.uHasMap.value = 1;
  return tex;
}
