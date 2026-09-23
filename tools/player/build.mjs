/* build.mjs — sculpt, mesh, rig and export the player.
 *
 *   node tools/player/build.mjs [out.glb]
 *
 * Deterministic and dependency-free: the same source always produces the same file.
 */
import fs from 'fs';
import { buildRig } from './rig.mjs';
import { buildBody } from './body.mjs';
import { surfaceNets, project, makeManifold, cull, manifoldReport, largestComponents, splitByField } from './mesher.mjs';
import { decimate } from './qem.mjs';
import { makeWeigher } from './weights.mjs';
import { GLTFBuilder } from './glb.mjs';
import { decal, numberImage } from './decals.mjs';
import { encodePNG } from './png.mjs';
import { idleClip } from './anim.mjs';
import { jerseyNormal, pantsNormal, sockNormal, gloveNormal, boxUV } from './textures.mjs';
import { gradient, union, intersect, plane, ellipsoid, sunionK, mirrorX, offset } from './sdf.mjs';

const OUT = process.argv[2] || 'assets/gridiron_player.glb';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s]`, ...a);

const rig = buildRig();
const body = buildBody(rig);
const W = makeWeigher(rig);

// ---- culling volumes ------------------------------------------------------------------
const underHelmet = (x, y, z) => body.helmetFill(x, y, z) < -0.004 && body.faceHole(x, y, z) > 0.006 && y > 1.60;
const inside = (f, m) => (x, y, z) => f(x, y, z) < -m;
const anyOf = (...fs) => (x, y, z) => fs.some(f => f(x, y, z));

// ---- parts ------------------------------------------------------------------------------
// mirror: mesh the left side only, then reflect it for the right.
// albedo: base brightness baked into the vertex colour (the game tints on top of it).
const PARTS = [
  { name: 'Skin', key: 'headneck', f: body.skinFull, lo: [-0.14, 1.40, -0.16], hi: [0.14, 1.905, 0.15], h: 0.0016, target: 7200, w: 'noLegs', albedo: 1.0,
    hide: anyOf(inside(body.jersey, 0.003), underHelmet) },
  // weighted like the jersey: under the sleeve the arm follows the sleeve, so it never pokes through
  { name: 'Skin', key: 'arm', f: body.armL, lo: [0.09, 0.88, -0.13], hi: [0.58, 1.57, 0.11], h: 0.0024, target: 2600, mirror: true, w: 'jersey', albedo: 1.0,
    hide: anyOf(inside(body.jersey, 0.0025), inside(body.glovesL, 0.0012)) },
  { name: 'Eyes', key: 'eyes', f: body.eyes, lo: [-0.05, 1.75, 0.055], hi: [0.05, 1.782, 0.09], h: 0.0006, target: 700, w: 'head' },
  { name: 'Gloves', key: 'glove', f: body.glovesL, lo: [0.35, 0.72, -0.08], hi: [0.64, 1.07, 0.09], h: 0.0013, target: 2600, mirror: true, w: 'noLegs', albedo: 1.0 },
  // Jersey + belt + pants: one surface, cut exactly into three materials (and the trim
  // bands) along planes and the trim contour. Weighted like the jersey above the belt
  // and like the legs below it.
  { name: 'Jersey', key: 'uniform', f: body.uniform, lo: [-0.42, 0.38, -0.22], hi: [0.42, 1.60, 0.21], h: 0.0032, target: 14800, albedo: 0.80,
    w: (x, y, z) => y < 1.10 ? 'noArms' : 'jersey',
    hide: inside(body.socks, 0.002),
    cuts: [(x, y, z) => y - 1.089, (x, y, z) => y - 1.0815, (x, y, z) => 1.0525 - y, body.TRIM_D],
    splits: [
      { name: 'Belt', albedo: 0.90, when: (x, y, z) => y > 1.0525 && y < 1.0815 },
      { name: 'Pants', albedo: 0.84, when: (x, y, z) => y < 1.089 },
      { name: 'JerseyTrim', albedo: 0.85, when: (x, y, z) => body.TRIM_D(x, y, z) < 0 },
    ] },
  { name: 'Socks', key: 'socks', f: body.socks, lo: [0.0, 0.05, -0.12], hi: [0.22, 0.55, 0.12], h: 0.0024, target: 1500, mirror: true, w: 'noArms', albedo: 0.84,
    hide: inside(body.cleats, 0.0015) },
  { name: 'Cleats', key: 'cleat', f: body.cleatL, lo: [0.0, -0.02, -0.14], hi: [0.22, 0.15, 0.25], h: 0.0016, target: 2400, mirror: true, w: 'noArms', albedo: 1.0 },
  { name: 'Helmet', key: 'helmet', f: body.helmet, lo: [-0.16, 1.58, -0.21], hi: [0.16, 1.95, 0.18], h: 0.0020, target: 6000, w: 'head', albedo: 0.94 },
  { name: 'HelmetStripe', key: 'stripe', f: body.stripe, lo: [-0.035, 1.62, -0.20], hi: [0.035, 1.94, 0.17], h: 0.0009, target: 1400, w: 'head', albedo: 0.94 },
  { name: 'Facemask', key: 'mask', f: body.facemask, lo: [-0.13, 1.62, 0.07], hi: [0.13, 1.82, 0.20], h: 0.0012, target: 3200, w: 'head' },
  { name: 'Visor', key: 'visor', f: body.visor, lo: [-0.10, 1.72, 0.08], hi: [0.10, 1.80, 0.18], h: 0.0007, target: 500, w: 'head' },
  { name: 'ChinStrap', key: 'chin', f: body.chinstrap, lo: [-0.12, 1.60, -0.01], hi: [0.12, 1.73, 0.12], h: 0.0012, target: 900, w: 'head' },
];
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

// AO: everything that can shadow something else
const occluder = union(body.skinFull, body.gloves, body.jersey, body.pants, body.socks, body.cleats, body.helmet, body.facemask);
function ambientOcclusion(x, y, z, n) {
  let occ = 0, wsum = 0;
  for (let i = 1; i <= 5; i++) {
    const h = 0.006*i*i*0.6 + 0.004*i;               // 1cm .. ~9.5cm
    const d = occluder(x+n[0]*h, y+n[1]*h, z+n[2]*h);
    const w = 1/Math.pow(1.6, i);
    occ += w*Math.max(0, h-d)/h; wsum += w;
  }
  return Math.max(0, Math.min(1, 1 - 1.15*occ/wsum));
}

// per-part albedo multipliers baked into the vertex colour
function albedo(part, x, y, z, n) {
  if (part === 'Helmet') {
    // inner face of the shell is the padding, seen through the face opening
    const c = body.HC; const tx = x-c[0], ty = y-c[1], tz = z-c[2];
    const inward = (tx*n[0]+ty*n[1]+tz*n[2]) < 0;
    return inward ? [0.09, 0.09, 0.10] : [1, 1, 1];
  }
  if (part === 'Skin') {
    const ax = Math.abs(x);
    // eyebrows
    const bx = (ax-0.034)/0.020, by = (y-1.7875 + 0.004*bx*bx)/0.0042;
    if (z > 0.06 && bx*bx + by*by < 1) return [0.42, 0.38, 0.36];
    // lips
    const lx = x/0.024, ly = (y-1.6965)/0.0105;
    if (z > 0.085 && lx*lx + ly*ly < 1) return [0.86, 0.66, 0.64];
    return [1, 1, 1];
  }
  if (part === 'Eyes') {
    const cx = x > 0 ? body.EYE[0] : -body.EYE[0], dx = x-cx, dy = y-body.EYE[1], dz = z-body.EYE[2];
    const l = Math.hypot(dx, dy, dz) || 1, ang = Math.acos(Math.max(-1, Math.min(1, dz/l)));
    if (ang < 0.25) return [0.02, 0.02, 0.02];
    if (ang < 0.50) return [0.20, 0.12, 0.07];
    if (ang < 0.54) return [0.10, 0.07, 0.05];
    return [0.93, 0.90, 0.86];
  }
  if (part === 'Cleats') return y < 0.004 ? [0.35, 0.35, 0.36] : [1, 1, 1];
  return [1, 1, 1];
}

const meshes = {};   // material -> [{pos, nrm, col, jo, we, tris}]
for (const P of PARTS) {
  if (only && !only.has(P.key)) continue;
  log(`${P.name}/${P.key}`);
  let m = surfaceNets(P.f, P.lo, P.hi, P.h, { log: s => log(s) });
  m = makeManifold(m); if (m.splits) log(`  manifold splits: ${m.splits}`);
  project(P.f, m, P.h);
  if (P.hide) { const before = m.tris.length/3; m = cull(m, P.hide); log(`  culled ${before - m.tris.length/3} hidden tris`); }
  m = largestComponents(m, 64, 40);
  m = decimate(m, P.target, { log: s => log(s), protect: P.protect || null });
  project(P.f, m, P.h, 2);
  // Cut exactly along every material boundary, then give each triangle the first
  // material whose test its centroid passes (the cuts make that test exact).
  if (P.cuts) for (const f of P.cuts) { const r = splitByField(m, f); m = { pos: r.pos, tris: r.tris }; }
  // drop slivers whose corners coincide to within 20 microns (they weld into degenerates)
  { const keep = [], pp = m.pos, d = (u, v) => Math.hypot(pp[3*u]-pp[3*v], pp[3*u+1]-pp[3*v+1], pp[3*u+2]-pp[3*v+2]);
    for (let i = 0; i < m.tris.length; i += 3) { const a = m.tris[i], b = m.tris[i+1], c = m.tris[i+2];
      if (d(a, b) > 2e-5 && d(b, c) > 2e-5 && d(c, a) > 2e-5) keep.push(a, b, c); }
    m = { pos: m.pos, tris: Int32Array.from(keep) }; }
  let matOf = null;
  if (P.splits) {
    matOf = new Int8Array(m.tris.length/3);
    for (let i = 0; i < m.tris.length; i += 3) {
      const c = [0, 1, 2].map(k => (m.pos[3*m.tris[i]+k] + m.pos[3*m.tris[i+1]+k] + m.pos[3*m.tris[i+2]+k])/3);
      matOf[i/3] = P.splits.findIndex(sp => sp.when(c[0], c[1], c[2]));
    }
  }
  const rep = manifoldReport(m);
  log(`  final ${rep.tris} tris, ${rep.verts} verts, nonManifold=${rep.nonManifoldEdges} boundary=${rep.boundaryEdges}`);
  for (const s of (P.mirror ? [1, -1] : [1])) {
    const nv = m.pos.length/3, pos = new Float32Array(nv*3), nrm = new Float32Array(nv*3), col = new Float32Array(nv*3);
    const jo = new Uint8Array(nv*4), we = new Float32Array(nv*4);
    for (let v = 0; v < nv; v++) {
      const x0 = m.pos[3*v], y = m.pos[3*v+1], z = m.pos[3*v+2];
      const g = gradient(P.f, x0, y, z);
      const x = x0*s, n = [g[0]*s, g[1], g[2]];
      pos.set([x, y, z], 3*v); nrm.set(n, 3*v);
      const ao = ambientOcclusion(x, y, z, n);
      const al = albedo(P.name, x, y, z, n);
      const shade = (0.30 + 0.70*ao)*(P.albedo || 1);
      col.set([al[0]*shade, al[1]*shade, al[2]*shade], 3*v);
      const wt = W.weigh(x, y, z, typeof P.w === 'function' ? P.w(x, y, z) : (P.w || 'auto'));
      jo.set(wt.j, 4*v); we.set(wt.w, 4*v);
    }
    const tris = Uint32Array.from(m.tris);
    if (s < 0) for (let i = 0; i < tris.length; i += 3) { const t = tris[i+1]; tris[i+1] = tris[i+2]; tris[i+2] = t; }
    if (!matOf) { (meshes[P.name] ||= []).push({ pos, nrm, col, jo, we, tris }); continue; }
    const lists = P.splits.map(() => []), base = [];
    for (let i = 0; i < tris.length; i += 3) (matOf[i/3] >= 0 ? lists[matOf[i/3]] : base).push(tris[i], tris[i+1], tris[i+2]);
    (meshes[P.name] ||= []).push(subset({ pos, nrm, col, jo, we }, base));
    P.splits.forEach((sp, k) => {
      const colK = Float32Array.from(col).map(v => v * (sp.albedo || 1) / (P.albedo || 1));
      (meshes[sp.name] ||= []).push(subset({ pos, nrm, col: colK, jo, we }, lists[k]));
    });
  }
}

// fabric detail: tiling normal maps on box-projected UVs
const FABRIC = { Jersey: [jerseyNormal, 0.045], JerseyTrim: [sockNormal, 0.03], Pants: [pantsNormal, 0.05], Belt: [sockNormal, 0.03],
  Socks: [sockNormal, 0.035], Gloves: [gloveNormal, 0.03] };
function addUV(m, scale) {
  const r = boxUV(m.pos, m.tris, scale), n = r.src.length, o = { tris: r.tris, uv: r.uv };
  const take = (arr, k, T) => { const out = new T(n*k); for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i*k+c] = arr[r.src[i]*k+c]; return out; };
  o.pos = take(m.pos, 3, Float32Array); o.nrm = take(m.nrm, 3, Float32Array); o.col = take(m.col, 3, Float32Array);
  o.jo = take(m.jo, 4, Uint8Array); o.we = take(m.we, 4, Float32Array);
  return o;
}

// keep only the vertices a triangle list actually uses
function subset(A, triList) {
  const map = new Map(), idx = [];
  for (const v of triList) { if (!map.has(v)) map.set(v, map.size); idx.push(map.get(v)); }
  const n = map.size, out = { tris: Uint32Array.from(idx) };
  const take = (arr, k, T) => { const r = new T(n*k); for (const [v, i] of map) for (let c = 0; c < k; c++) r[i*k+c] = arr[v*k+c]; return r; };
  out.pos = take(A.pos, 3, Float32Array); out.nrm = take(A.nrm, 3, Float32Array); out.col = take(A.col, 3, Float32Array);
  out.jo = take(A.jo, 4, Uint8Array); out.we = take(A.we, 4, Float32Array);
  return out;
}

// ---- number decals ------------------------------------------------------------------------
// They carry UVs, so they are kept apart from the untextured parts and exported with them.
const decals = {};   // material -> [{pos,nrm,col,jo,we,tris,uv}]
if (!only || only.has('decals')) {
  const J = body.jersey;
  const S = body.S, aU = body.aU, latU = body.latU;
  const DEF = [
    ['Numbers', { center: [0, 1.345, 0.12], normal: [0, 0, 1], up: [0, 1, 0], width: 0.19, height: 0.16 }],
    ['Numbers', { center: [0, 1.300, -0.13], normal: [0, 0, -1], up: [0, 1, 0], width: 0.25, height: 0.23 }],
    ['NameBar', { center: [0, 1.462, -0.14], normal: [0, -0.18, -1], up: [0, 1, -0.18], width: 0.24, height: 0.045, nu: 20, nv: 4 }],
  ];
  for (const s of [1, -1]) {
    const c = [ (S[0] + latU[0]*0.07 + aU[0]*0.02)*s, S[1] + latU[1]*0.07 + aU[1]*0.02, S[2] + latU[2]*0.07 + aU[2]*0.02 ];
    const nrm = [latU[0]*s, latU[1]+0.35, latU[2]];
    DEF.push(['Numbers', { center: c, normal: nrm, up: [aU[0]*-s*0 + 0, 1, 0], width: 0.080, height: 0.068, nu: 10, nv: 8 }]);
  }
  for (const [mat, D] of DEF) {
    const d = decal(J, D);
    const nv = d.pos.length/3, pos = Float32Array.from(d.pos), nrm = Float32Array.from(d.nrm), col = new Float32Array(nv*3).fill(1);
    const jo = new Uint8Array(nv*4), we = new Float32Array(nv*4);
    for (let v = 0; v < nv; v++) { const wt = W.weigh(pos[3*v], pos[3*v+1], pos[3*v+2], 'jersey'); jo.set(wt.j, 4*v); we.set(wt.w, 4*v);
      const ao = ambientOcclusion(pos[3*v], pos[3*v+1], pos[3*v+2], [nrm[3*v], nrm[3*v+1], nrm[3*v+2]]); col.fill(0.35+0.65*ao, 3*v, 3*v+3); }
    (decals[mat] ||= []).push({ pos, nrm, col, jo, we, tris: Uint32Array.from(d.tris), uv: Float32Array.from(d.uv) });
  }
  log(`decals: ${DEF.length}`);
}

// ---- merge per material and export --------------------------------------------------------
const MAT = {
  Skin:        { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.58 },
  Eyes:        { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.12 },
  Gloves:      { baseColorFactor: [0.08, 0.08, 0.09, 1], metallicFactor: 0, roughnessFactor: 0.55 },
  Jersey:      { baseColorFactor: [0.95, 0.95, 0.95, 1], metallicFactor: 0, roughnessFactor: 0.78 },
  JerseyTrim:  { baseColorFactor: [0.95, 0.95, 0.95, 1], metallicFactor: 0, roughnessFactor: 0.7 },
  Pants:       { baseColorFactor: [0.93, 0.93, 0.93, 1], metallicFactor: 0, roughnessFactor: 0.55 },
  Belt:        { baseColorFactor: [0.1, 0.1, 0.12, 1], metallicFactor: 0, roughnessFactor: 0.5 },
  Socks:       { baseColorFactor: [0.95, 0.95, 0.95, 1], metallicFactor: 0, roughnessFactor: 0.9 },
  Cleats:      { baseColorFactor: [0.06, 0.06, 0.07, 1], metallicFactor: 0, roughnessFactor: 0.4 },
  Helmet:      { baseColorFactor: [0.95, 0.95, 0.95, 1], metallicFactor: 0.1, roughnessFactor: 0.22 },
  HelmetStripe:{ baseColorFactor: [0.95, 0.95, 0.95, 1], metallicFactor: 0.1, roughnessFactor: 0.25 },
  Facemask:    { baseColorFactor: [0.2, 0.2, 0.22, 1], metallicFactor: 0.3, roughnessFactor: 0.45 },
  Visor:       { baseColorFactor: [0.05, 0.05, 0.07, 0.85], metallicFactor: 0.4, roughnessFactor: 0.05 },
  ChinStrap:   { baseColorFactor: [0.07, 0.075, 0.09, 1], metallicFactor: 0, roughnessFactor: 0.45 },
};
const G = new GLTFBuilder({ copyright: 'Gridiron Blitz — generated by tools/player/build.mjs' });
const root = G.node({ name: 'GridironPlayer', children: [] });
G.json.scenes[0].nodes = [root];
// joints
const jointNode = {};
for (const j of rig.J) {
  const n = { name: 'mixamorig:'+j.name, translation: [j.localT.x, j.localT.y, j.localT.z], rotation: [j.localQ.x, j.localQ.y, j.localQ.z, j.localQ.w] };
  jointNode[j.name] = G.node(n);
}
for (const j of rig.J) if (j.children.length) G.json.nodes[jointNode[j.name]].children = j.children.map(c => jointNode[c.name]);
const armature = G.node({ name: 'Armature', children: [jointNode['Hips']] });
G.json.nodes[root].children.push(armature);
const ibm = new Float32Array(rig.J.length*16);
rig.J.forEach((j, i) => ibm.set(j.ibm.elements, i*16));
const skin = G.skin({ name: 'PlayerSkin', joints: rig.J.map(j => jointNode[j.name]), inverseBindMatrices: G.accessor(ibm, 'MAT4'), skeleton: jointNode['Hips'] });
let totalTris = 0;
// default textures for the decals so the file looks right on its own
const samp = G.sampler({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 });
const numImg = numberImage('00'), nameImg = { px: new Uint8Array(256*64*4), W: 256, H: 64 };
const TEX = {
  Numbers: G.texture(G.image(encodePNG(numImg.px, numImg.W, numImg.H), 'number'), samp),
  NameBar: G.texture(G.image(encodePNG(nameImg.px, nameImg.W, nameImg.H), 'name'), samp),
};
const sampRepeat = G.sampler({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
const fabricTex = new Map();
for (const [name, [gen, scale]] of Object.entries(FABRIC)) {
  if (!meshes[name]) continue;
  if (!fabricTex.has(gen)) fabricTex.set(gen, G.texture(G.image(encodePNG(gen(256), 256, 256), gen.name), sampRepeat));
  MAT[name] = { ...MAT[name] }; MAT[name].__normal = fabricTex.get(gen);
  meshes[name] = meshes[name].map(m => addUV(m, scale));
}
MAT.Numbers = { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.6, baseColorTexture: { index: TEX.Numbers } };
MAT.NameBar = { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.6, baseColorTexture: { index: TEX.NameBar } };
for (const [name, list] of [...Object.entries(meshes), ...Object.entries(decals)]) {
  let nv = 0, nt = 0; for (const m of list) { nv += m.pos.length/3; nt += m.tris.length; }
  const hasUV = list.every(m => m.uv);
  const pos = new Float32Array(nv*3), nrm = new Float32Array(nv*3), col = new Float32Array(nv*3), jo = new Uint8Array(nv*4), we = new Float32Array(nv*4), tri = new Uint32Array(nt);
  const uv = hasUV ? new Float32Array(nv*2) : null;
  let vo = 0, to = 0;
  for (const m of list) {
    pos.set(m.pos, vo*3); nrm.set(m.nrm, vo*3); col.set(m.col, vo*3); jo.set(m.jo, vo*4); we.set(m.we, vo*4);
    if (uv) uv.set(m.uv, vo*2);
    for (let i = 0; i < m.tris.length; i++) tri[to+i] = m.tris[i] + vo;
    vo += m.pos.length/3; to += m.tris.length;
  }
  totalTris += nt/3;
  const idx = nv < 65536 ? Uint16Array.from(tri) : tri;
  const extra = name === 'Visor' ? { alphaMode: 'BLEND' } : (name === 'Numbers' || name === 'NameBar') ? { alphaMode: 'MASK', alphaCutoff: 0.5 } : {};
  const { __normal, ...pbr } = MAT[name];
  const mat = G.material({ name, pbrMetallicRoughness: pbr, ...extra, ...(__normal !== undefined ? { normalTexture: { index: __normal, scale: 0.55 } } : {}) });
  const attributes = {
    POSITION: G.accessor(pos, 'VEC3', { minmax: true, target: 34962 }), NORMAL: G.accessor(nrm, 'VEC3', { target: 34962 }),
    COLOR_0: G.accessor(col, 'VEC3', { target: 34962 }), JOINTS_0: G.accessor(jo, 'VEC4', { target: 34962 }), WEIGHTS_0: G.accessor(we, 'VEC4', { target: 34962 }) };
  if (uv) attributes.TEXCOORD_0 = G.accessor(uv, 'VEC2', { target: 34962 });
  const mesh = G.mesh({ name, primitives: [{ attributes, indices: G.accessor(idx, 'SCALAR', { target: 34963 }), material: mat }] });
  G.json.nodes[root].children.push(G.node({ name, mesh, skin }));
  log(`mesh ${name}: ${nt/3} tris, ${nv} verts`);
}
// ---- idle animation ------------------------------------------------------------------------
{
  const clip = idleClip(rig);
  const input = G.accessor(clip.times, 'SCALAR', { minmax: true });
  const samplers = [], channels = [];
  for (const tr of clip.tracks) {
    const output = G.accessor(tr.values, tr.path === 'rotation' ? 'VEC4' : 'VEC3');
    samplers.push({ input, output, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length-1, target: { node: jointNode[tr.joint], path: tr.path } });
  }
  G.animation({ name: clip.name, samplers, channels });
  log(`animation ${clip.name}: ${clip.tracks.length} tracks, ${clip.times.length} keys`);
}
const buf = G.build();
fs.writeFileSync(OUT, buf);
log(`wrote ${OUT}: ${(buf.length/1e6).toFixed(2)}MB, ${totalTris} triangles`);
