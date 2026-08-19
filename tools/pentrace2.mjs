/* pentrace2.mjs — penalty rate and correctness.
 * NFL: ~13 accepted penalties a game over ~125 plays, about one play in ten. This
 * game plays ~40 snaps, so the same per-play rate should give roughly four a game.
 * Also checks the enforcement: an offensive foul walks the ball BACK and replays the
 * down, a defensive automatic first down resets to 1st, and down/LOS stay legal. */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pkg;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--no-sandbox']});
const p=await b.newPage({viewport:{width:520,height:400}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8106/index.sim.html',{waitUntil:'load'});
await p.waitForFunction(()=>window.__sim&&window.__sim.ready,null,{timeout:60000});
await p.click('#d-pro'); await sleep(600);

console.log(JSON.stringify(await p.evaluate(()=>{
  const S=window.__sim,G=S.G,DT=1/60;
  const RUN=['dive','sweep','draw'], PASS=['slants','verticals','screen','playaction'];
  const out={games:0, plays:0, flags:{}, declined:0, problems:[], enforce:[]};
  const msgEl=document.getElementById('msg');
  let lastMsg='', guard=0, throwAt=0, defPicked=false;
  let pendingFlag=null, beforeLos=null, beforeDown=null;
  while(out.games<3 && guard++<900000){
    const ph=G.phase;
    if(ph==='playcall'){
      const fgOK=!document.getElementById('pb-fg').classList.contains('hidden');
      const puntOK=!document.getElementById('pb-punt').classList.contains('hidden');
      if(fgOK && Math.random()<0.5) S.choosePlay('fg');
      else if(puntOK && Math.random()<0.7) S.choosePlay('punt');
      else S.choosePlay((Math.random()<0.5?RUN:PASS)[(Math.random()*3)|0]);
      throwAt=0;
    } else if(ph==='presnap'){
      if(G.offense==='user'){ beforeLos=G.los; beforeDown=G.down; S.snap(); out.plays++; }
      else if(!defPicked){ S.chooseDef(['blitz','balanced','cover'][(Math.random()*3)|0]); defPicked=true; }
    } else if(ph==='fg'){
      const f=G.fg; if(f){ if(f.stage==='power'&&f.power>f.req+6) S.fgLock(); else if(f.stage==='aim'&&Math.abs(f.aim)<6) S.fgLock(); }
    } else if(ph==='live'){
      defPicked=false;
      if(G.offense==='cpu'){ const d=G.userDef,c=G.carrier;
        if(d&&c){ S.keys['arrowup']=c.x>d.x; S.keys['arrowdown']=c.x<d.x; S.keys['arrowright']=c.y>d.y; S.keys['arrowleft']=c.y<d.y; S.keys['shift']=true; } }
      else { const dropping=(G.playType==='pass'&&G.passState==='drop');
        S.keys['arrowup']=!dropping; S.keys['arrowdown']=S.keys['arrowleft']=S.keys['arrowright']=false; S.keys['shift']=false;
        if(dropping){ throwAt+=DT; if(throwAt>0.9){ S.action(); throwAt=0; } } }
    } else { S.keys['arrowup']=S.keys['arrowdown']=S.keys['arrowleft']=S.keys['arrowright']=false; defPicked=false; }

    // watch the flag from the moment it is thrown until the down is reset
    if(G.flag && !pendingFlag){ pendingFlag={name:G.flag.name, on:G.flag.on, auto:!!G.flag.auto1st,
      los:G.los, down:G.down, firstX:G.firstX}; }

    const msg=msgEl.textContent;
    if(msg && msg!==lastMsg){ lastMsg=msg;
      if(/FLAG —|FALSE START|OFFSIDE|HOLDING|FACE MASK|ROUGHING|INTERFERENCE/.test(msg)){
        const key=msg.replace(/^FLAG — /,'').split('  ')[0];
        out.flags[key]=(out.flags[key]||0)+1;
      }
      if(/PENALTY DECLINED/.test(msg)) out.declined++;
    }
    // once the flag has cleared and we are back to a live down, record enforcement
    if(pendingFlag && !G.flag && (G.phase==='playcall'||G.phase==='presnap')){
      const f=pendingFlag; pendingFlag=null;
      const moved=(G.los-f.los)/9.53;
      out.enforce.push({on:f.on, auto:f.auto, movedYds:+moved.toFixed(1), downWas:f.down, downNow:G.down});
      if(f.on==='off' && moved>0.5) out.problems.push('offensive foul moved the ball FORWARD '+moved.toFixed(1));
      if(f.on==='def' && moved<-0.5) out.problems.push('defensive foul moved the ball BACK '+moved.toFixed(1));
      if(f.auto && G.down!==1) out.problems.push('automatic first down left it at down '+G.down);
    }
    if(G.down<1||G.down>4) out.problems.push('illegal down '+G.down);
    if(G.phase==='final'){ out.games++; S.G.phase='start'; window.__sim.G.userScore=0; location.reload; break; }
    S.update(DT);
  }
  out.games=Math.max(1,out.games);
  return out;
}),null,1));
console.log('ERRORS',errs.length,errs.slice(0,3).join(' | ')||'none');
await b.close();
