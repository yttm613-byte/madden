/* passtrace.mjs — the passing game, measured from staged dropbacks.
 *
 *   node tools/passtrace.mjs [plays=240]      (serve the repo on :8106 first)
 *
 * CPU: the CPU quarterback's own reads against the AI defence, with the player's
 *      defender steered by a bot (BOT=human, the default): it heads for where the ball
 *      is going while it is in the air and, after the catch — when the game hands you
 *      the man nearest the ball — takes REACT seconds (0.3) to pick him up and chase.
 *      BOT=none leaves him standing still. That is NOT "the AI on its own": the game
 *      switches you to the defender nearest the catch, so it freezes the one man best
 *      placed to make the tackle, and every short completion turns into a long one.
 * YOU: a scripted quarterback who holds the ball 0.8-2.6s and throws to whichever
 *      receiver the game has highlighted as most open — roughly a person who knows
 *      where to look but not when. USERQB=smart instead waits for the highlighted man
 *      to be 2.5 yards clear of everyone (from 0.6s on) and throws by 2.5s regardless.
 * NFL per dropback: completion ~65%, INT ~2.3%, sack ~6.5%, ~6.3 net yards.
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const N = +(process.argv[2] || 240);
const BOT = process.env.BOT || 'human', REACT = +(process.env.REACT || 0.3), USERQB = process.env.USERQB || 'random';
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 600, height: 500 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
// Only the local server: the page tries a CDN first, and a proxy that stalls instead of
// refusing makes 'load' wait 30s before it falls back to the vendored copy.
await p.route(u => u.hostname !== 'localhost', r => r.abort());
await p.goto('http://localhost:' + (process.env.PORT || 8106) + '/index.sim.html', { waitUntil: 'load' });
await p.waitForFunction(() => { try { return window.__sim && window.__sim.ready; } catch (e) { return false; } }, null, { timeout: 60000 });
await p.click('#d-pro');
// PLAYS=all cycles through every pass play in the book (read from index.html)
const ALL = process.env.PLAYS === 'all';
const PASSIDS = ALL ? [...(await (await fetch('http://localhost:' + (process.env.PORT || 8106) + '/index.html')).text())
  .matchAll(/^\s{4}(\w+):\s*\{form:'\w+', kind:'pass'(?![^\n]*special)/gm)].map(m => m[1]) : ['slants', 'verticals', 'screen', 'playaction'];
const CH = 40, res = { cpu: [], user: [] };
for (const SIDE of ['cpu', 'user']) for (let n0 = 0; n0 < N; n0 += CH) {
 const part = await p.evaluate(([N0, NN, BOT, REACT, USERQB, PASS, SIDE]) => {
  const S = window.__sim, PPY = (560-52)/53.3, DT = 1/60;
  const run = (side) => {
    const out = [];
    for (let n = N0; n < N0 + NN; n++) {
      const G = S.G;
      G.phase = 'playcall'; G.flag = null; G._returning = false; G._retKind = null; G.conv = null; G.twoPt = false; G.fumble = null;
      G._koFlight = false; G._koPhase = null; G._fgFlight = false; G.ball = { active: false }; G._td = false; G._turn = false;
      G.offense = side; G.los = 40*PPY; G.firstX = 50*PPY; G.down = 1; G.clock = 60; G.qtr = 2;
      const id = PASS[n % PASS.length];
      S.setupPlay(id); G.phase = 'presnap'; G.autoSnap = 99;
      S.snap(); if (G.phase !== 'live') { n--; continue; }
      const hold = 0.8 + ((n*0.37) % 1.8);
      let t = 0, thrown = false, caught = false, intc = false, sack = false, air = null, catchX = null;
      let caughtT = null;
      while (G.phase === 'live' && t < 16) {
        if (side === 'user' && !thrown && G.passState === 'drop') {
          if (USERQB !== 'smart') { if (t > hold) S.action(); }
          else if (t > 0.6) { const r = G.receivers[G.sel]; let n = 1e9; if (r) for (const q of G.defenders) n = Math.min(n, Math.hypot(q.x-r.x, q.y-r.y));
            if (n > 2.5*PPY || t > 2.5) S.action(); }
        }
        const d = G.userDef, c = G.carrier;
        if (side === 'cpu' && BOT === 'human' && d && c) {
          const steer = (tx, ty) => { const dx = tx-d.x, dy = ty-d.y; S.keys['arrowup'] = dx > 0; S.keys['arrowdown'] = dx < 0;
            S.keys['arrowright'] = dy > PPY*0.3; S.keys['arrowleft'] = dy < -PPY*0.3; S.keys['shift'] = true; };
          if (G.passState === 'air' && G.ball && G.ball.active) steer(G.ball.tx, G.ball.ty);
          else if (G.passState === 'caught' && caughtT !== null && t - caughtT > REACT) steer(c.x, c.y);
        }
        if (G.passState === 'caught' && caughtT === null) caughtT = t;
        if (!thrown && G.passState === 'air') { thrown = true; air = (G.ball.tx - G.los)/PPY; }
        if (G.passState === 'caught' && catchX === null && G.carrier && G.carrier.role === 'wr') { caught = true; catchX = G.carrier.x; }
        if (G._returning && G._retKind === 'int') intc = true;
        S.update(DT); t += DT;
      }
      const msg = (document.getElementById('msg') || {}).textContent || '';
      if (/SACK/.test(msg)) sack = true;
      if (G._returning && G._retKind === 'int') intc = true;
      if (/INTERCEPT|PICKED/.test(msg)) intc = true;
      const scramble = !thrown && !sack;
      // a touchdown never sets the dead-ball spot: it went the 70 yards to the goal line
      const spot = G._td && !intc ? 110*PPY : G._spot;
      const gain = intc ? 0 : ((spot - 40*PPY)/PPY);
      for (const k of ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']) S.keys[k] = false;
      out.push({ id, thrown, caught, intc, sack, scramble, air: air == null ? null : +air.toFixed(1), gain: +gain.toFixed(1), yac: catchX == null ? null : +((spot - catchX)/PPY).toFixed(1), td: !!G._td && !intc });
    }
    return out;
  };
  return run(SIDE);
 }, [n0, Math.min(CH, N - n0), BOT, REACT, USERQB, PASSIDS, SIDE]);
 res[SIDE].push(...part);
}
console.log('defender bot:', BOT, BOT === 'human' ? 'react ' + REACT + 's' : '', '  your QB:', USERQB);
for (const side of ['cpu', 'user']) {
  const r = res[side], att = r.filter(x => x.thrown), comp = att.filter(x => x.caught && !x.intc);
  const pct = (a, b) => (100*a/Math.max(1, b)).toFixed(1)+'%';
  const ypd = r.reduce((s, x) => s + x.gain, 0)/r.length;
  const yac = comp.map(x => x.yac).filter(x => x != null).sort((a, b) => a-b);
  console.log(`   touchdowns ${r.filter(x => x.td).length}`);
  console.log(`${side === 'cpu' ? 'CPU QB   ' : 'YOUR QB  '} dropbacks ${r.length}: completion ${pct(comp.length, att.length)} (NFL ~65%)  INT ${pct(r.filter(x => x.intc).length, att.length)} (2.3%)  sack ${pct(r.filter(x => x.sack).length, r.length)} (6.5%)  scrambles ${pct(r.filter(x => x.scramble).length, r.length)}  net ${ypd.toFixed(2)} yd/dropback (~6.3)  median YAC ${yac.length ? yac[Math.floor(yac.length/2)] : '-'}`);
  const bucket = (lo, hi) => { const a = att.filter(x => x.air != null && x.air >= lo && x.air < hi); const c = a.filter(x => x.caught && !x.intc);
    return `${lo}-${hi === 99 ? '' : hi-1}: ${pct(c.length, a.length)} of ${a.length} (INT ${a.filter(x => x.intc).length})`; };
  console.log(`     by air yards: ${bucket(-9, 10)} | ${bucket(10, 20)} | ${bucket(20, 99)}   (NFL ~72% | ~55% | ~35%)`);
  for (const id of PASSIDS) {
    const a = r.filter(x => x.id === id), at = a.filter(x => x.thrown), c = at.filter(x => x.caught && !x.intc);
    console.log(`     ${id.padEnd(10)} comp ${pct(c.length, at.length).padStart(6)}  net ${(a.reduce((s, x) => s + x.gain, 0)/Math.max(1, a.length)).toFixed(1).padStart(5)} yd  sack ${pct(a.filter(x => x.sack).length, a.length)}`);
  }
}
console.log('page errors:', errs.length, errs.slice(0, 3).join(' | '));
await b.close();
