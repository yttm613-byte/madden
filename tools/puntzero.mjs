/* puntzero.mjs — why are half of all punt returns exactly 0.0 yards?
 * Records, per return: cushion at the catch, how long the returner lived, how far he
 * got, and the first 12 frames of his x after the ball is fielded. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--no-sandbox']});
const p=await b.newPage({viewport:{width:520,height:400}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8106/index.sim.html',{waitUntil:'load'});
await p.waitForFunction(()=>window.__sim&&window.__sim.ready,null,{timeout:60000});

console.log(JSON.stringify(await p.evaluate(()=>{
  const S=window.__sim, G=S.G; const dt=1/60, PPY=9.53;
  const out=[];
  for(let k=0;k<24;k++){
    G._koFlight=false; G._koPhase=null; G.phase='playcall'; G.down=4;
    G.offense='user';                       // always punt AS the user, so the CPU returns
    S.choosePlay('punt');
    const startX=G._retStart, retTeam=G.offense;
    let fielded=false, frames=[], alive=0, cushion=null, muffed=false, endWhy='', endPhase='';
    let firstTackleDist=null, retKind=G._retKind;
    for(let i=0;i<60*14;i++){
      const wasBall=!!(G.ball&&G.ball.active), wasFlight=G._koFlight;
      S.update(dt);
      if(wasFlight&&!G._koFlight){                    // the frame the ball arrived
        fielded=true;
        cushion=G.carrier?Math.min(...G.defenders.map(d=>Math.hypot(d.x-G.carrier.x,d.y-G.carrier.y)))/PPY:null;
        muffed=!!G.fumble;
      }
      if(fielded){
        alive+=dt;
        if(frames.length<14&&G.carrier) frames.push(+((G.carrier.x-startX)/PPY).toFixed(2));
      }
      if(G.phase!=='live'){ endPhase=G.phase; endWhy=(document.getElementById('msg')||{}).textContent||''; break; }
    }
    out.push({ ret:G.carrier?+((G.carrier.x-startX)/PPY).toFixed(1):null,
      cush:cushion!=null?+cushion.toFixed(1):null, alive:+alive.toFixed(2),
      muffed, retKind, retTeam, endPhase, why:endWhy.slice(0,32), frames });
  }
  return out;
}),null,1));
console.log('ERRORS', errs.length, errs.slice(0,3).join(' | ')||'none');
await b.close();
