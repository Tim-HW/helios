// Getting results out of a headless probe, reliably.
//
// Firefox's --screenshot fires on the load event and then closes the browser, so
// anything asynchronous after that point simply never happens: a texture still
// decoding, a dynamic import still resolving, a fetch in flight. Screenshots of
// half-finished pages cost several debugging rounds before this existed.
//
// The rule that makes probes deterministic:
//   * put resources the probe needs in the MARKUP (an <img> delays load until
//     it is decoded),
//   * do the work synchronously inside a load handler,
//   * hand results back with a synchronous XHR.
//
// Then the browser cannot exit early, because none of it is asynchronous.

export function postProbe(name, body) {
  try {
    const x = new XMLHttpRequest();
    x.open('POST', `/_probe/${name}`, false);   // synchronous on purpose
    x.send(body);
    return x.status;
  } catch (e) {
    return -1;
  }
}

export function postCanvas(name, canvas) {
  return postProbe(name, canvas.toDataURL('image/png'));
}

// Run `fn` once the page has fully loaded, synchronously, so a screenshot or a
// browser exit cannot beat it.
export function onReady(fn) {
  if (document.readyState === 'complete') fn();
  else window.addEventListener('load', fn);
}
