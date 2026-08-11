/* tacklenow.mjs — the acid test for "I made contact and he does not go down".
 * Teleport the player's defender straight onto the ball carrier on a live play and
 * count how many frames pass before the whistle. Anything above a couple of frames,
 * with a reason attached, is the bug the user keeps reporting. */
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
  const RUN=['dive','sweep','draw'], PASS=['slants','verticals','playaction'];
  const LOS=G.los, FIRST=G.firstX;
  for(let k=0;k<40;k++){
    const isPass=k%2===1;
    G.phase='playcall'; G.offense='cpu'; G.down=1;
    G.los=LOS; G.firstX=FIRST; G.clock=60; G.qtr=1;
    G._koFlight=false; G._koPhase=null; G.fumble=null; G._returning=false; G._retKind=null;
    S.choosePlay((isPass?PASS:RUN)[k%3]); S.chooseDef('balanced'); S.snap();
    // let the play develop, then drop the user's defender right on top of the carrier
    let t=0, planted=false, frames=0, why=null;
    for(let i=0;i<60*14;i++){
      if(!planted && t>(isPass?2.2:0.9) && G.userDef && G.carrier){
        // only plant once the ball is actually in someone's hands
        if(!isPass || G.passState==='caught'||G.passState==='scramble'){
          planted=true;
          G.userDef.x=G.carrier.x; G.userDef.y=G.carrier.y;
          G.userDef.vx=G.carrier.vx; G.userDef.vy=G.carrier.vy;
          why={whiff:+(G.userDef.whiff||0).toFixed(2), blocked:+(G.userDef.blocked||0).toFixed(2),
               catchT:+(G.userDef.catchT||0).toFixed(2), react:+(G.userDef.react||0).toFixed(2)};
        }
      }
      if(planted){ frames++;
        // hold him on the carrier so this measures the tackle rule, not his footspeed
        if(G.userDef&&G.carrier&&G.phase==='live'){ G.userDef.x=G.carrier.x; G.userDef.y=G.carrier.y; } }
      S.update(DT); t+=DT;
      if(G.phase!=='live') break;
    }
    if(planted) out.push({kind:isPass?'pass':'run', frames, sec:+(frames/60).toFixed(2), at:why,
      msg:((document.getElementById('msg')||{}).textContent||'').slice(0,26)});
  }
  return out;
}),null,1));
console.log('ERRORS',errs.length,errs.slice(0,3).join(' | ')||'none');
await b.close();
