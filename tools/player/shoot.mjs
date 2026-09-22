/* shoot.mjs — render the player from a set of cameras/poses with headless Chromium.
 *   node tools/player/shoot.mjs <model.glb> <outdir> [shots=front,side,...]
 * Paths are relative to the repo root (served on :8106). */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
import fs from 'fs';
const [model, outdir, which] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:8106/tools/player/view.html', { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready && window.__envReady, null, { timeout: 60000 });
const opts = JSON.parse(process.env.OPTS || '{}');
console.log(await p.evaluate(([u, o]) => window.__load(u, o), ['/' + model, opts]));
const SHOTS = {
  front:   { cam: [[0, 1.2, 4.6], [0, 0.98, 0], 30] },
  side:    { cam: [[4.6, 1.2, 0], [0, 0.98, 0], 30] },
  back:    { cam: [[0, 1.2, -4.6], [0, 0.98, 0], 30] },
  q34:     { cam: [[2.9, 1.5, 3.4], [0, 0.98, 0], 30] },
  face:    { cam: [[0.25, 1.78, 0.95], [0, 1.73, 0], 30] },
  face2:   { cam: [[0, 1.74, 0.75], [0, 1.735, 0], 30] },
  head34:  { cam: [[0.62, 1.82, 0.75], [0, 1.74, 0], 30] },
  hands:   { cam: [[0.9, 1.0, 1.1], [0.3, 0.85, 0], 30] },
  feet:    { cam: [[0.6, 0.35, 0.9], [0, 0.1, 0.05], 30] },
  run:     { pose: ['run', 8, 1.2], cam: [[3.0, 1.3, 3.2], [0, 0.95, 0], 30] },
  run2:    { pose: ['run', 8, 2.8], cam: [[4.4, 1.1, 0.4], [0, 0.95, 0], 30] },
  throw0:  { pose: ['throw', 0, 0, 0], cam: [[2.6, 1.4, 3.2], [0, 1.0, 0], 30] },
  throw1:  { pose: ['throw', 0, 0, 1], cam: [[2.6, 1.4, 3.2], [0, 1.0, 0], 30] },
  tackle:  { pose: ['tackle', 0, 0], cam: [[3.2, 1.2, 2.6], [0, 0.85, 0], 30] },
  set:     { pose: ['set', 0, 0], cam: [[3.0, 1.1, 3.0], [0, 0.8, 0], 30] },
  reach:   { pose: ['reach', 0, 0], cam: [[2.4, 1.6, 3.8], [0, 1.2, 0], 30] },
  block:   { pose: ['block', 0, 0], cam: [[3.0, 1.3, 3.0], [0, 1.0, 0], 30] },
  celebrate:{ pose: ['celebrate', 0, 0], cam: [[2.6, 1.5, 3.6], [0, 1.2, 0], 30] },
  kick:    { pose: ['kick', 0, 0], cam: [[3.6, 1.1, 1.2], [0, 0.9, 0], 30] },
  game:    { cam: [[-9, 6.5, 4], [0, 1.0, 0], 54] },
  sleeve:  { cam: [[0.75, 1.45, 0.55], [0.22, 1.33, -0.02], 30] },
  sleeveB: { cam: [[0.65, 1.05, -0.6], [0.22, 1.33, -0.02], 30] },
  waist:   { cam: [[0.35, 1.15, 0.85], [0.0, 1.07, 0.0], 30] },
  waistB:  { cam: [[0.3, 1.15, -0.85], [0.0, 1.07, 0.0], 30] },
  replay:  { cam: [[-4.5, 2.4, 5.5], [0, 1.1, 0], 54] },
};
const list = (which || 'front,side,back,q34,face,head34,hands,feet').split(',');
for (const s of list) {
  const S = SHOTS[s]; if (!S) { console.log('no shot', s); continue; }
  await p.evaluate(([pose]) => { if (pose) window.__pose(...pose); else window.__pose('none'); }, [S.pose || null]);
  const url = await p.evaluate(([c]) => { window.__cam(...c); return window.__render(); }, [S.cam]);
  fs.writeFileSync(`${outdir}/${s}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
console.log('errors', errs.slice(0, 10));
await b.close();
