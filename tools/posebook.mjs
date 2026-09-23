/* posebook.mjs — render poses from the game's own pose library onto a contact sheet.
 *   node tools/posebook.mjs <specs.json|specs.mjs> <out.png> [cols=4]
 * A spec is {label, players:[{pose,spy,P,x,z,ry,team,bones,phase,throwT}], cam}
 * (or a single player's fields at the top level). The page serves from :8106.
 * Prints each shot's joint positions (hands, feet, hips, head) for numeric checks. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
import fs from 'fs';
import path from 'path';
const [specPath, out, colsArg] = process.argv.slice(2);
let specs;
if (specPath.endsWith('.mjs')) specs = (await import(path.resolve(specPath))).default;
else specs = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const cols = +(colsArg || 4);
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 400, height: 460 } });
const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.route(u => u.hostname !== 'localhost', r => r.abort());
await p.goto('http://localhost:8106/tools/posebook.html', { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready || window.__err, null, { timeout: 90000 });
const err = await p.evaluate(() => window.__err); if (err) { console.error('LOAD ERROR', err); process.exit(1); }
const shots = [];
for (const s of specs) {
  const r = await p.evaluate((s) => { try { return window.__shot(s); } catch (e) { return { err: String(e && e.stack || e) }; } }, s);
  if (r.err) { console.error(s.label, r.err); continue; }
  shots.push({ label: s.label, url: r.url });
  if (process.env.REP) console.log(s.label.padEnd(22), JSON.stringify(r.rep));
}
const pg = await b.newPage({ viewport: { width: 380 * cols, height: 440 * Math.ceil(shots.length / cols) } });
await pg.setContent('<body style="margin:0;font-size:0;background:#000">' + shots.map(s =>
  `<div style="position:relative;display:inline-block;width:380px;height:440px"><img src="${s.url}" style="width:380px;height:440px"><span style="position:absolute;left:6px;top:4px;font:bold 15px sans-serif;color:#fff;text-shadow:0 0 3px #000">${s.label}</span></div>`).join('') + '</body>');
await pg.screenshot({ path: out });
if (errs.length) console.log('errors', errs.slice(0, 6));
await b.close();
