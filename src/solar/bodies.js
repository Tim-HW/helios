import * as THREE from 'three';
import { SUN, PLANETS, MINOR_PLANETS, MOONS, AU, SOLAR_CONSTANT, J2000 } from './data.js';
import { planetPosition, keplerianPosition, eclipticToWorld } from './kepler.js';
import {
  createBodyMaterial, createCloudMaterial, createAtmosphereMaterial, applySurfaceMap,
} from '../render/material.js';
import { createSaturnRings } from './rings.js';
import { createCorona, createMarker } from '../render/billboards.js';

const DEG = Math.PI / 180;

// Scene graph per body:
//
//   orbitNode        position = orbital position (heliocentric, or parent-relative)
//    +- tiltFrame    axial obliquity only; this is the body's EQUATORIAL frame
//    |   +- spinFrame   sidereal rotation
//    |   |   +- surface mesh, cloud shell
//    |   +- rings       (equatorial, and not spun -- a ring system has no "face")
//    +- moons with ecliptic-referenced orbits hang here instead
//
// Splitting tilt from spin is what lets moons sit in their parent's equatorial
// plane without being dragged around by its rotation. It is why Titan tracks
// Saturn's 26.7 degree tilt and stays in the ring plane, and why Triton's
// retrograde orbit is inclined the way it really is.
//
// One honest limitation: the data carries each planet's obliquity but not the
// direction it leans, so tilt is applied about the ecliptic x-axis for every
// body. Relative geometry within each system is right; the absolute azimuth of
// each pole is not.

const UNIT_SPHERE_HI = new THREE.SphereGeometry(1, 128, 64);
const UNIT_SPHERE_LO = new THREE.SphereGeometry(1, 64, 32);

export class SolarSystem {
  constructor() {
    this.root = new THREE.Group();
    this.bodies = [];
    this.byId = new Map();
    this._sunLocal = new THREE.Vector3();
    this._occluderScratch = [];
    this._occluderLocal = new THREE.Vector3();
    this._ecl = { x: 0, y: 0, z: 0 };

    this._buildSun();
    for (const def of PLANETS) this._buildPlanet(def);
    for (const def of MINOR_PLANETS) this._buildMinorPlanet(def);
    for (const def of MOONS) this._buildMoon(def);
  }

  _register(record) {
    record.worldPos = new THREE.Vector3();
    // The radius the body is DRAWN at. Identical to the true radius until the
    // exaggeration slider is touched, and it is what the camera must navigate
    // against -- otherwise "park at 4.2 radii" puts you inside the mesh, whose
    // back faces are culled, and the planet silently vanishes.
    record.renderRadius = record.def.radius;
    this.bodies.push(record);
    this.byId.set(record.def.id, record);
    return record;
  }

  _makeFrames(def, parentObject) {
    const orbitNode = new THREE.Group();
    parentObject.add(orbitNode);
    const tiltFrame = new THREE.Group();
    tiltFrame.rotation.x = (def.tilt ?? 0) * DEG;
    orbitNode.add(tiltFrame);
    const spinFrame = new THREE.Group();
    tiltFrame.add(spinFrame);
    return { orbitNode, tiltFrame, spinFrame };
  }

  _makeSurface(def, geometry) {
    const material = createBodyMaterial(def.shader, {
      color: def.color,
      seed: hashSeed(def.id),
    });
    if (def.map) applySurfaceMap(material, def.map);
    const mesh = new THREE.Mesh(geometry, material);
    const polar = def.polarRadius ?? def.radius;
    mesh.userData.baseScale = new THREE.Vector3(def.radius, polar, def.radius);
    mesh.scale.copy(mesh.userData.baseScale);
    return mesh;
  }

  // The size-exaggeration slider. Deliberately visual only: distances, orbits,
  // camera speed and every readout keep using the true radii, so the moment you
  // let go of the slider the model is honest again.
  setExaggeration(factor) {
    if (!isFinite(factor) || factor <= 0) factor = 1;
    if (this.exaggeration === factor) return;
    this.exaggeration = factor;
    for (const b of this.bodies) {
      b.renderRadius = b.def.radius * factor;
      for (const mesh of [b.mesh, b.clouds, b.atmo]) {
        if (!mesh) continue;
        mesh.scale.copy(mesh.userData.baseScale).multiplyScalar(factor);
      }
      if (b.rings) b.rings.scale.setScalar(factor);
    }
  }

  _buildSun() {
    const frames = this._makeFrames(SUN, this.root);
    const mesh = this._makeSurface(SUN, UNIT_SPHERE_HI);
    frames.spinFrame.add(mesh);

    const corona = createCorona();
    frames.orbitNode.add(corona);

    const marker = createMarker(SUN.color);
    frames.orbitNode.add(marker);

    this._register({ def: SUN, ...frames, mesh, corona, marker, kind: 'star' });
  }

