/* bundlecheck.mjs — load the single-file bundle the way the claude.ai page does and
 * report every page and console error.
 *
 *   node tools/build-artifact.cjs /tmp/gridiron-blitz.html
 *   node tools/bundlecheck.mjs /tmp/gridiron-blitz.html [shot.png]
 *
 * Test the BUNDLE, not index.html: build-artifact rewrites the source (strips the
 * document skeleton, inlines three.js, turns assets into data URIs), and a rewrite can
 * break what index.html gets right. It once deleted '<metalnessmap_fragment>' from the
 * game's own shader patch — every harness passed and the bundle's light model failed to
 * compile. A shader that fails to compile is a CONSOLE error, never a page error.
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
import fs from 'fs';
import path from 'path';
const file = path.resolve(process.argv[2] || 'gridiron-blitz.html'), SHOT = process.argv[3] || '';
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
const errs = []; p.on('pageerror', e => errs.push('page: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
// the publisher supplies the document skeleton; wrap the bundle the same way
const wrapped = file.replace(/\.html$/, '') + '_wrapped.html';
fs.writeFileSync(wrapped, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fs.readFileSync(file, 'utf8') + '</body></html>');
await p.route(u => !u.href.startsWith('file:'), r => r.abort());       // no network, as under the page's CSP
await p.goto('file://' + wrapped, { waitUntil: 'load', timeout: 120000 });
await new Promise(r => setTimeout(r, 12000));                          // both models load
await p.click('#d-pro').catch(e => errs.push('click: ' + e.message));
await new Promise(r => setTimeout(r, 8000));                           // the open, players drawn
if (SHOT) await p.screenshot({ path: SHOT });
console.log('errors:', errs.length);
for (const e of errs.slice(0, 3)) { const L = e.split('\n'); console.log(L.slice(0, 4).join('\n'));
  const m = e.match(/ERROR: 0:(\d+)/); if (m) { const n = +m[1]; console.log(L.filter(l => { const k = parseInt(l); return k >= n - 4 && k <= n + 2; }).join('\n')); } }
fs.unlinkSync(wrapped);
await b.close();
process.exit(errs.length ? 1 : 0);
