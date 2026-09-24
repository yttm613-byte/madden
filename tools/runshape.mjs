/* runshape.mjs — the SHAPE of the CPU run game, not just its average.
 *
 *   node tools/runshape.mjs [perPlay=300] [plays=gunzone,zone,...]   (serve the repo on :8106 first)
 *
 * Runs every open-field run in the book (not the sneak or goal-line power) from the CPU's
 * own 40 against the AI defence, with your defender steered by the chase bot, and prints:
 *   - the gain histogram next to the NFL's (the mean hides everything: 3.6 yards a carry
 *     was made of too many stuffs, a fat 5-9 band and almost nothing past 10)
 *   - who made each tackle, at what gain and when ("(bit)" = a safety who bit downhill)
 *   - how many carries that reached 5 yards made 10, and who stopped the ones that did not
 *   - how many 20+ yard carries went the distance
 * PRE='js' is evaluated in the page first (the sim build's __sim.ev), to try a value
 * without editing the game: PRE='PEN_DL=0.04' node tools/runshape.mjs 150
 * VERBOSE=1 adds a line per play (at 300 a play its mean still wanders by half a yard).
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const NP = +(process.argv[2] || 300), PORT = process.env.PORT || 8106;
const IDS = (process.argv[3] || 'gunzone,zone,stretch,counter,dive,sweep,draw,power,iso').split(',');
const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(u => u.hostname !== 'localhost', r => r.abort());
await p.goto('http://localhost:' + PORT + '/index.sim.html', { waitUntil: 'load' });
await p.waitForFunction(() => { try { return window.__sim && window.__sim.ready; } catch (e) { return false; } }, null, { timeout: 60000 });
await p.click('#d-pro');
if (process.env.PRE) await p.evaluate(s => window.__sim.ev(s), process.env.PRE);
const res = [], N = NP * IDS.length;
for (let n0 = 0; n0 < N; n0 += 45) res.push(...await p.evaluate(([N0, NN, IDS]) => {
  const S = window.__sim, PPY = (560 - 52) / 53.3, DT = 1 / 60, out = [];
  for (let n = N0; n < N0 + NN; n++) {
    const G = S.G;
    G.phase = 'playcall'; G.flag = null; G._returning = false; G._retKind = null; G.conv = null; G.twoPt = false; G.fumble = null;
    G._koFlight = false; G._koPhase = null; G._fgFlight = false; G.ball = { active: false }; G._td = false; G._turn = false;
    G.offense = 'cpu'; G.los = 40 * PPY; G.firstX = 50 * PPY; G.down = 1; G.clock = 60; G.qtr = 2;
    const id = IDS[n % IDS.length];
    S.setupPlay(id); G.phase = 'presnap'; G.autoSnap = 99; S.snap(); if (G.phase !== 'live') { n--; continue; }
    const bit = new Set(G.defenders.filter(d => d.bite > 0));
    let t = 0, fum = false;
    while (G.phase === 'live' && t < 15) {
      const c = G.carrier, u = G.userDef;
      if (u && c) { const dx = c.x - u.x, dy = c.y - u.y; S.keys['arrowup'] = dx > 0; S.keys['arrowdown'] = dx < 0; S.keys['arrowright'] = dy > PPY * 0.3; S.keys['arrowleft'] = dy < -PPY * 0.3; S.keys['shift'] = true; }
      if (G.fumble) fum = true;
      S.update(DT); t += DT;
    }
    for (const k of ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']) S.keys[k] = false;
    if (fum || G._turn) continue;
    const tk = G.lastTackler;
    out.push({ id, gain: G._td ? 60 : +((G._spot - 40 * PPY) / PPY).toFixed(2), td: !!G._td, t: +t.toFixed(2),
      tk: G._td ? 'none' : tk ? (tk === G.userDef ? 'YOU' : tk.role) + (bit.has(tk) ? '(bit)' : '') : 'none' });
  }
  return out;
}, [n0, Math.min(45, N - n0), IDS]));
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(0) + '%';
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const tally = a => { const m = {}; for (const r of a) m[r.tk] = (m[r.tk] || 0) + 1; return Object.entries(m).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + ' ' + pct(v, a.length)).join(', '); };
const g = res.map(r => r.gain).sort((a, b) => a - b);
const bins = [[-99, -1], [0, 0.99], [1, 2.99], [3, 4.99], [5, 6.99], [7, 9.99], [10, 14.99], [15, 19.99], [20, 999]];
const lab = ['<=-1', '0', '1-2', '3-4', '5-6', '7-9', '10-14', '15-19', '20+'], nfl = [10, 8, 21, 21, 13, 11, 8, 3, 3];
console.log(`CPU carries ${res.length} (${IDS.length} plays)  mean ${mean(g).toFixed(2)} (NFL ~4.4, a touchdown counted as 60)  median ${g[Math.floor(g.length / 2)]} (3)`);
console.log(`  stuffed ${pct(g.filter(x => x <= 0).length, g.length)} (17-20%)   5+ ${pct(g.filter(x => x >= 5).length, g.length)} (~38%)   10+ ${pct(g.filter(x => x >= 10).length, g.length)} (~11%)   20+ ${pct(g.filter(x => x >= 20).length, g.length)} (~2.5-3%)`);
console.log('  gains, share (NFL): ' + bins.map((b, i) => lab[i] + ' ' + pct(g.filter(x => x >= b[0] && x <= b[1]).length, g.length) + '(' + nfl[i] + ')').join('  '));
const by = {}; for (const r of res) (by[r.tk] = by[r.tk] || []).push(r);
console.log('  tackles: ' + Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([k, a]) => `${k} ${pct(a.length, res.length)} at ${mean(a.map(r => r.gain)).toFixed(1)} yd`).join(' | '));
const r5 = res.filter(r => r.gain >= 5); console.log(`  of the carries that reached 5 yards ${pct(r5.filter(r => r.gain >= 10).length, r5.length)} made 10 (NFL ~30%); the 5-9 yard ones were stopped by: ${tally(r5.filter(r => r.gain < 10))}`);
const r20 = res.filter(r => r.gain >= 20); console.log(`  20+ yard carries ${r20.length}: 20-39 ${r20.filter(r => r.gain < 40).length}, 40+ ${r20.filter(r => r.gain >= 40 && !r.td).length}, touchdowns ${r20.filter(r => r.td).length} (NFL: about 7 in 10 end inside 40, one in ten goes the distance from here)`);
if (process.env.VERBOSE) for (const id of IDS) { const a = res.filter(r => r.id === id).map(r => r.gain); if (a.length) console.log(`  ${id.padEnd(8)} n=${a.length} mean ${mean(a).toFixed(2)} stuffed ${pct(a.filter(x => x <= 0).length, a.length)} 10+ ${pct(a.filter(x => x >= 10).length, a.length)}`); }
console.log('page errors:', errs.length, errs.slice(0, 3));
await b.close();