  // The visible shell of air, a little larger than the body itself. It is what
  // turns a hard painted edge into a world that has a sky.
  _makeAtmosphere(def, frames) {
    if (!def.atmosphere) return null;
    const { color, height, density } = def.atmosphere;
    const mesh = new THREE.Mesh(UNIT_SPHERE_HI, createAtmosphereMaterial(color, density));
    const scale = 1 + height;
    mesh.userData.baseScale = new THREE.Vector3(
      def.radius * scale, (def.polarRadius ?? def.radius) * scale, def.radius * scale,
    );
    mesh.scale.copy(mesh.userData.baseScale);
    mesh.renderOrder = 3;
    frames.spinFrame.add(mesh);
    return mesh;
  }

  _buildPlanet(def) {
    const frames = this._makeFrames(def, this.root);
    const mesh = this._makeSurface(def, UNIT_SPHERE_HI);
    frames.spinFrame.add(mesh);

    let clouds = null;
    if (def.id === 'earth') {
      clouds = new THREE.Mesh(UNIT_SPHERE_HI, createCloudMaterial());
      if (def.cloudMap) applySurfaceMap(clouds.material, def.cloudMap);
      // ~25 km up: high cirrus, and just enough to avoid z-fighting the surface.
      const lift = 1 + 25 / def.radius;
      clouds.userData.baseScale = new THREE.Vector3(
        def.radius * lift, (def.polarRadius ?? def.radius) * lift, def.radius * lift,
      );
      clouds.scale.copy(clouds.userData.baseScale);
      clouds.renderOrder = 1;
      frames.spinFrame.add(clouds);
    }

    let rings = null;
    if (def.rings) {
      rings = createSaturnRings(def.radius);
      frames.tiltFrame.add(rings);
    }

    const atmo = this._makeAtmosphere(def, frames);

    const marker = createMarker(def.color);
    frames.orbitNode.add(marker);

    this._register({ def, ...frames, mesh, clouds, rings, atmo, marker, kind: 'planet' });
  }

  // Heliocentric like a planet, but propagated from single-epoch osculating
  // elements like a moon -- so it gets its own small branch rather than being
  // forced into either.
  _buildMinorPlanet(def) {
    const frames = this._makeFrames(def, this.root);
    const mesh = this._makeSurface(def, UNIT_SPHERE_LO);
    frames.spinFrame.add(mesh);
    const marker = createMarker(def.color);
    frames.orbitNode.add(marker);
    this._register({ def, ...frames, mesh, marker, kind: 'minor' });
  }

  _buildMoon(def) {
    const parent = this.byId.get(def.parent);
    // Equatorial-referenced moons hang off the parent's tilt frame so they
    // inherit its obliquity; the Moon's elements are given against the ecliptic,
    // so it hangs off the unrotated orbit node instead.
    const anchor = def.frame === 'equatorial' ? parent.tiltFrame : parent.orbitNode;
    const frames = this._makeFrames(def, anchor);
    const mesh = this._makeSurface(def, UNIT_SPHERE_LO);
    frames.spinFrame.add(mesh);

    const marker = createMarker(def.color);
    frames.orbitNode.add(marker);

    const atmo = this._makeAtmosphere(def, frames);

    this._register({
      def, ...frames, mesh, atmo, marker, kind: 'moon', parentRecord: parent,
      localPos: new THREE.Vector3(),
    });
  }


  // Which bodies could plausibly come between this one and the Sun.
  //
  // Only ever a handful, and always local: a moon can be eclipsed by its planet
  // or by a sibling moon, a planet by its own moons. Nothing else in the solar
  // system is close enough or big enough to matter -- Venus does transit the Sun
  // as seen from Earth, but it covers a thirty-thousandth of the disc, which is
  // far less than the tone mapping will ever show.
  //
  // Ranked by angular size as seen from the shadowed body, so when there are
  // more candidates than slots, the ones that could actually darken anything win.
  _collectOccluders(b) {
    const out = this._occluderScratch;
    out.length = 0;

    const consider = (o) => {
      if (!o || o === b) return;
      const d = b.worldPos.distanceTo(o.worldPos);
      if (d <= 0) return;
      out.push({ record: o, angular: o.renderRadius / d });
    };

    if (b.kind === 'moon') {
      consider(b.parentRecord);
      for (const other of this.bodies) {
        if (other.kind === 'moon' && other.parentRecord === b.parentRecord) consider(other);
      }
    } else if (b.kind === 'planet' || b.kind === 'minor') {
      for (const other of this.bodies) {
        if (other.kind === 'moon' && other.parentRecord === b) consider(other);
      }
    }

    out.sort((x, y) => y.angular - x.angular);
    return out;
  }

  // --- per-frame update ------------------------------------------------------

