/*
 * optimize-model.mjs — rebuild assets/fbplayer_opt.glb from assets/fbplayer_src.glb
 *
 * The players are viewed at broadcast distance, so perceived quality lives in the
 * TEXTURES, not the triangle count. An earlier pass had this backwards (99% of the
 * file was geometry, textures were crushed to 256px). This build flips the budget:
 * simplify the mesh hard, keep the textures large.
 *
 * A UNIFORM ratio is still wrong, because it preserves whatever lopsided
 * distribution the source had. Measured on this model at a flat 25%:
 *
 *     helmet shell   79,038 tris   46% of the entire model
 *     collar/pads    30,138
 *     cleats         13,646
 *     body + arms     ~5,600       <- the only part anyone looks at
 *
 * The helmet is a smooth shell that needs ~3k; the body carries every silhouette
 * and deformation the eye actually tracks, and at 5.6k the arms went faceted.
 * So the budget is now per-part: keep skin/jersey/pants dense, crush the hard
 * shells. Same file size, the triangles just land where they show.
 *
 *   TEX_SIZE   max texture edge in px
 *   GEO_RATIO  default fraction of triangles to keep (parts not in PART_RATIO)
 */
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld, simplify, simplifyPrimitive, resample, textureCompress, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'fs';

const TEX_SIZE  = +(process.env.TEX_SIZE  || 1024);
const GEO_RATIO = +(process.env.GEO_RATIO || 0.13);
const QUALITY   = +(process.env.TEX_Q     || 84);
const OUT       = process.env.OUT || 'assets/fbplayer_opt.glb';

// Fraction of source triangles to keep, per material. Material→body-part mapping was
// measured in-engine (see index.html makePlayer) — the names are not descriptive.
const PART_RATIO = {
  'Bodymat':        1.00,   // skin: arms, legs, neck, hands — every visible deformation
  'shirt_0':        0.85,   // jersey drapes over the pads, holds the silhouette
  'pants':          0.85,
  'Default':        0.60,   // socks
  'Fabric-Linen':   0.60,   // undersleeves
  'Fabric-Silk':    0.60,
  'Mat.3':          0.05,   // helmet shell: smooth, rigid, 128k tris of nothing
  'Plastic_Matte':  0.05,   // collar / neck roll
  'Mat.2_2mat':     0.08,   // belt
  'Mat.8_1':        0.08,   // helmet hardware
  'Mat.2':          0.08,
  'material':       0.10,   // facemask — thin tubes, needs a little more
  'default':        0.10,
  'sepatu_key.obj': 0.18,   // cleats
  'frosted_glass':  0.15,   // visor
};

const io = new NodeIO();
const doc = await io.read('assets/fbplayer_src.glb');

const triCount = (d) => d.getRoot().listMeshes()
  .flatMap(m => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);

const beforeTris = triCount(doc);
const beforeBytes = (await io.writeBinary(doc)).byteLength;

await doc.transform(dedup(), prune(), weld());

// Per-part simplification. simplifyPrimitive() works on one primitive at a time,
// which is what lets the ratio vary by body part instead of applying globally.
await MeshoptSimplifier.ready;
const ERR  = +(process.env.GEO_ERR || 0.02);
const LOCK = process.env.LOCK !== '0';
const kept = {};
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name  = (prim.getMaterial() && prim.getMaterial().getName()) || '';
    const ratio = name in PART_RATIO ? PART_RATIO[name] : GEO_RATIO;
    const before = (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    if (ratio < 1) {
      // Hard shells (helmet, collar, hardware) are rigid and untextured, so the
      // usual guards are what was stopping them: a tight error bound and locked
      // borders held the helmet at 46% of the model no matter what ratio was asked
      // for. Release both for shells; keep them for skin and cloth, where a seam
      // opening up or a silhouette shifting would actually show.
      const shell = ratio <= 0.2;
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio,
        error: shell ? 0.25 : ERR, lockBorder: shell ? false : LOCK });
    }
    const after = (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    const k = kept[name] || (kept[name] = { before: 0, after: 0 });
    k.before += before; k.after += after;
  }
}

