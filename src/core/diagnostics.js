// Make silent rendering failures loud.
//
// This project has no build step, which is mostly a virtue and occasionally a
// trap: the browser will happily serve a stale copy of one module alongside
// fresh copies of the rest. When the stale one is a shader library, the result
// is vicious -- the programs that call its missing functions fail to link while
// every other program still works, so SOME planets keep rendering perfectly and
// others just are not there. Nothing looks broken; things are merely absent.
//
// three.js does report those link failures, but only to the console, which you
// have to have been watching. Put them on the screen instead.

const INTERESTING = /shader|program|glsl|webgl|compile|link|stale/i;

export function installDiagnostics() {
  let banner = null;
  const seen = new Set();

  const show = (text) => {
    if (!banner) {
      banner = document.createElement('div');
      banner.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:200',
        'background:#3a0f0c', 'color:#ffd9d2', 'border-bottom:1px solid #ff8a70',
        'font:12px/1.5 ui-monospace,Menlo,monospace', 'padding:10px 14px',
        'max-height:45vh', 'overflow:auto', 'white-space:pre-wrap',
      ].join(';');
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#ff8a70;font-weight:600;margin-bottom:6px';
      hint.textContent =
        'A shader failed to build — some bodies will be missing entirely. '
        + 'This is usually a stale cached module: hard-reload with Ctrl+Shift+R.';
      banner.appendChild(hint);
      const close = document.createElement('button');
      close.textContent = '✕';
      close.style.cssText = 'position:absolute;top:8px;right:10px;background:none;'
        + 'border:none;color:#ffd9d2;cursor:pointer;font-size:14px';
      close.addEventListener('click', () => banner.remove());
      banner.appendChild(close);
      document.body.appendChild(banner);
    }
    const line = document.createElement('div');
    line.textContent = text;
    banner.appendChild(line);
  };

  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      const text = args.map((a) => (a && a.message) || String(a)).join(' ');
      if (!INTERESTING.test(text)) return;

      // The useful part of a GLSL failure is the ERROR: lines -- the line number
      // and what the compiler could not resolve. Hoist those to the front, then
      // keep a generous slice of the rest. Truncating to a couple of hundred
      // characters, as the obvious version does, cuts off exactly the sentence
      // that identifies the bug.
      const errs = text.split('\n').filter((l) => /^\s*ERROR:/.test(l));
      const summary = errs.length ? errs.join('\n') : text.slice(0, 400);

      // Shader errors repeat once per draw call; report each distinct one once.
      if (seen.has(summary)) return;
      seen.add(summary);
      show(summary);
      if (errs.length) show(text.slice(0, 1500));
    };
  }
}
