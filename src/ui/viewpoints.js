import * as THREE from 'three';
import { AU } from '../solar/data.js';

// Places where true scale says something a diagram cannot.
//
// Each of these exists to make one specific fact unavoidable: that the gap to
// the Moon is thirty Earths wide, that the Sun and Moon really do look the same
// size from here, that from Pluto the Sun is just the brightest star in the sky.

const ORIGIN = new THREE.Vector3(0, 0, 0);

export function createViewpoints(system, flycam) {
  // Stand just above a body's surface, on the side facing what we came to see.
  function surfaceView(id, lookAt, fov, altitudeFactor = 1.04) {
    const body = system.byId.get(id);
    const dir = new THREE.Vector3().subVectors(lookAt, body.worldPos).normalize();
    const r = body.renderRadius ?? body.def.radius;
    flycam.placeAt(body, dir.multiplyScalar(r * altitudeFactor), lookAt, fov);
  }

  return [
    {
      name: 'The Earth–Moon gap',
      apply: () => {
        const earth = system.byId.get('earth');
        const moon = system.byId.get('moon');
        const sep = new THREE.Vector3().subVectors(moon.worldPos, earth.worldPos);
        // View the gap side-on, from whichever side is sunlit -- the other side
        // is geometrically identical and completely black, which makes for a
        // truthful but useless picture.
        const side = new THREE.Vector3(0, 1, 0).cross(sep).normalize();
        if (!isFinite(side.x) || side.lengthSq() < 0.5) side.set(1, 0, 0);
        const sunward = earth.worldPos.clone().negate().normalize();
        if (side.dot(sunward) < 0) side.negate();
        const mid = sep.clone().multiplyScalar(0.5);
        // Pulled in as close as the gap will allow: Earth and the Moon end up
        // near opposite edges of the frame, which is the whole point.
        const offset = mid.clone().add(side.multiplyScalar(sep.length() * 0.62));
        flycam.placeAt(earth, offset, earth.worldPos.clone().add(mid), 62);
      },
    },
    {
      name: 'The Sun from Earth',
      // Zoomed in, because at a normal field of view half a degree is four
      // pixels. The readout still reports the true angular size.
      apply: () => surfaceView('earth', ORIGIN, 6),
    },
    {
      name: 'The Sun from Pluto',
      // Barely zoomed: from out here the Sun is simply the brightest star, and
      // magnifying it away would hide exactly what there is to see.
      apply: () => surfaceView('pluto', ORIGIN, 20),
    },
    {
      name: 'Saturn’s rings',
      apply: () => {
        const saturn = system.byId.get('saturn');
        const offset = new THREE.Vector3(1, 0.17, 0.55)
          .normalize().multiplyScalar((saturn.renderRadius ?? saturn.def.radius) * 6.5);
        flycam.placeAt(saturn, offset, saturn.worldPos);
      },
    },
    {
      name: 'Jupiter’s moons',
      apply: () => {
        const jupiter = system.byId.get('jupiter');
        // Close enough for Jupiter to read as a disc, far enough that
        // Callisto's 1.88 million km orbit still fits in frame.
        const offset = new THREE.Vector3(0.35, 0.42, 1).normalize().multiplyScalar(2.6e6);
        flycam.placeAt(jupiter, offset, jupiter.worldPos, 62);
      },
    },
    {
      name: 'Inside the belt',
      // Parked in the thick of the main belt. The dots suggest a swarm; the
      // "nearest rock" readout tells you how far away the closest one really
      // is, which is the entire point of coming here.
      apply: () => {
        const sun = system.byId.get('sun');
        flycam.placeAt(sun, new THREE.Vector3(2.7 * AU, 0.04 * AU, 0),
                       new THREE.Vector3(0, 0.04 * AU, -1e9), 62);
      },
    },
    {
      name: 'The belt from above',
      // High enough to hold Jupiter's orbit in frame, so the Kirkwood gaps and
      // the two Trojan clouds sixty degrees ahead of and behind it are visible
      // at once.
      apply: () => {
        flycam.placeAt(system.byId.get('sun'),
                       new THREE.Vector3(0, 1.55e9, 0.35e9), ORIGIN, 55);
      },
    },
    {
      name: 'The whole system',
      apply: () => {
        flycam.placeAt(system.byId.get('sun'), new THREE.Vector3(0, 5.2e9, 3.4e9), ORIGIN);
      },
    },
  ];
}
