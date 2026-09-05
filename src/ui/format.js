import { AU, C_KM_S } from '../solar/data.js';

// Distances here span from metres to tens of AU, so a single format is useless.
// Above a million km the AU figure is added alongside, because "778 million km"
// and "5.2 AU" are each intuitive to different people and neither alone lands.

export function formatDistance(km) {
  if (!isFinite(km)) return '—';
  if (km < 0.001) return `${(km * 1e6).toFixed(0)} mm`;
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 1e4) return `${km.toFixed(km < 100 ? 1 : 0)} km`;
  if (km < 1e6) return `${Math.round(km).toLocaleString()} km`;
  const au = km / AU;
  const big = km >= 1e9
    ? `${(km / 1e9).toFixed(2)} billion km`
    : `${(km / 1e6).toFixed(1)} million km`;
  return au >= 0.01 ? `${big} (${au.toFixed(2)} AU)` : big;
}

export function formatShortDistance(km) {
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 1e6) return `${Math.round(km).toLocaleString()} km`;
  const au = km / AU;
  if (au < 0.01) return `${(km / 1e6).toFixed(2)} Mkm`;
  return `${au.toFixed(au < 10 ? 3 : 2)} AU`;
}

export function lightTime(km) {
  const s = km / C_KM_S;
  if (s < 1e-3) return `${(s * 1e6).toFixed(0)} µs`;
  if (s < 1) return `${(s * 1000).toFixed(0)} ms`;
  if (s < 90) return `${s.toFixed(1)} s`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min`;
  if (s < 86400 * 2) return `${(s / 3600).toFixed(1)} hours`;
  return `${(s / 86400).toFixed(1)} days`;
}

export function formatDate(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}  ${iso.slice(11, 16)} UTC`;
}

// Angular diameter of a body of the given radius seen from a given distance.
export function angularDiameter(radiusKm, distanceKm) {
  const rad = 2 * Math.asin(Math.min(radiusKm / distanceKm, 1));
  const deg = rad * 180 / Math.PI;
  if (deg < 1 / 60) return `${(deg * 3600).toFixed(1)}″`;
  if (deg < 1) return `${(deg * 60).toFixed(1)}′`;
  return `${deg.toFixed(2)}°`;
}