  // Split from updateAppearance so the frame can run in the right order:
  // positions first, then the camera (which rides on a body), then everything
  // that depends on where the camera ended up.
  updatePositions(jd) {
    const daysSinceEpoch = jd - J2000;

    for (const b of this.bodies) {
      if (b.kind === 'planet') {
        planetPosition(b.def.elements, jd, this._ecl);
        eclipticToWorld(this._ecl, b.orbitNode.position);
      } else if (b.kind === 'moon') {
        keplerianPosition(b.def, jd, this._ecl);
        eclipticToWorld(this._ecl, b.orbitNode.position);
        b.localPos.copy(b.orbitNode.position);
      } else if (b.kind === 'minor') {
        keplerianPosition(b.def, jd, this._ecl);
        eclipticToWorld(this._ecl, b.orbitNode.position);
      }

      if (b.def.rotationHours) {
        const turns = (daysSinceEpoch * 24) / b.def.rotationHours;
        b.spinFrame.rotation.y = (turns % 1) * Math.PI * 2;
      } else if (b.kind === 'moon') {
        // Tidally locked: the same hemisphere always faces the parent.
        b.spinFrame.rotation.y = Math.atan2(b.localPos.x, b.localPos.z);
      }
    }

    this.root.updateMatrixWorld(true);
    for (const b of this.bodies) b.orbitNode.getWorldPosition(b.worldPos);
  }