// Smooth the SKIN normals across UV seams.
//
// The body mesh has 2,467 of 13,944 vertices sitting at duplicate positions — it was
// stitched together from converted parts, and every UV/material seam splits a vertex.
// Split vertices carry independent normals, so the two halves of a seam shade
// differently and the surface breaks into hard angular facets. That is the shredded
// look on the face and the banding on the arms; it is NOT torn geometry, which is why
// removing every texture map never helped.
//
// Fix: average each vertex normal across all vertices that share a position, then write
// the same normal back to each. Seams shade continuously again, and because the
// vertices stay split the UVs are untouched.
function smoothNormalsAcrossSeams(prim){
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
  if (!pos || !nor) return 0;
  const n = pos.getCount(), acc = new Map(), p = [0,0,0], q = [0,0,0];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, p); nor.getElement(i, q);
    const k = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
    const a = acc.get(k); if (a) { a[0]+=q[0]; a[1]+=q[1]; a[2]+=q[2]; a[3]++; }
    else acc.set(k, [q[0],q[1],q[2],1]);
  }
  let welded = 0;
  for (let i = 0; i < n; i++) {
    pos.getElement(i, p);
    const k = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
    const a = acc.get(k); if (!a || a[3] < 2) continue;
    const L = Math.hypot(a[0],a[1],a[2]) || 1;
    nor.setElement(i, [a[0]/L, a[1]/L, a[2]/L]);
    welded++;
  }
  return welded;
}
// Rebuild the HEAD by denoising it — what a studio does when a scanned head is
// unusable but the body is fine. The head has genuinely torn, spiky polygons (proved
// by rendering it with every texture map removed: the shards remain), so no shading
// trick touches it. Laplacian smoothing moves each vertex toward the average of its
// neighbours, which is the standard operation for exactly this: it collapses spikes
// and scan noise while preserving the overall form.
//
// Two details that matter. Adjacency is built by POSITION, not by vertex index —
// the mesh is split at every seam, so index-based neighbours stop at seam boundaries
// and the tears would survive. And only the head moves; the body is already fine.
function denoiseHead(prim, iters, lambda){
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
  if (!pos || !idx) return 0;
  const n = pos.getCount(), v = [0,0,0];
  let maxY = -1e9, minY = 1e9;
  for (let i = 0; i < n; i++) { pos.getElement(i, v); if (v[1] > maxY) maxY = v[1]; if (v[1] < minY) minY = v[1]; }
  const cut = maxY - (maxY - minY) * 0.17;          // head + a little neck

  // group vertex indices by position so seams are stitched for smoothing purposes
  const key = i => { pos.getElement(i, v); return `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`; };
  const groups = new Map(), keyOf = new Array(n);
  for (let i = 0; i < n; i++) { const k = key(i); keyOf[i] = k;
    let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(i); }

  // neighbour sets between position-groups
  const nb = new Map();
  const link = (a, b) => { let s = nb.get(a); if (!s) nb.set(a, s = new Set()); s.add(b); };
  for (let t = 0; t < idx.getCount(); t += 3) {
    const a = keyOf[idx.getScalar(t)], b = keyOf[idx.getScalar(t+1)], c = keyOf[idx.getScalar(t+2)];
    link(a,b); link(b,a); link(b,c); link(c,b); link(a,c); link(c,a);
  }

  // current position per group, head groups only
  const P = new Map(), head = [];
  for (const [k, ids] of groups) { pos.getElement(ids[0], v); P.set(k, [v[0],v[1],v[2]]);
    if (v[1] >= cut) head.push(k); }

  for (let it = 0; it < iters; it++) {
    const next = new Map();
    for (const k of head) {
      const s = nb.get(k); if (!s || !s.size) continue;
      let x=0,y=0,z=0,c=0;
      for (const m of s) { const q = P.get(m); if (!q) continue; x+=q[0]; y+=q[1]; z+=q[2]; c++; }
      if (!c) continue;
      const p = P.get(k);
      next.set(k, [ p[0]+(x/c-p[0])*lambda, p[1]+(y/c-p[1])*lambda, p[2]+(z/c-p[2])*lambda ]);
    }
    for (const [k, q] of next) P.set(k, q);
  }

  for (const k of head) { const q = P.get(k); for (const i of groups.get(k)) pos.setElement(i, q); }
  return head.length;
}

let smoothed = 0, denoised = 0;
const HEAD_ITERS = +(process.env.HEAD_SMOOTH ?? 16);   // 16 measured best: -11% face shading noise for ~4% head shrink
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives())
    if ((prim.getMaterial() && prim.getMaterial().getName()) === 'Bodymat') {
      // the eyeballs are their own primitive and must not be dragged around
      const isEyes = (prim.getIndices() ? prim.getIndices().getCount()/3 : 0) < 4000;
      if (!isEyes && HEAD_ITERS > 0) denoised += denoiseHead(prim, HEAD_ITERS, 0.55);
      smoothed += smoothNormalsAcrossSeams(prim);
    }

