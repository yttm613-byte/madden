import { sphere, capsule, sunion, ellipsoid } from './sdf.mjs';
import { surfaceNets, project, makeManifold, manifoldReport } from './mesher.mjs';
import { decimate } from './qem.mjs';
const log = s => console.log(s);
const f = sunion(0.03, sphere([0,0,0],0.1), capsule([0,0,0],[0.2,0.1,0],0.04), ellipsoid([0,-0.1,0.05],[0.06,0.03,0.08]));
let t0 = Date.now();
let m = surfaceNets(f, [-0.2,-0.2,-0.2], [0.3,0.2,0.2], 0.002, { log });
console.log('nets ms', Date.now()-t0); t0 = Date.now();
project(f, m, 0.002); console.log('project ms', Date.now()-t0); t0 = Date.now();
// manifold check
const check = (m) => { const e = new Map(), nv = m.pos.length/3; for (let i=0;i<m.tris.length;i+=3) for (let s=0;s<3;s++){ const a=m.tris[i+s], b=m.tris[i+(s+1)%3]; const k=a<b?a*nv+b:b*nv+a; e.set(k,(e.get(k)||0)+1);} let bad=0, bnd=0; for (const c of e.values()){ if(c>2) bad++; if(c===1) bnd++; } return {edges:e.size, nonManifold:bad, boundary:bnd}; };
console.log('check', check(m)); m = makeManifold(m); console.log('after manifold', manifoldReport(m), 'splits', m.splits);
const d = decimate(m, 4000, { log });
console.log('qem ms', Date.now()-t0, 'check', check(d));
// max deviation from surface
let mx = 0; for (let v=0; v<d.pos.length/3; v++) mx = Math.max(mx, Math.abs(f(d.pos[3*v],d.pos[3*v+1],d.pos[3*v+2])));
console.log('max vertex |sdf| after qem (mm):', (mx*1000).toFixed(3));
{ // locate non-manifold edges in the raw nets output
  const e = new Map(), nv = m.pos.length/3;
  for (let i=0;i<m.tris.length;i+=3) for (let s=0;s<3;s++){ const a=m.tris[i+s], b=m.tris[i+(s+1)%3]; const k=a<b?a*nv+b:b*nv+a; if(!e.has(k)) e.set(k,[]); e.get(k).push(i/3); }
  for (const [k,fs] of e) if (fs.length>2) { const a=Math.floor(k/nv), b=k%nv; console.log('edge',a,b,'at',[...m.pos.slice(3*a,3*a+3)].map(x=>x.toFixed(4)),'faces',fs.map(f=>[...m.tris.slice(3*f,3*f+3)])); }
}
