/* runtrace.mjs — the CPU run game, measured.
 *
 *   node tools/runtrace.mjs [carries=300]      (serve the repo on :8106 first)
 *
 * Stages CPU run plays from the CPU's own 40 against the AI defence, with the
 * player's defender steered by a simple bot that chases the ball the way a person
 * does, and reports the gain distribution next to NFL rates.
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const N = +(process.argv[2] || 300);
// BOT=chase   the player's defender sprints straight at the ball (a person who never reads the play)
// BOT=rip     ...and tries the rip move whenever a blocker has him (what a person SHOULD do)
// BOT=none    the player's defender stands still (the AI defence on its own)
const BOT = process.env.BOT || 'rip';
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 600, height: 500 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
// Only the local server: the page tries a CDN first, and a proxy that stalls instead of
// refusing makes 'load' wait 30s before it falls back to the vendored copy.
await p.route(u => u.hostname !== 'localhost', r => r.abort());
await p.goto('http://localhost:' + (process.env.PORT || 8106) + '/index.sim.html', { waitUntil: 'load' });
await p.waitForFunction(() => { try { return window.__sim && window.__sim.ready; } catch (e) { return false; } }, null, { timeout: 60000 });
await p.click('#d-pro');
const r = await p.evaluate(([N, BOT]) => {
  const S = window.__sim, PPY = (560-52)/53.3, DT = 1/60, out = [];
  const plays = ['dive', 'sweep', 'draw'];
  for (let n = 0; n < N; n++) {
    const G = S.G;
    G.phase = 'playcall'; G.flag = null; G._returning = false; G._retKind = null; G.conv = null; G.twoPt = false; G.fumble = null;
    G._koFlight = false; G._koPhase = null; G._fgFlight = false; G.ball = { active: false }; G._td = false; G._turn = false;
    G.offense = 'cpu'; G.los = 40*PPY; G.firstX = 50*PPY; G.down = 1; G.clock = 60; G.qtr = 2;
    const id = plays[n % 3];
    S.setupPlay(id); G.phase = 'presnap'; G.autoSnap = 99;
    S.snap(); if (G.phase !== 'live') { n--; continue; }       // a pre-snap flag: restage
    let t = 0, fum = false;
    while (G.phase === 'live' && t < 20) {
      const d = G.userDef, c = G.carrier;
      if (d && c && BOT !== 'none') { const dx = c.x-d.x, dy = c.y-d.y; S.keys['arrowup'] = dx > 0; S.keys['arrowdown'] = dx < 0; S.keys['arrowright'] = dy > PPY*0.3; S.keys['arrowleft'] = dy < -PPY*0.3; S.keys['shift'] = true;
        if (BOT === 'rip' && ((d.blocked||0) > 0 || d._takenBy) && !(d.diveCd > 0)) S.juke(1); }
      if (G.fumble) fum = true;
      S.update(DT); t += DT;
    }
    for (const k of ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']) S.keys[k] = false;
    if (fum || G._turn) continue;
    // a touchdown never sets the dead-ball spot: score it as the 70 yards it was
    const gain = G._td ? 70 : (G._spot - 40*PPY)/PPY;
    out.push({ id, gain: +gain.toFixed(1), td: !!G._td });
  }
  return out;
}, [N, BOT]);
console.log('defender bot:', BOT);
const g = r.map(x => x.gain).sort((a, b) => a-b);
const pct = f => (100*g.filter(f).length/g.length).toFixed(1)+'%';
const mean = g.reduce((a, x) => a+x, 0)/g.length, med = g[Math.floor(g.length/2)];
console.log(`CPU carries: ${g.length}   mean ${mean.toFixed(2)} yd (NFL 4.3)   median ${med} (NFL ~3)`);
console.log(`  stuffed at/behind the line: ${pct(x => x <= 0)} (NFL ~17-20%)`);
console.log(`  10+ yards: ${pct(x => x >= 10)} (NFL ~11%)    20+ yards: ${pct(x => x >= 20)} (NFL ~2.5%)    touchdowns: ${r.filter(x => x.td).length}`);
console.log(`  min ${g[0]}  p10 ${g[Math.floor(g.length*0.1)]}  p90 ${g[Math.floor(g.length*0.9)]}  max ${g[g.length-1]}`);
for (const id of ['dive', 'sweep', 'draw']) { const a = r.filter(x => x.id === id).map(x => x.gain); if (a.length) console.log(`  ${id.padEnd(6)} n=${a.length} mean ${(a.reduce((s, x) => s+x, 0)/a.length).toFixed(2)}  stuffed ${(100*a.filter(x => x <= 0).length/a.length).toFixed(0)}%  10+ ${(100*a.filter(x => x >= 10).length/a.length).toFixed(0)}%`); }
console.log('page errors:', errs.length);
await b.close();