  updateAppearance(camera, resolution, options) {
    const realisticLight = !!options.realisticLight;
    const time = options.time ?? 0;
    const showMarkers = options.showMarkers !== false;
    // Half-height of the view at unit distance -- converts an angular size into
    // a size in pixels.
    const pxPerRadian = (resolution.y * 0.5) / Math.tan(camera.fov * DEG * 0.5);

    for (const b of this.bodies) {
      const dist = camera.position.distanceTo(b.worldPos);

      // Illumination. Everything but the Sun is lit from the Sun at the origin.
      const sunDist = b.worldPos.length();
      b.irradiance = sunDist > 0
        ? SOLAR_CONSTANT * (AU / sunDist) ** 2
        : Infinity;
      const intensity = realisticLight && sunDist > 0
        ? Math.min((AU / sunDist) ** 2, 4)
        : 1;

      // Apparent radius of the real body, in pixels. This drives both the
      // navigation markers and the surface detail band below.
      const apparentPx = (b.def.radius / Math.max(dist, 1e-6)) * pxPerRadian;
      b.apparentPx = apparentPx;

      // Procedural level of detail.
      //
      // The scale that matters is the GROUND SAMPLE DISTANCE -- how much surface
      // one pixel covers -- not the body's apparent size. Apparent size
      // saturates as you approach (a disc can only fill so much of the sky), so
      // using it would freeze the detail exactly when you most need it: the
      // difference between 400 km and 4 km up is barely visible in apparent
      // size, but it is a hundredfold in what a pixel covers.
      //
      // At altitude h above radius R, one pixel spans h/pxPerRadian on the
      // ground, and a noise cycle at frequency f spans R/f -- so matching them
      // gives f = R * pxPerRadian / h. Far away h tends to the distance and
      // this reduces to the apparent size in pixels, so one formula covers both.
      const altitude = Math.max(dist - b.def.radius, b.def.radius * 1e-6);
      const detailFreq = Math.min(
        Math.max((b.def.radius * pxPerRadian) / altitude, 32), 2.5e5,
      );
      // The band spans 0.05x to 0.4x of that, staying under Nyquist, and its
      // amplitude falls as 1/frequency so it contributes the same SLOPE as the
      // octaves below it. Held constant, it would swing the normal further and
      // further until the terminator turned to salt and pepper.
      // The coefficient is chosen so the band contributes about the same slope
      // as the base octaves it continues. Too small and close-ups go flat --
      // once you are low enough, the base field's largest features are wider
      // than the whole visible patch and this band is the only relief left.
      const detailFade = smoothstep(150, 600, detailFreq);
      const detailAmp = (detailFade * 6.0) / (detailFreq * 0.05);

      if (b.atmo) {
        const u = b.atmo.material.uniforms;
        u.uRadius.value = b.def.radius * (1 + b.def.atmosphere.height);
        u.uPlanetRadius.value = b.def.radius;
        // Three e-foldings across the visible shell, so the glow has faded to a
        // twentieth of its surface value by the time it reaches the outer edge.
        u.uScaleHeight.value = (b.def.radius * b.def.atmosphere.height) / 3;
        u.uSunIntensity.value = intensity;
        u.uCameraObj.value.copy(camera.position);
        b.spinFrame.worldToLocal(u.uCameraObj.value);
        this._sunLocal.set(0, 0, 0);
        b.spinFrame.worldToLocal(this._sunLocal);
        u.uSunDir.value.copy(this._sunLocal).normalize();
      }

      // Eclipse geometry, shared by the surface and its cloud deck.
      const occluders = this._collectOccluders(b);
      const sunAngular = sunDist > 0 ? SUN.radius / sunDist : 0;

      for (const mesh of [b.mesh, b.clouds]) {
        if (!mesh || !mesh.material || !mesh.material.uniforms
            || !mesh.material.uniforms.uRadius) continue;
        const u = mesh.material.uniforms;
        u.uRadius.value = b.def.radius;
        u.uSunAngularRadius.value = sunAngular;
        const n = Math.min(occluders.length, u.uOccluders.value.length);
        u.uOccluderCount.value = n;
        for (let i = 0; i < n; i++) {
          const o = occluders[i].record;
          this._occluderLocal.copy(o.worldPos);
          b.spinFrame.worldToLocal(this._occluderLocal);
          u.uOccluders.value[i].set(
            this._occluderLocal.x, this._occluderLocal.y, this._occluderLocal.z,
            o.renderRadius,
          );
        }
        if (b.def.atmosphere) {
          u.uAtmoColor.value.set(b.def.atmosphere.color);
          u.uAtmoDensity.value = b.def.atmosphere.density;
        }
        u.uDetailFreq.value = detailFreq;
        u.uDetailAmp.value = detailAmp;
        // Both of these must be expressed in the SPIN frame, because that is
        // the frame the mesh's normals and noise coordinates live in. Using the
        // tilt frame instead leaves out the body's rotation, which puts the
        // terminator at an arbitrary angle and -- worse -- makes it turn with
        // the surface, so day and night never actually advance.
        //
        // The spin frame is unscaled, so inverting its world matrix gives clean
        // directions; the mesh itself may be squashed for oblateness, which
        // would skew the same operation there.
        u.uCameraObj.value.copy(camera.position);
        b.spinFrame.worldToLocal(u.uCameraObj.value);
        this._sunLocal.set(0, 0, 0);
        b.spinFrame.worldToLocal(this._sunLocal);
        u.uSunDir.value.copy(this._sunLocal).normalize();
        u.uTime.value = time;
        u.uSunIntensity.value = intensity;
      }

      if (b.rings) {
        const u = b.rings.material.uniforms;
        this._sunLocal.set(0, 0, 0);
        b.rings.worldToLocal(this._sunLocal);
        u.uSunDir.value.copy(this._sunLocal).normalize();
        u.uSunIntensity.value = intensity;
      }

      b.distance = dist;

      if (b.corona) {
        // The corona is six solar radii wide, but never allowed to shrink below
        // a few pixels -- from Neptune the Sun really is just a very bright
        // star, and this is what that looks like.
        const worldSize = Math.max(b.def.radius * 6, (5 / pxPerRadian) * dist);
        b.corona.material.uniforms.uSize.value = worldSize;
        b.corona.material.uniforms.uCoreFraction.value = b.def.radius / worldSize;
      }

      if (b.marker) {
        // Fade in as the true disc drops under ~4 px, out again as it grows.
        let opacity = showMarkers ? 1 - smoothstep(1.2, 4.0, apparentPx) : 0;
        // Moons only get markers once you are in their parent's neighbourhood,
        // or every Galilean would stack on top of Jupiter from five AU away.
        if (b.kind === 'moon') {
          const parentDist = camera.position.distanceTo(b.parentRecord.worldPos);
          opacity *= 1 - smoothstep(b.def.a * 60, b.def.a * 200, parentDist);
        }
        b.marker.visible = opacity > 0.004;
        b.marker.material.uniforms.uOpacity.value = opacity;
        b.marker.material.uniforms.uResolution.value.set(resolution.x, resolution.y);
      }
    }
  }

  // Distance from a point to the nearest body's SURFACE, which is what the
  // camera uses to scale its speed.
  // Anything that is not a body of the solar system but still needs to be
  // navigable -- currently just the ISS.
  addCraft(record) {
    record.renderRadius = record.def.radius;
    this.bodies.push(record);
    this.byId.set(record.def.id, record);
    const marker = createMarker(record.def.color);
    record.orbitNode.add(marker);
    record.marker = marker;
    return record;
  }

  nearestSurfaceDistance(point) {
    let best = Infinity;
    let nearest = null;
    for (const b of this.bodies) {
      // Measured against what is drawn, not the true size: the camera has to
      // stay outside the geometry it can actually collide with.
      const d = point.distanceTo(b.worldPos) - b.renderRadius;
      if (d < best) { best = d; nearest = b; }
    }
    // `inside` matters to the camera: with speed proportional to the distance
    // ahead, a camera that ends up inside a planet would otherwise be pinned at
    // a crawl with no way back out.
    return { distance: Math.max(best, 0), inside: best < 0, body: nearest };
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function hashSeed(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 10;
}
