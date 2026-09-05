// Guard against a trap this codebase has now fallen into twice: a backtick
// inside a GLSL template literal — almost always in a comment quoting an
// identifier — silently ends the string, and the rest of the shader is parsed as
// JavaScript. The error you get names a token deep in the GLSL and points
// nowhere useful.
//
//   node tests/lint-glsl.mjs
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const files = globSync('src/**/*.js');
const bad = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // Walk each /* glsl */` … ` literal, respecting the real terminator.
  let i = 0;
  while ((i = src.indexOf('/* glsl */`', i)) !== -1) {
    const start = i + '/* glsl */`'.length;
    let j = start;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') break;
      j++;
    }
    const line = src.slice(0, start).split('\n').length;
    const body = src.slice(start, j);
    // A well-formed literal ends at a backtick followed by ; , or )
    const after = src.slice(j + 1, j + 2);
    if (!';,)'.includes(after.trim() || ';')) {
      bad.push(`${f}:${line} GLSL literal ends oddly (next char ${JSON.stringify(after)})`);
    }
    if (/\bvoid main\b|\bfloat \w+\(/.test(src.slice(j + 1, j + 400))
        && !/^\s*[;,)]/.test(src.slice(j + 1))) {
      bad.push(`${f}:${line} GLSL appears to continue past the closing backtick `
        + `— a stray backtick inside the literal?`);
    }
    i = j + 1;
  }
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log(`${files.length} files scanned — no stray backticks in GLSL literals`);
