import * as THREE from 'three';

// Travelling between bodies.
//
// Interpolating position linearly across interplanetary distance is unusable:
// you spend four seconds apparently motionless and then slam into the target in
// the last frame, because at 1 AU out a million km of progress is invisible.
//
// So we interpolate the LOGARITHM of the distance instead. Constant progress in
// log space reads as constant apparent motion -- the target grows at a steady
// rate the whole way in, which is what "flying there" should feel like.

const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();

// A viewpoint that frames the body from its sunlit side, slightly above the
// ecliptic so rings and moon orbits read as ellipses rather than edge-on lines.
export function viewpointFor(record, fallbackDir) {
  // Against the drawn radius, so raising the size-exaggeration slider moves the
  // viewpoint out with the geometry instead of leaving the camera inside it.
  const distance = Math.max((record.renderRadius ?? record.def.radius) * 4.2, 1e-3);
  if (record.worldPos.lengthSq() < 1e-6) {
    // The Sun itself: keep whatever side we are already on.
    _dir.copy(fallbackDir).normalize();
  } else {
    // Toward the Sun from the body = the lit hemisphere.
    _dir.copy(record.worldPos).negate().normalize();
    _dir.y += 0.32;
    _dir.normalize();
  }
  return _dir.clone().multiplyScalar(distance);
}

export function lookAtQuaternion(offset, out = new THREE.Quaternion()) {
  // The camera sits at `offset` from the target and looks back at it.
  _m.lookAt(offset, new THREE.Vector3(0, 0, 0), _up);
  return out.setFromRotationMatrix(_m);
}

export class Travel {
  constructor(startOffset, endOffset, startQuat, endQuat, duration = 4.5) {
    this.startOffset = startOffset.clone();
    this.endOffset = endOffset.clone();
    this.startLen = Math.max(startOffset.length(), 1e-6);
    this.endLen = Math.max(endOffset.length(), 1e-6);
    this.startDir = startOffset.clone().divideScalar(this.startLen);
    this.endDir = endOffset.clone().divideScalar(this.endLen);
    this.startQuat = startQuat.clone();
    this.endQuat = endQuat.clone();
    this.duration = duration;
    this.elapsed = 0;
    this.done = false;
  }

  advance(dt, outOffset, outQuat) {
    this.elapsed += dt;
    const raw = Math.min(this.elapsed / this.duration, 1);
    const t = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;

    // Log-space distance, slerped direction.
    const len = Math.exp(
      Math.log(this.startLen) * (1 - t) + Math.log(this.endLen) * t,
    );
    outOffset.copy(this.startDir).lerp(this.endDir, t).normalize().multiplyScalar(len);
    // Turn to face the destination sooner than we arrive, so the last half of
    // the trip is spent watching the body grow rather than watching it swing.
    outQuat.slerpQuaternions(this.startQuat, this.endQuat, Math.min(t * 1.6, 1));

    this.done = raw >= 1;
    return this.done;
  }
}
