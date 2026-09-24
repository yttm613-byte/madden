/* playdiag.mjs — CPU pass plays one at a time, and against each coverage call.
 *
 *   node tools/playdiag.mjs [perPlay=200] [plays=quick,pamax | all]    (serve the repo on :8106 first)
 *
 * Per play: rushers and blockers, completion, net yards, sacks (when, and by whom), and per
 * target (position:route) the throws, air yards, completion, yards after the catch and the
 * separation when the ball arrived, with who was nearest (S/CB/LB + d deep, t a deep-third
 * or quarter corner, m man, z underneath zone). The last line, OVERALL, sums the run: with
 * plays=all and a DEF it is one row of the coverage matrix.
 *   DEF=man|cover2|zone|blitz|firezone|prevent  applies that call (chooseDef) after setupPlay;
 *                                               without it the base defence plays
 *   PRE='js'                                    is evaluated in the page first (__sim.ev)
 *   PORT=8107                                   another server, to A/B against the last commit
 * Your defender is steered by passtrace's bot (to the ball in the air; 0.3s after the catch,
 * at the carrier). 40 a play x 20 plays is ~1.5 minutes; per-play sack rates need 400 a play
 * to separate a few points (at 150 the standard error is ~2.5 points).
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const N = +(process.argv[2] || 200), PORT0 = process.env.PORT || 8106;
const IDS = process.argv[3] === 'all'
  ? [...(await (await fetch('http://localhost:' + PORT0 + '/index.html')).text()).matchAll(/^\s{4}(\w+):\s*\{form:'\w+', kind:'pass'(?![^\n]*special)/gm)].map(m => m[1])
  : (process.argv[3] || 'quick').split(',');
const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(u => u.hostname !== 'localhost', r => r.abort());
await p.goto('http://localhost:' + (process.env.PORT || 8106) + '/index.sim.html', { waitUntil: 'load' });
await p.waitForFunction(() => { try { return window.__sim && window.__sim.ready; } catch (e) { return false; } }, null, { timeout: 60000 });
await p.click('#d-pro');
if (process.env.PRE) await p.evaluate(s => window.__sim.ev(s), process.env.PRE);
const res = [];
for (let n0 = 0; n0 < N * IDS.length; n0 += 40) res.push(...await p.evaluate(([N0, NN, IDS, DEF]) => {
  const S = window.__sim, PPY = (560 - 52) / 53.3, DT = 1 / 60, out = [];
  for (let n = N0; n < N0 + NN; n++) {
    const G = S.G, id = IDS[n % IDS.length];
    G.phase = 'playcall'; G.flag = null; G._returning = false; G._retKind = null; G.conv = null; G.twoPt = false; G.fumble = null;
    G._koFlight = false; G._koPhase = null; G._fgFlight = false; G.ball = { active: false }; G._td = false; G._turn = false;
    G.offense = 'cpu'; G.los = 40 * PPY; G.firstX = 50 * PPY; G.down = 1; G.clock = 60; G.qtr = 2;
    S.setupPlay(id); if (DEF) S.chooseDef(DEF); G.phase = 'presnap'; G.autoSnap = 99; S.snap(); if (G.phase !== 'live') { n--; continue; }
    let t = 0, thrown = false, tgt = null, air = null, tt = null, catchX = null, caughtT = null, intc = false, sackT = null, sep = null, near = null;
    const rushers = G.defenders.filter(d => d.job === 'rush').length, blockers = G.blockers.length;
    while (G.phase === 'live' && t < 16) {
      const d = G.userDef, c = G.carrier;
      if (d && c) { const steer = (tx, ty) => { const dx = tx - d.x, dy = ty - d.y; S.keys['arrowup'] = dx > 0; S.keys['arrowdown'] = dx < 0; S.keys['arrowright'] = dy > PPY * 0.3; S.keys['arrowleft'] = dy < -PPY * 0.3; S.keys['shift'] = true; };
        if (G.passState === 'air' && G.ball && G.ball.active) steer(G.ball.tx, G.ball.ty);
        else if (G.passState === 'caught' && caughtT !== null && t - caughtT > 0.3) steer(c.x, c.y); }
      if (G.passState === 'caught' && caughtT === null) caughtT = t;
      if (!thrown && G.passState === 'air') { thrown = true; air = (G.ball.tx - G.los) / PPY; tt = t; const r = G.ball.rec; tgt = r ? (r.pos + ':' + ((r.route && r.route.kind) || r.rkind || '?')) : '?'; }
      if (G.passState === 'caught' && catchX === null && G.carrier && G.carrier.role === 'wr') catchX = G.carrier.x;
      if (G._returning && G._retKind === 'int') intc = true;
      if (G.passState === 'air' && G.ball && G.ball.rec) { let nd = 1e9, nr = null; for (const q of G.defenders) if (q.job !== 'rush' && !q.fill) { const dd = Math.hypot(q.x - G.ball.rec.x, q.y - G.ball.rec.y); if (dd < nd) { nd = dd; nr = q; } } sep = nd / PPY; near = nr ? nr.role + (nr.deep ? 'd' : nr.third ? 't' : nr.assign ? 'm' : 'z') : null; }
      S.update(DT); t += DT;
    }
    const msg = (document.getElementById('msg') || {}).textContent || '';
    const sack = /SACK/.test(msg);
    const spot = G._td && !intc ? 110 * PPY : G._spot;
    for (const k of ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']) S.keys[k] = false;
    out.push({ id, def: G.defCall, rushers, blockers, thrown, tgt, air: air == null ? null : +air.toFixed(1), tt: tt == null ? null : +tt.toFixed(2), caught: catchX != null && !intc, intc, sack, sackT: sack ? +t.toFixed(2) : null, sackBy: sack && G.lastTackler ? G.lastTackler.role : null,
      sep: sep == null ? null : +sep.toFixed(2), near, gain: intc ? 0 : +((spot - 40 * PPY) / PPY).toFixed(1), yac: catchX == null ? null : +((spot - catchX) / PPY).toFixed(1), td: !!G._td && !intc });
  }
  return out;
}, [n0, Math.min(40, N * IDS.length - n0), IDS, process.env.DEF || null]));
const mean = a => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : '-';
for (const id of IDS) {
  const r = res.filter(x => x.id === id), att = r.filter(x => x.thrown), comp = att.filter(x => x.caught);
  console.log(`== ${id}: n=${r.length} rushers ${mean(r.map(x => x.rushers))} blockers ${mean(r.map(x => x.blockers))} comp ${(100 * comp.length / Math.max(1, att.length)).toFixed(0)}% net ${mean(r.map(x => x.gain))} sack ${(100 * r.filter(x => x.sack).length / r.length).toFixed(0)}% td ${r.filter(x => x.td).length}`);
  const by = {}; for (const x of att) (by[x.tgt] = by[x.tgt] || []).push(x);
  for (const [k, a] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) { const c = a.filter(x => x.caught);
    console.log(`   ${k.padEnd(12)} ${String(a.length).padStart(4)} thr  air ${mean(a.map(x => x.air))}  comp ${(100 * c.length / a.length).toFixed(0)}%  YAC ${mean(c.map(x => x.yac))}  gain/att ${mean(a.map(x => x.gain))}  tt ${mean(a.map(x => x.tt))}  sep ${mean(a.map(x => x.sep).filter(x => x != null))} (<0.8 ${a.filter(x => x.sep < 0.8).length}, 0.8-2.2 ${a.filter(x => x.sep >= 0.8 && x.sep <= 2.2).length}, >2.2 ${a.filter(x => x.sep > 2.2).length})`);
    const nn = {}; for (const x of a) nn[x.near] = (nn[x.near] || 0) + 1; console.log('      nearest at arrival: ' + JSON.stringify(nn)); }
  const s = r.filter(x => x.sack); if (s.length) { const w = {}; for (const x of s) w[x.sackBy] = (w[x.sackBy] || 0) + 1; console.log(`   sacks at ${mean(s.map(x => x.sackT))}s by ${JSON.stringify(w)}`); }
  const g = comp.map(x => x.gain).sort((a, b) => a - b); if (g.length) console.log(`   completed gains p25 ${g[Math.floor(g.length * .25)]} p50 ${g[Math.floor(g.length * .5)]} p75 ${g[Math.floor(g.length * .75)]} p90 ${g[Math.floor(g.length * .9)]}  20+ ${g.filter(x => x >= 20).length}  40+ ${g.filter(x => x >= 40).length}`);
}
{ const r = res, att = r.filter(x => x.thrown), comp = att.filter(x => x.caught), deep = att.filter(x => x.air >= 20), dc = deep.filter(x => x.caught);
  const g = comp.map(x => x.gain).sort((a, b) => a - b);
  console.log(`OVERALL ${process.env.DEF || 'base'}: n=${r.length} comp ${(100 * comp.length / Math.max(1, att.length)).toFixed(1)}% net ${mean(r.map(x => x.gain))} sack ${(100 * r.filter(x => x.sack).length / r.length).toFixed(1)}% INT ${(100 * r.filter(x => x.intc).length / Math.max(1, att.length)).toFixed(1)}% td ${(100 * r.filter(x => x.td).length / r.length).toFixed(1)}% | 20+air ${deep.length} comp ${(100 * dc.length / Math.max(1, deep.length)).toFixed(0)}% | YAC med ${(() => { const y = comp.map(x => x.yac).filter(x => x != null).sort((a, b) => a - b); return y.length ? y[Math.floor(y.length / 2)] : '-'; })()} | 40+ gains ${g.filter(x => x >= 40).length}`); }
console.log('errors', errs.length, errs.slice(0, 2));
await b.close();