// Bake ambient occlusion into vertex colours.
//
// This is the single biggest thing separating a cheap character from an expensive
// one, and this asset has none — no aoMap at all. Expensive models ship AO baked in,
// which is what puts soft contact shadow in the neck, under the shoulder pads, in the
// armpits, and along every cloth fold. Without it a model reads flat and plastic no
// matter how good the lighting is.
//
// Computing true ray-traced AO offline would need a BVH. Curvature AO gets most of the
// look for a fraction of the work: compare a vertex's normal against the direction to
// the centroid of its neighbours. If the neighbourhood sits IN FRONT of the surface the
// vertex is in a crease and should be dark; if it sits behind, the vertex is on a ridge
// and should stay bright. Written to COLOR_0, which the material multiplies.
function bakeCurvatureAO(prim, strength){
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), idx = prim.getIndices();
  if (!pos || !nor || !idx) return 0;
  const n = pos.getCount(), v = [0,0,0];
  // adjacency by POSITION again, so creases at seams are not missed
  const keyOf = new Array(n), groups = new Map();
  for (let i = 0; i < n; i++) { pos.getElement(i, v);
    const k = `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`;
    keyOf[i] = k; let g = groups.get(k); if (!g) groups.set(k, g = { ids: [], p: [v[0],v[1],v[2]], nb: new Set() }); g.ids.push(i); }
  const link = (a,b) => { const g = groups.get(a); if (g) g.nb.add(b); };
  for (let t = 0; t < idx.getCount(); t += 3) {
    const a = keyOf[idx.getScalar(t)], b = keyOf[idx.getScalar(t+1)], c = keyOf[idx.getScalar(t+2)];
    link(a,b); link(b,a); link(b,c); link(c,b); link(a,c); link(c,a);
  }
  const ao = new Float32Array(n).fill(1);
  const nrm = [0,0,0];
  for (const [k, g] of groups) {
    if (!g.nb.size) continue;
    let cx=0,cy=0,cz=0,c=0;
    for (const m of g.nb) { const q = groups.get(m); if (!q) continue; cx+=q.p[0]; cy+=q.p[1]; cz+=q.p[2]; c++; }
    if (!c) continue;
    let dx=cx/c-g.p[0], dy=cy/c-g.p[1], dz=cz/c-g.p[2];
    const L = Math.hypot(dx,dy,dz); if (L < 1e-9) continue;
    dx/=L; dy/=L; dz/=L;
    nor.getElement(g.ids[0], nrm);
    const concave = dx*nrm[0] + dy*nrm[1] + dz*nrm[2];   // >0 means the surface curves away: a crease
    const shade = 1 - Math.max(0, Math.min(1, concave)) * strength;
    for (const i of g.ids) ao[i] = shade;
  }
  // Blur the AO across the surface before writing it. Raw per-vertex curvature on this
  // mesh is dominated by its own topological noise, and writing it straight out put
  // dark BLOTCHES all over the arms instead of creases. Real occlusion is low
  // frequency, so average it over the neighbourhood until only the big shapes remain.
  { const gao = new Map();
    for (const [k, g] of groups) gao.set(k, ao[g.ids[0]]);
    for (let it = 0; it < 10; it++) {
      const nx = new Map();
      for (const [k, g] of groups) {
        if (!g.nb.size) continue;
        let s = gao.get(k), c = 1;
        for (const m of g.nb) { const q = gao.get(m); if (q !== undefined) { s += q; c++; } }
        nx.set(k, s / c);
      }
      for (const [k, val] of nx) gao.set(k, val);
    }
    for (const [k, g] of groups) { const val = gao.get(k); for (const i of g.ids) ao[i] = val; }
  }
  // COLOR_0 as VEC4; the renderer multiplies it into the base colour
  const arr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { arr[i*4] = arr[i*4+1] = arr[i*4+2] = ao[i]; arr[i*4+3] = 1; }
  const acc = doc.createAccessor().setType('VEC4').setArray(arr).setBuffer(doc.getRoot().listBuffers()[0]);
  prim.setAttribute('COLOR_0', acc);
  return n;
}
const AO_STRENGTH = +(process.env.AO ?? 0.55);
let aoVerts = 0;
if (AO_STRENGTH > 0) {
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const nm = (prim.getMaterial() && prim.getMaterial().getName()) || '';
      // CLOTH ONLY. Baking this on skin put dark blotches all over the arms: the body
      // mesh's own topological noise dominates its curvature, so the AO tracked the
      // noise instead of the anatomy. Cloth has real folds and takes it well; skin
      // gets its form from the normal map instead.
      if (['shirt_0','pants','Default','Fabric-Linen','Fabric-Silk'].includes(nm))
        aoVerts += bakeCurvatureAO(prim, AO_STRENGTH);
    }
}

