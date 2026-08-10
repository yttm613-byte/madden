import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--no-sandbox']});
const p=await b.newPage({viewport:{width:900,height:700}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8106/index.sim.html',{waitUntil:'load'});
await p.waitForFunction(()=>{try{return window.__sim&&window.__sim.ready;}catch(e){return false;}},null,{timeout:40000});
await p.click('#d-pro'); await sleep(800);

const report = await p.evaluate(async ()=>{
  const S=window.__sim, G=()=>S.G, DT=1/60, PPY=(560-52)/53.3;
  const log=[], stats={plays:0,pats:0,fumblesLost:0,runs:0,passes:0,sacks:0,ints:0,fumbles:0,punts:0,fgs:0,tds:0,safeties:0,turnovers:0,incompletions:0,completions:0};
  const problems=[]; const gains=[];
  let lastMsg='', lastPhase='', stuck=0, lastClock=G().clock, lastQtr=G().qtr, guard=0;
  const RUN=['dive','sweep','draw'], PASS=['slants','verticals','screen','playaction'];
  let held=false, throwAt=0, frames=0, defPicked=false;
  const scoring=[]; let pu=G().userScore, pc=G().cpuScore;
  const qtrSeen=new Set(); let halftimeKickTo=null;
  let lastPlay=null; const runGains=[];
  const yacs=[]; let catchX=null, catchOff=null, nearAtCatch=null, yacDone=false;
  // DEFENSE: count frames where the controlled defender is within tackle range of the
  // carrier but no tackle fires — "made contact and he does not go down"
  let touchFrames=0, tackleFired=0, defPlays=0, sawTouch=false, minGap=99; const minGaps=[]; let blockedTouch=0, whiffTouch=0;

  const seen=new Set();
  while(G().phase!=='final' && guard++ < 260000){
    const g=G(), ph=g.phase;
    // ---- scripted "player" ----
    if(ph==='playcall'){
      const fgOK=!document.getElementById('pb-fg').classList.contains('hidden');
      const puntOK=!document.getElementById('pb-punt').classList.contains('hidden');
      // Kick like a coach: only from sensible range, and not on every 4th down.
      const fgYds=(()=>{const t=document.getElementById('fg-label'); const m=t&&t.textContent.match(/(\d+)/); return m?+m[1]:99;})();
      if(fgOK && fgYds<=45 && Math.random()<0.75) S.choosePlay('fg');
      else if(puntOK && Math.random()<0.7) S.choosePlay('punt');
      else { lastPlay=PASS[(Math.random()*4)|0]; S.choosePlay(lastPlay); }
      held=false; throwAt=0;
    } else if(ph==='presnap'){
      if(g.offense==='user'){ S.snap(); stats.plays++; (g.playType==='run')?stats.runs++:stats.passes++; }
      else { if(!defPicked){ S.chooseDef(['blitz','balanced','cover'][(Math.random()*3)|0]); defPicked=true; } }
    } else if(ph==='fg'){
      const f=g.fg;
      if(f){ if(f.stage==='power'&&f.power>f.req+6) S.fgLock(); else if(f.stage==='aim'&&Math.abs(f.aim)<6) S.fgLock(); }
    } else if(ph==='live'){
      defPicked=false;
      if(g.offense==='cpu'){
        // PLAY DEFENSE. The bot used to only call a defensive play and then hold
        // forward, so the CPU offense ran against a defender nobody was steering —
        // which is most of why it scored 7-8 touchdowns a game here.
        const d=g.userDef, c=g.carrier;
        if(d&&c){ const dx=c.x-d.x, dy=c.y-d.y;
          S.keys['arrowup']=dx>0; S.keys['arrowdown']=dx<0;
          S.keys['arrowright']=dy>0; S.keys['arrowleft']=dy<0; S.keys['shift']=true; }
      } else {
      // don't shove the QB across the line while he is still in his drop
      const dropping=(g.playType==='pass'&&g.passState==='drop');
      S.keys['arrowup']=!dropping;
      S.keys['arrowdown']=S.keys['arrowleft']=S.keys['arrowright']=false; S.keys['shift']=false;
      }
      if(g.offense==='user'&&g.playType==='pass'&&g.passState==='drop'){ throwAt+=DT; if(throwAt>0.9){ S.action(); throwAt=0; } }
    } else { S.keys['arrowup']=S.keys['arrowdown']=S.keys['arrowleft']=S.keys['arrowright']=false; S.keys['shift']=false; defPicked=false; }

    // ---- watch for anomalies ----
    const msg=document.getElementById('msg').textContent;
    if(msg && msg!==lastMsg){ lastMsg=msg; log.push({clock:+g.clock.toFixed(1), off:g.offense, msg});
      const M=msg.toUpperCase();
      if(M.includes('SACK')) stats.sacks++;
      if(M.includes('INTERCEPT')) stats.ints++;
      if(M.startsWith('FUMBLE!')) stats.fumbles++;
      if(M.includes('FUMBLE RECOVERED')) stats.fumblesLost++;
      if(M.includes('PUNT IS UP')) stats.punts++;
      if(/(FIELD GOAL|\bFG\b).*(GOOD|NO GOOD)/.test(M)) stats.fgs++;
      if(/EXTRA POINT (IS GOOD|MISSED)/.test(M)) stats.pats++;
      if(M.includes('TOUCHDOWN')) stats.tds++;
      if(M.includes('SAFETY')) stats.safeties++;
      if(M.includes('TURNOVER')) stats.turnovers++;
      if(M.includes('INCOMPLETE')) stats.incompletions++;
      if(M.includes('CAUGHT')||M==='CPU CATCH') stats.completions++;
      const ym=msg.match(/([+-]?\d+)\s*YD/);
      if(ym&&M.includes('TACKLED')){ gains.push(parseInt(ym[1]));
        if(lastPlay) runGains.push({play:lastPlay, yd:parseInt(ym[1])}); }
    }
    // stuck detection
    if(ph===lastPhase){ stuck++; if(stuck>60*90){ problems.push('STUCK in phase "'+ph+'" for 90s of game time'); break; } }
    else { stuck=0; lastPhase=ph; }
    // sanity checks on state
    const c=g.carrier;
    if(c && (!isFinite(c.x)||!isFinite(c.y))) { problems.push('carrier position became non-finite'); break; }
    if(c && (c.x/PPY < -5 || c.x/PPY > 125)) seen.add('carrier off the field at x='+(c.x/PPY).toFixed(0)+'yd');
    // the clock legitimately resets at a quarter boundary; only flag it going up WITHIN a quarter
    if(g.qtr===lastQtr && g.clock>lastClock+0.001) seen.add('clock went UP from '+lastClock.toFixed(1)+' to '+g.clock.toFixed(1));
    lastClock=g.clock; lastQtr=g.qtr;
    if(g.down<1||g.down>4) seen.add('illegal down value: '+g.down);
    if(g.userScore<0||g.cpuScore<0) seen.add('negative score');

    { const g2=G(), d=g2.userDef, c=g2.carrier;
      if(g2.phase==='live' && g2.offense==='cpu' && d && c){
        const gap=Math.hypot(d.x-c.x,d.y-c.y)/9.53;
        if(gap<minGap) minGap=gap;
        // frames spent INSIDE the nominal tackle radius without the play ending
        if(gap<1.5){ touchFrames++; if(!sawTouch){ sawTouch=true; defPlays++; } }
        if(gap<1.5){ if((d.blocked||0)>0) blockedTouch++; if((d.whiff||0)>0) whiffTouch++; }
      }
      if(g2.phase!=='live'){ if(minGap<9){ minGaps.push(+minGap.toFixed(2)); } minGap=99; sawTouch=false; }
    }
    if(G().userScore!==pu||G().cpuScore!==pc){
      scoring.push({who:G().userScore!==pu?'user':'cpu', pts:(G().userScore-pu)||(G().cpuScore-pc), msg:lastMsg.slice(0,40)});
      pu=G().userScore; pc=G().cpuScore; }
    { const g3=G();
      // passState stays 'caught' into the dead phase, so without a once-per-play latch
      // this re-records the same completion every frame at 0 YAC and buries the median.
      if(g3.phase==='presnap') yacDone=false;
      if(!yacDone && catchX===null && g3.phase==='live' && g3.passState==='caught' && g3.carrier && g3.carrier.role==='wr'){
        catchX=g3.carrier.x; catchOff=g3.offense;   // WHOSE catch — the two are not comparable
        nearAtCatch=g3.defenders.length? Math.min(...g3.defenders.map(d=>Math.hypot(d.x-g3.carrier.x,d.y-g3.carrier.y)))/9.53 : 0;
      }
      if(catchX!==null && g3.phase!=='live'){
        if(g3.carrier) yacs.push({off:catchOff, yac:+((g3.carrier.x-catchX)/9.53).toFixed(1), near:+(nearAtCatch||0).toFixed(1)});
        catchX=null; nearAtCatch=null; yacDone=true;
      } }
    qtrSeen.add(G().qtr);
    if(G().qtr===3 && halftimeKickTo===null && G()._koFlight) halftimeKickTo=G().offense;
    S.update(DT); frames++;
  }
  return {stats, gains, scoring, runGains, yacs, touchFrames, defPlays, minGaps, blockedTouch, whiffTouch, quarters:[...qtrSeen], halftimeKickTo, problems:[...problems,...seen], finalScore:{you:G().userScore,cpu:G().cpuScore},
          phase:G().phase, clockLeft:+G().clock.toFixed(1), simFrames:frames, logTail:log.slice(-14), logLen:log.length};
});
console.log('=== FULL GAME SIMULATION ===');
console.log('final:', JSON.stringify(report.finalScore), '| phase:', report.phase, '| clock left:', report.clockLeft, '| frames:', report.simFrames);
console.log('\nplay mix:', JSON.stringify(report.stats));
if(report.gains&&report.gains.length){ const g=report.gains;
  console.log('yards per carry/catch: n='+g.length+'  avg='+(g.reduce((a,x)=>a+x,0)/g.length).toFixed(1)+
    '  min='+Math.min(...g)+'  max='+Math.max(...g)+'  over10='+g.filter(x=>x>=10).length); }
// where the points actually came from, counted from score deltas not messages
{ const sc=report.scoring||[]; const by={};
  for(const e of sc){ const k=e.who+' +'+e.pts; by[k]=(by[k]||0)+1; }
  const u=sc.filter(e=>e.who==='user').reduce((a,e)=>a+e.pts,0);
  const c=sc.filter(e=>e.who==='cpu').reduce((a,e)=>a+e.pts,0);
  console.log('\nscoring breakdown (user '+u+', cpu '+c+', total '+(u+c)+'  | NFL total ~45):');
  for(const k of Object.keys(by).sort()) console.log('   ', k, 'x'+by[k]); }
console.log('YAC:', JSON.stringify(report.yacs));
{ const mg=report.minGaps||[];
  const inside=mg.filter(x=>x<1.5).length;
  console.log('DEF: plays where your defender got inside the 1.5yd tackle radius:', inside, 'of', mg.length);
  console.log('     frames spent inside it without a tackle firing:', report.touchFrames,
              '(blocked on', report.blockedTouch, 'of them, whiffed on', report.whiffTouch+')');
  console.log('     closest approach per play, sorted:', mg.slice().sort((a,b)=>a-b).slice(0,12).join(' ')); }
console.log('quarters played:', JSON.stringify(report.quarters), ' second-half kickoff received by:', report.halftimeKickTo);
console.log('\nevents logged:', report.logLen);
console.log('last events:'); for(const l of report.logTail) console.log('   ', l.clock, l.off, '|', l.msg);
console.log('\nPROBLEMS FOUND:', report.problems.length);
for(const pr of report.problems) console.log('   !', pr);
console.log('\npage errors:', errs.length, errs.slice(0,5).join(' | ')||'none');
await b.close();
