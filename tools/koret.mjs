/* koret.mjs — kickoff return distance, measured the same way punt returns were.
 * Forces the CPU to return every time: with the user returning, the harness presses
 * no keys and the returner stands still, which reads as a string of 0-yard returns. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--no-sandbox']});
const p=await b.newPage({viewport:{width:520,height:400}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8106/index.sim.html',{waitUntil:'load'});
await p.waitForFunction(()=>window.__sim&&window.__sim.ready,null,{timeout:60000});

console.log(JSON.stringify(await p.evaluate(()=>{
  const S=window.__sim,G=S.G,dt=1/60,PPY=9.53,out=[];
  for(let k=0;k<24;k++){
    G.phase='dead'; G.fumble=null;
    S.startKickoff('cpu');                       // CPU receives, so cpuRunAI returns it
    const startX=G._retStart; let muff=false, cush=null, why='', fielded=false, alive=0;
    for(let i=0;i<60*16;i++){
      const wasFlight=G._koFlight; S.update(dt);
      if(wasFlight&&!G._koFlight){ fielded=true; muff=!!G.fumble;
        cush=G.carrier?Math.min(...G.defenders.map(d=>Math.hypot(d.x-G.carrier.x,d.y-G.carrier.y)))/PPY:null; }
      if(fielded) alive+=dt;
      if(G.phase!=='live'){ why=(document.getElementById('msg')||{}).textContent||''; break; }
    }
    out.push({ret:G.carrier?+((G.carrier.x-startX)/PPY).toFixed(1):null,
      cush:cush!=null?+cush.toFixed(1):null, alive:+alive.toFixed(2), muff, why:why.slice(0,30)});
  }
  return out;
}),null,1));
console.log('ERRORS',errs.length,errs.slice(0,3).join(' | ')||'none');
await b.close();
