/* returntrace.mjs — kick and punt returns, averaged.
 *
 *   node tools/returntrace.mjs [n=120]          (PORT=8106 by default)
 *
 * CPU returner against the AI coverage, from real kickoffs and punts. NFL averages:
 * kick return ~22-23 yards, punt return ~9.
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const N = +(process.argv[2] || 120);
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 600, height: 500 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
// Only the local server: the page tries a CDN first, and a proxy that stalls instead of
// refusing makes 'load' wait 30s before it falls back to the vendored copy.
await p.route(u => u.hostname !== 'localhost', r => r.abort());
await p.goto('http://localhost:' + (process.env.PORT || 8106) + '/index.sim.html', { waitUntil: 'load' });
await p.waitForFunction(() => { try { return window.__sim && window.__sim.ready; } catch (e) { return false; } }, null, { timeout: 60000 });
await p.click('#d-pro');
const r = await p.evaluate((N) => {
  const S = window.__sim, PPY = (560-52)/53.3, out = { kick: [], punt: [] };
  for (let n = 0; n < 2*N; n++) {
    const G = S.G, kind = n % 2 ? 'punt' : 'kick';
    G.phase = 'playcall'; G.flag = null; G.fumble = null; G.conv = null; G.twoPt = false; G._td = false; G._turn = false; G.clock = 60; G.qtr = 2;
    if (kind === 'kick') S.startKickoff('cpu');
    else { G.offense = 'user'; G.los = 35*PPY; G.firstX = 45*PPY; G.down = 4; G._koFlight = false; S.choosePlay('punt'); }
    let t = 0, muff = false;
    while (G.phase === 'live' && t < 25) { if (G.fumble) muff = true; S.update(1/60); t += 1/60; }
    if (muff || G._turn) continue;
    const msg = (document.getElementById('msg') || {}).textContent || '';
    const m = msg.match(/(\d+) (YD|YDS)/);
    if (G._td) out[kind].push(100); else if (m) out[kind].push(+m[1]);
  }
  return out;
}, N);
for (const k of ['kick', 'punt']) { const a = r[k]; const mean = a.reduce((s, x) => s+x, 0)/Math.max(1, a.length);
  console.log(`${k} returns: n=${a.length} mean ${mean.toFixed(1)} yd  (NFL ${k === 'kick' ? '~22-23' : '~9'})  min ${Math.min(...a)} max ${Math.max(...a)}`); }
console.log('page errors:', errs.length);
await b.close();
