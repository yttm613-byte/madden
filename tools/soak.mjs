/* soak.mjs — a bot plays whole games through the real UI and game loop.
 *
 *   node tools/soak.mjs <exhibition|season|twop|practice> [games=1] [seed=1]   (serve the repo on :8106 first)
 *
 * It picks plays and coverages by clicking the real cards, snaps, throws touch and
 * bullet passes, runs, jukes, chases the ball on defense and kicks field goals, for
 * both sides in a two-player game. Math.random is seeded, so a failure reproduces.
 * Reports page errors, stuck states (nothing changes for 90 sim seconds), NaN
 * positions, time spent in each phase, and the final scores. After the many features
 * that interlock (intro, weather, two players, practice, season progression), run all
 * four modes before shipping.
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const MODE = process.argv[2] || 'exhibition';     // exhibition | season | twop | practice
const GAMES = +(process.argv[3] || 1), SEED = +(process.argv[4] || 1);
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 640 } });
await p.addInitScript((SEED) => { let a = SEED * 7919; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { localStorage.clear(); } catch (e) {} }, SEED);
await p.route(u => u.hostname !== 'localhost', r => r.abort());
const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
p.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
await p.goto('http://localhost:' + (process.env.PORT || 8106) + '/index.test.html', { waitUntil: 'load' });
await p.waitForFunction(() => { try { return window.__gb && window.__gb.ready; } catch (e) { return false; } }, null, { timeout: 90000 });
await p.evaluate(() => { window.__gbNoDraw = true; window.__gbToss = null; });
if (MODE === 'exhibition') await p.click('#d-pro');
else if (MODE === 'season') {
  // SEASONAT=n presets n finished games (all wins), so a short run crosses into the title
  // game, the offseason and the next season
  const at = +(process.env.SEASONAT || 0);
  if (at) await p.evaluate((at) => { const opp = ['HCS', 'IVM', 'PRS', 'DSV', 'NSW', 'BCB', 'CAP']; localStorage.setItem('gb-season', JSON.stringify({ results: opp.slice(0, at).map(o => ({ opp: o, you: 21, them: 10 })), over: false })); }, at);
  await p.click('#d-season'); await p.evaluate(() => { window.__soakNext = true; }); }
else if (MODE === 'twop') await p.click('#d-2p');
else if (MODE === 'practice') await p.click('#d-practice');
await p.evaluate(() => {
  const gb = window.__gb;
  window.__bot = { simT: 0, key: null, keyT: 0, stuck: [], nan: 0, phases: {}, plays: 0, tds: 0, fgs: 0, punts: 0, ints: 0, sacks: 0, games: 0, finals: [], waitT: 0, hold: 1.5, dirT: 0, lat: 0, reported: false, weather: [] };
  window.__botStep = (dt) => {
    const G = gb.G, B = window.__bot, K = gb.keys, TWO = gb.TWO_P;
    B.simT += dt;
    const key = G.phase + '|' + G.offense + '|' + G.down + '|' + Math.round(G.los) + '|' + (G.passState || '') + '|' + (G._koPhase || '');
    if (key !== B.key) { B.key = key; B.keyT = 0; B.reported = false; } else B.keyT += dt;
    if (B.keyT > 90 && !B.reported) { B.reported = true;
      B.stuck.push({ at: B.simT.toFixed(0), phase: G.phase, off: G.offense, down: G.down, conv: G.conv, convChoice: G.convChoice, twoPt: G.twoPt, ko: G._koFlight, koPhase: G._koPhase, paused: G.paused, needDef: G.needDef,
        playcallShown: !document.getElementById('playcall').classList.contains('hidden'), defShown: !document.getElementById('defcall').classList.contains('hidden'), fgShown: !document.getElementById('fg').classList.contains('hidden'),
        msg: document.getElementById('msg').textContent, clock: G.clock, qtr: G.qtr }); }
    B.phases[G.phase] = (B.phases[G.phase] || 0) + dt;
    for (const k of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']) K[k] = false;
    if (G.paused) { gb.togglePause(false); return; }
    const off = document.getElementById('offseason');
    if (off && !off.classList.contains('hidden')) { B.offseasons = (B.offseasons || 0) + 1; const cards = [...off.querySelectorAll('.pro')]; if (cards[1]) cards[1].click(); if (cards[4]) cards[4].click(); document.getElementById('off-go').click(); return; }
    const vis = id => !document.getElementById(id).classList.contains('hidden');
    const humanOff = G.offense === 'user' || TWO, humanDef = G.offense === 'cpu' || TWO;
    const offKeys = (TWO && G.offense === 'cpu') ? ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'] : (TWO ? ['w', 's', 'a', 'd'] : ['arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
    const defTeam = G.offense === 'user' ? 'cpu' : 'user';
    const defKeys = (TWO && defTeam === 'cpu') ? ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'] : (TWO ? ['w', 's', 'a', 'd'] : ['arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
    if (G.phase === 'final') { if (!B.finalSeen) { B.finalSeen = true; B.finalT = 0; B.games++; B.finals.push(G.userScore + '-' + G.cpuScore);
        B.progress = (document.getElementById('final-sub').textContent.match(/PLAYER PROGRESS/) ? 'yes' : 'no'); B.progs = (B.progs || []).concat(B.progress); }
      B.finalT += dt; if (window.__soakNext && B.finalT > 1.0 && B.finalT < 1.05) document.getElementById('again').click();
      return; }
    B.finalSeen = false;
    if (G.phase === 'playcall' && vis('playcall')) {
      B.waitT += dt; if (B.waitT < 0.3) return; B.waitT = 0;
      const cards = [...document.querySelectorAll('#playcall .oc')].filter(e => !e.classList.contains('hidden'));
      const kick = cards.filter(e => e.dataset.play === 'fg' || e.dataset.play === 'punt');
      let pick = (kick.length && Math.random() < 0.8) ? kick[(Math.random() * kick.length) | 0] : cards[(Math.random() * cards.length) | 0];
      if (Math.random() < 0.25) { const tabs = [...document.querySelectorAll('#pc-tabs .tab')]; tabs[(Math.random() * tabs.length) | 0].click(); return; }
      if (pick) { if (pick.dataset.play === 'punt') B.punts++; pick.click(); B.plays++; }
      return; }
    if (G.phase === 'presnap') {
      if (vis('defcall')) { B.waitT += dt; if (B.waitT < 0.3) return; B.waitT = 0; const c = [...document.querySelectorAll('#defcall .dc')]; c[(Math.random() * c.length) | 0].click(); return; }
      if (humanOff) { B.waitT += dt; if (B.waitT > 0.6 + Math.random() * 0.6) { B.waitT = 0; B.hold = 0.7 + Math.random() * 2.2; gb.snap(); } }
      return; }
    if (G.phase === 'fg') { const f = G.fg; if (f && Math.random() < 0.04) gb.fgLock(); return; }
    if (G.phase !== 'live') return;
    const c = G.carrier; if (!c) return;
    if (!isFinite(c.x) || !isFinite(c.y) || (G.ball && G.ball.active && (!isFinite(G.ball.x) || !isFinite(G.ball.y)))) { B.nan++; }
    // offense
    if (humanOff) {
      if (G.playType === 'pass' && G.passState === 'drop') {
        if ((G.playT || 0) > B.hold && !G.windup) { G.sel = (Math.random() * Math.max(1, G.receivers.length)) | 0; gb.setAct(G.offense); gb.throwBall(Math.random() < 0.5 ? 'touch' : 'bullet'); gb.setAct('user'); }
      } else {
        B.dirT -= dt; if (B.dirT <= 0) { B.dirT = 0.3 + Math.random() * 0.8; B.lat = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1); }
        K[offKeys[0]] = true; if (B.lat < 0) K[offKeys[2]] = true; if (B.lat > 0) K[offKeys[3]] = true;
        if (Math.random() < 0.01) { gb.setAct(G.offense); gb.juke(Math.random() < 0.5 ? -1 : 1); gb.setAct('user'); }
      }
    }
    // defense: chase the ball
    if (humanDef && G.userDef) {
      const d = G.userDef, tx = G.ball && G.ball.active ? G.ball.tx : c.x, ty = G.ball && G.ball.active ? G.ball.ty : c.y;
      if (tx > d.x + 3) K[defKeys[0]] = true; else if (tx < d.x - 3) K[defKeys[1]] = true;
      if (ty > d.y + 3) K[defKeys[3]] = true; else if (ty < d.y - 3) K[defKeys[2]] = true;
      if (Math.random() < 0.004) { gb.setAct(defTeam); gb.juke(1); gb.setAct('user'); }
    }
  };
});
const t0 = Date.now(); let lastLog = 0;
for (let chunk = 0; chunk < 400; chunk++) {
  const st = await p.evaluate(() => { const gb = window.__gb; for (let i = 0; i < 1200; i++) { window.__botStep(1 / 60); if (!gb.G.paused && gb.G.phase !== 'start' && gb.G.phase !== 'final') gb.update(1 / 60); if (i % 4 === 0) gb.render3D(); }
    const B = window.__bot, G = gb.G; return { games: B.games, phase: G.phase, q: G.qtr, clock: Math.round(G.clock), score: G.userScore + '-' + G.cpuScore, simT: Math.round(B.simT), stuck: B.stuck.length }; });
  if (Date.now() - lastLog > 15000) { lastLog = Date.now(); console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] sim ${st.simT}s  Q${st.q} ${st.clock}s  ${st.score}  phase ${st.phase}  games ${st.games}  stuck ${st.stuck}`); }
  if (MODE === 'practice' && st.simT > 900) break;
  if (st.games >= GAMES) {
    if (MODE === 'season' && st.games < GAMES) {}
    break; }
  if (st.stuck > 2 || errs.length > 5) break;
}
const B = await p.evaluate(() => { const B = window.__bot, G = window.__gb.G; return { offseasons: B.offseasons || 0, progs: B.progs, team: (() => { try { const t = JSON.parse(localStorage.getItem('gb-team')); return { gp: t.gp, season: t.seasonNo, leadersN: Object.keys(t.stats || {}).length, history: t.history, due: t.offseasonDue }; } catch (e) { return null; } })(), seasonRec: (() => { try { return JSON.parse(localStorage.getItem('gb-season')).results.map(r => r.opp + ' ' + r.you + '-' + r.them).join(', '); } catch (e) { return null; } })(), games: B.games, finals: B.finals, plays: B.plays, punts: B.punts, stuck: B.stuck, nan: B.nan, phases: Object.fromEntries(Object.entries(B.phases).map(([k, v]) => [k, Math.round(v)])), simT: Math.round(B.simT), stats: G.stats && { user: { pass: G.stats.user.passComp + '/' + G.stats.user.passAtt, rush: G.stats.user.rushAtt + '-' + Math.round(G.stats.user.rushYds) }, cpu: { pass: G.stats.cpu.passComp + '/' + G.stats.cpu.passAtt, rush: G.stats.cpu.rushAtt + '-' + Math.round(G.stats.cpu.rushYds) } } }; });
console.log(MODE, 'seed', SEED, JSON.stringify(B, null, 0));
console.log('errors', errs.length, errs.slice(0, 5));
await b.close();
