// Dates worth visiting.
//
// Every one of these is something the model actually reproduces, found by
// searching the model itself rather than looked up and asserted: the lunar
// eclipse is the moment the Moon is deepest inside Earth's umbra, the perihelion
// is the minimum of Earth's heliocentric distance, the opposition is the minimum
// Earth-Mars separation. If the ephemeris changes, these should be recomputed --
// tests/checks.js asserts the two that carry a physical claim.
//
// Notably absent: a total solar eclipse. The lunar model is good to about 0.7%
// of the Earth-Moon distance, roughly 0.4 degrees seen from Earth, and the
// Moon's disc is 0.26 degrees across -- so the alignment a solar eclipse needs
// is finer than this ephemeris can resolve. Offering one would be staging it.

export const MOMENTS = [
  {
    name: 'Total lunar eclipse',
    when: '2026-03-03T10:53:00Z',
    target: 'moon',
    note: 'The Moon 1.4 of its own radii inside Earth’s shadow.',
  },
  {
    name: 'Io’s shadow on Jupiter',
    when: '2026-08-03T03:00:00Z',
    target: 'jupiter',
    note: 'A black dot crossing the cloud tops, as through a telescope.',
  },
  {
    name: 'Earth at perihelion',
    when: '2027-01-04T00:00:00Z',
    target: 'earth',
    note: 'Closest to the Sun: 147.10 million km, in northern midwinter.',
  },
  {
    name: 'Mars at opposition',
    when: '2027-02-20T00:00:00Z',
    target: 'mars',
    note: 'Just 101 million km away — as close as Mars gets this decade.',
  },
];

// Accepts "2026-03-03", "2026-03-03 10:53", or an ISO string. Always UTC: this
// is an astronomy app, and a local-time date would mean a different sky.
export function parseUtcDate(text) {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?Z?$/,
  );
  if (!m) return null;
  const [, y, mo, d, hh = '0', mi = '0', ss = '0'] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss));
  if (Number.isNaN(date.getTime())) return null;
  // Reject things like 2026-02-31, which Date silently rolls over.
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) return null;
  return date;
}

export function formatUtcInput(date) {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}
