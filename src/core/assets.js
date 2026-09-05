// Asset paths are written in data.js relative to the project root, which is the
// only place that reads naturally: 'assets/textures/jupiter.jpg'.
//
// Resolving them against the DOCUMENT would make them mean different things
// depending on which page did the loading -- fine from /index.html, a 404 from
// /tests/anything.html. Resolving against this module's own URL instead makes
// them mean the same thing everywhere, including when the app is served from a
// subdirectory.
const ROOT = new URL('../../', import.meta.url);

export function assetUrl(path) {
  return new URL(path, ROOT).href;
}