// NB: no prune() here. Running one after simplification removed the Skin, which
// would leave the model rigid.
await doc.transform(
  resample(),
  // pack vertex attributes into ints (KHR_mesh_quantization) — big byte savings,
  // negligible visual cost. Verified supported by our vendored three r128 loader.
  quantize({ quantizePosition:14, quantizeNormal:10, quantizeTexcoord:12, quantizeWeight:8, quantizeGeneric:12 }),
);

const sharp = (await import('sharp')).default;
await doc.transform(textureCompress({
  encoder: sharp, targetFormat: 'webp', quality: QUALITY, resize: [TEX_SIZE, TEX_SIZE], resizeFilter: 'lanczos3',
}));

let glb = await io.writeBinary(doc);
// gltf-transform can omit the declaration for the quantized attributes it just wrote;
// declare it so strict validators/loaders accept the file.
glb = declareQuantization(Buffer.from(glb));
fs.writeFileSync(OUT, glb);

function declareQuantization(buf){
  const total=buf.readUInt32LE(8); let off=12;
  while(off<total){
    const clen=buf.readUInt32LE(off), ctype=buf.readUInt32LE(off+4);
    if(ctype===0x4E4F534A){                                   // JSON chunk
      const json=JSON.parse(buf.slice(off+8,off+8+clen).toString('utf8'));
      const used=new Set(json.extensionsUsed||[]);
      if(used.has('KHR_mesh_quantization')) return buf;
      used.add('KHR_mesh_quantization'); json.extensionsUsed=[...used];
      let txt=JSON.stringify(json); while(txt.length%4) txt+=' ';   // chunks are 4-byte aligned
      const jsonBuf=Buffer.from(txt,'utf8');
      const head=buf.slice(0,off), tail=buf.slice(off+8+clen);
      const pre=Buffer.alloc(8); pre.writeUInt32LE(jsonBuf.length,0); pre.writeUInt32LE(0x4E4F534A,4);
      const out=Buffer.concat([head,pre,jsonBuf,tail]);
      out.writeUInt32LE(out.length,8);                          // fix total length
      return out;
    }
    off+=8+clen;
  }
  return buf;
}

// report the geometry/texture split so the budget stays honest
let texBytes = 0;
for (const t of doc.getRoot().listTextures()) texBytes += t.getImage().byteLength;
const afterTris = triCount(doc);
console.log(`in : ${(beforeBytes/1e6).toFixed(1)}MB  ${Math.round(beforeTris).toLocaleString()} tris`);
console.log(`out: ${(glb.byteLength/1e6).toFixed(2)}MB  ${Math.round(afterTris).toLocaleString()} tris  @${TEX_SIZE}px`);
console.log(`     textures ${(texBytes/1e6).toFixed(2)}MB (${(100*texBytes/glb.byteLength).toFixed(0)}% of file), geometry ${(100*(glb.byteLength-texBytes)/glb.byteLength).toFixed(0)}%`);
console.log(`     ambient occlusion baked into COLOR_0: ${aoVerts} vertices (strength ${AO_STRENGTH})`);
console.log(`     head denoised: ${denoised} position-groups, ${HEAD_ITERS} iterations`);
console.log(`     skin normals smoothed across seams: ${smoothed} vertices`);
console.log('     per-part triangle budget (share of the model is what matters):');
for (const [name, k] of Object.entries(kept).sort((a, b) => b[1].after - a[1].after))
  console.log(`       ${name.padEnd(16)} ${String(Math.round(k.before)).padStart(7)} -> ${String(Math.round(k.after)).padStart(6)}  ${(100*k.after/afterTris).toFixed(1).padStart(5)}%`);
