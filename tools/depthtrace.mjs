/* depthtrace.mjs — completion rate BY THROW DEPTH.
 * resolveCatch decides purely on separation, so a 45-yard bomb to an open man
 * completes at the same rate as a 3-yard flat. NFL completion % by air yards:
 * 0-9 ~72%, 10-19 ~60%, 20-29 ~45%, 30+ ~33%. Measure ours against that. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--no-sandbox']});
const p=await b.newPage({viewport:{width:520,height:400}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8106/index.sim.html',{waitUntil:'load'});
await p.waitForFunction(()=>window.__sim&&window.__sim.ready,null,{timeout:60000});
await p.click('#d-pro'); await sleep(600);

console.log(JSON.stringify(await p.evaluate(()=>{
  const S=window.__sim,G=S.G,DT=1/60,PPY=9.53,out=[];
  const PASS=['slants','verticals','screen','playaction'];
  const LOS=G.los, FIRST=G.firstX;
  for(let k=0;k<220;k++){
    G.phase='playcall'; G.offense='user'; G.down=1;
    G.los=LOS; G.firstX=FIRST; G.clock=60; G.qtr=1; G.userScore=0; G.cpuScore=0;
    G._koFlight=false; G._koPhase=null; G.fumble=null; G._returning=false; G._retKind=null;
    S.choosePlay(PASS[k%4]); S.snap();
    // hold the drop a varying length of time so routes reach different depths,
    // and cycle which receiver is targeted so it isn't always the same route
    const hold=0.75+((k*0.37)%1.9);
    let t=0, air=null, sep=null, thrown=false, res='';
    for(let i=0;i<60*14;i++){
      if(!thrown && G.passState==='drop' && t>hold){
        G.sel=k%Math.max(1,G.receivers.length); S.action(); thrown=true;
        if(G.ball&&G.ball.active){ air=(G.ball.tx-G.ball.fromX)/PPY;
          const r=G.ball.rec;
          sep=Math.min(...G.defenders.filter(d=>d.job!=='rush'&&!d.fill)
            .map(d=>Math.hypot(d.x-r.x,d.y-r.y)))/PPY; }
      }
      S.update(DT); t+=DT;
      if(G.phase!=='live'||G.passState==='caught'){ res=((document.getElementById('msg')||{}).textContent||''); break; }
    }
    if(thrown && air!=null) out.push({air:+air.toFixed(1), sep:+sep.toFixed(1), res:res.slice(0,18)});
  }
  return out;
}),null,0));
console.log('ERRORS',errs.length,errs.slice(0,3).join(' | ')||'none');
await b.close();
