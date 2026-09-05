import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { keplerianPosition, eclipticToWorld } from './kepler.js';
import { assetUrl } from '../core/assets.js';
import { L2_FRACTION } from './data.js';

// Craft: the things here that are not worlds.
//
// Everything else in Helios is a sphere it generates. These are not, so they are
// the assets whose GEOMETRY is worth loading rather than just their textures.
//
// They are also the sharpest true-scale statements in the model. The station is
// 109 m against a 12,756 km Earth — one part in 117,000. The telescope's
// sunshield is 21 m, and it sits a million and a half kilometres away. From any
// distance at which Earth looks like a planet, both are far below a pixel.

const _v = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _ecl = { x: 0, y: 0, z: 0 };

// Where each kind of craft is, at a given moment.
const PLACEMENT = {
  // A Keplerian ellipse in the parent's equatorial frame. The node hangs off the
  // planet's tilt frame, so this is a local position.
  orbiter(def, jd, system, out) {
    keplerianPosition(def, jd, _ecl);
    eclipticToWorld(_ecl, out);
  },

  // A halo about the Sun–Earth L2 point. Nothing orbits L2 — it is a balance
  // point, not a body — so this is computed in absolute terms and the node hangs
  // off the scene root.
  //
  // L2 lies directly opposite the Sun as seen from Earth, at a fixed fraction of
  // Earth's heliocentric distance, so it breathes in and out over the year as
  // Earth's own distance varies between perihelion and aphelion.
  lagrange(def, jd, system, out) {
    const earth = system.byId.get('earth');
    const r = earth.worldPos.length();
    if (r < 1) { out.set(0, 0, 0); return; }

    // A frame at L2: x away from the Sun, z along the ecliptic pole, y the way
    // Earth is travelling.
    _x.copy(earth.worldPos).divideScalar(r);
    _z.set(0, 1, 0);
    _y.crossVectors(_z, _x).normalize();
    _z.crossVectors(_x, _y).normalize();

    const h = def.halo;
    const theta = (2 * Math.PI * jd) / h.period + h.phase;
    out.copy(earth.worldPos).addScaledVector(_x, r * L2_FRACTION);
    out.addScaledVector(_x, -h.alongAxis * Math.cos(theta));
    out.addScaledVector(_y, h.inPlane * Math.sin(theta));
    out.addScaledVector(_z, h.outOfPlane * Math.cos(theta));
  },
};

// Where each kind of craft's node belongs in the scene graph.
const ATTACH = {
  orbiter: (def, system) => system.byId.get(def.parent).tiltFrame,
  lagrange: (def, system) => system.root,
};

// One directional light serves every craft. They all sit within a couple of
// million km of Earth, which is about one percent of the way to the Sun, so the
// direction sunlight arrives from differs between them by well under a degree.
// Giving each its own light would simply double the brightness.
let sharedLight = null;
let sharedFill = null;

function ensureLighting(scene) {
  if (sharedLight) return;
  sharedLight = new THREE.DirectionalLight(0xfff4e6, 4.2);
  sharedLight.target = new THREE.Object3D();
  scene.add(sharedLight, sharedLight.target);
  // A little fill, standing in for earthshine: anything in low orbit has a very
  // bright planet filling half its sky.
  sharedFill = new THREE.AmbientLight(0x35506e, 1.1);
  scene.add(sharedFill);
  sharedLight.visible = false;
  sharedFill.visible = false;
}

export class Spacecraft {
  constructor(system, scene, def) {
    this.system = system;
    this.scene = scene;
    this.def = def;
    this.loaded = false;
    this.loading = false;

    ensureLighting(scene);

    this.orbitNode = new THREE.Group();
    ATTACH[def.kind](def, system).add(this.orbitNode);

    this.record = system.addCraft({
      def,
      orbitNode: this.orbitNode,
      tiltFrame: this.orbitNode,
      spinFrame: this.orbitNode,
      worldPos: new THREE.Vector3(),
      renderRadius: def.radius,
      kind: 'craft',
      parentRecord: system.byId.get(def.parent),
      localPos: new THREE.Vector3(),
      mesh: null,
    });
  }

  // Tens of megabytes of geometry is not something to pay for on startup when
  // the thing is far below a pixel from anywhere but close up.
  ensureLoaded() {
    if (this.loaded || this.loading) return;
    this.loading = true;
    new GLTFLoader().load(
      assetUrl(this.def.model),
      (gltf) => {
        const root = gltf.scene;
        // Scale so the longest axis matches the real craft, and centre it.
        const box = new THREE.Box3().setFromObject(root);
        const span = Math.max(...box.getSize(_v).toArray());
        root.scale.setScalar(this.def.modelSpan / span);
        box.setFromObject(root);
        root.position.sub(box.getCenter(_v));
        root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

        this.orbitNode.add(root);
        this.model = root;
        this.record.mesh = root;
        this.loaded = true;
        this.loading = false;
        sharedLight.visible = true;
        sharedFill.visible = true;
      },
      undefined,
      (err) => {
        this.loading = false;
        console.warn(`[helios] could not load ${this.def.name}:`, err?.message ?? err);
      },
    );
  }

  // Position only. This MUST run before the camera moves, in the same pass as
  // the planets. The camera can be riding a craft, and reading a position
  // computed a frame ago is not a subtle error here: the ISS covers 7.66 km/s,
  // which is more than its own 109 m length between frames. Worse, the error is
  // proportional to the frame time, and real frame times jitter by a few
  // milliseconds — so the craft shakes by tens of metres. It reads as violent
  // jitter and is purely an ordering mistake, invisible in any single frame.
  updatePosition(jd) {
    PLACEMENT[this.def.kind](this.def, jd, this.system, this.orbitNode.position);
    this.record.localPos.copy(this.orbitNode.position);

    if (this.def.kind === 'orbiter') {
      // One face toward the planet, as the real station flies.
      const p = this.record.localPos;
      this.orbitNode.rotation.y = Math.atan2(p.x, p.z);
    } else {
      // The sunshield always faces the Sun; that is what the whole design is for.
      this.orbitNode.lookAt(0, 0, 0);
    }

    this.orbitNode.updateMatrixWorld(true);
    this.orbitNode.getWorldPosition(this.record.worldPos);
  }

  // Everything that depends on where the camera ended up.
  updateVisuals(cameraPos) {
    const range = cameraPos.distanceTo(this.record.worldPos);
    if (!this.loaded && range < 200) this.ensureLoaded();

    if (this.loaded && sharedLight) {
      // three takes a directional light's direction as (position - target), and
      // shades with the vector pointing TOWARDS the light. So the light sits on
      // the Sun's side of the craft — closer to the origin, where the Sun is.
      // On the far side it lights the night face, which looks like a silhouette.
      sharedLight.target.position.copy(this.record.worldPos);
      sharedLight.position.copy(this.record.worldPos).multiplyScalar(1 - 1e-4);
      sharedLight.target.updateMatrixWorld();
    }
  }
}
