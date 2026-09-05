import { julianDate, dateFromJulian } from '../solar/kepler.js';

// Simulation time, decoupled from wall-clock time by a warp factor.
//
// Warp is in simulated-seconds per real-second, and runs from 1x (real time) up
// to about 1e7x, where a year passes every few seconds. Anything faster and the
// inner planets alias into a blur.

export const MAX_WARP = 1e7;

export class SimClock {
  constructor(date = new Date()) {
    this.jd = julianDate(date);
    this.warp = 1;
    this.paused = false;
    this.direction = 1;
  }

  advance(realSeconds) {
    if (this.paused) return;
    this.jd += (realSeconds * this.warp * this.direction) / 86400;
  }

  get date() {
    return dateFromJulian(this.jd);
  }

  setDate(date) {
    this.jd = julianDate(date);
  }

  // A human phrase for the current rate, e.g. "1 sec = 3.2 days".
  describeWarp() {
    const s = this.warp;
    if (this.paused) return 'paused';
    let phrase;
    if (s < 60) phrase = `${fmt(s)} sec`;
    else if (s < 3600) phrase = `${fmt(s / 60)} min`;
    else if (s < 86400) phrase = `${fmt(s / 3600)} hours`;
    else if (s < 86400 * 365.25) phrase = `${fmt(s / 86400)} days`;
    else phrase = `${fmt(s / (86400 * 365.25))} years`;
    return `1 sec = ${phrase}${this.direction < 0 ? ' (reverse)' : ''}`;
  }
}

function fmt(v) {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
