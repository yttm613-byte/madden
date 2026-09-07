/* build-lod.cjs — generate reduced-detail copies of the player mesh.
 *
 * The source model (assets/fbplayer_opt.glb) is 150k triangles across 21 primitives.
 * Twenty-two of those are on the field at once, so the renderer was pushing ~3.4M
 * triangles and ~560 draw calls a frame — most of them for players thirty yards away
 * that occupy sixty pixels. This bakes two cheaper copies of every primitive so the
 * game can swap geometry by distance (see the LOD block in render3D).
 *
 * Reduction is uniform vertex clustering: overlay a grid on the bind-pose mesh, merge
 * every vertex in a cell into one, drop the triangles that collapse to a line. It is
 * not as sharp as quadric-error simplification, but it needs no dependencies (the npm
 * registry is not reachable from the build environment) and the artefacts it does
 * leave are sub-pixel at the distance these copies are used.
 *
 * Output: assets/player-lod.bin — a small container the game fetches directly.
 *   magic 'GBLOD100' | uint32 json length | json header | attribute payload
 * Entries are matched to the loaded model by (material name, vertex count, index
 * count), which is unique for all 21 primitives, so nothing depends on node names or
 * on the order GLTFLoader happens to traverse.
 *
 * Run: node tools/build-lod.cjs
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'fbplayer_opt.glb');
const OUT = path.join(__dirname, '..', 'assets', 'player-lod.bin');
const LEVELS = [0.30, 0.09];          // fraction of the source triangles per level
const KEEP_BELOW = 400;               // primitives this small are copied verbatim

// ---- glb ---------------------------------------------------------------------
function readGLB(file){
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');
  let off = 12, json = null, bin = null;
  while (off < b.length){
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    const chunk = b.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len + ((4 - (len % 4)) % 4) * 0;
  }
  return { json, bin };
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
               5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const ITEMS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORM_MAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

// Decode one accessor into a plain Float32Array (or Uint16Array for joints),
// handling interleaved buffer views and KHR_mesh_quantization's normalized ints.
function readAccessor(g, bin, ai, asInt){
  const a = g.accessors[ai], bv = g.bufferViews[a.bufferView];
  const [Ctor, csize] = COMP[a.componentType], items = ITEMS[a.type];
  const stride = bv.byteStride || items * csize;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = asInt ? new Uint16Array(a.count * items) : new Float32Array(a.count * items);
  const scale = (a.normalized && !asInt) ? 1 / NORM_MAX[a.componentType] : 1;
  for (let i = 0; i < a.count; i++){
    const src = new Ctor(bin.buffer, bin.byteOffset + base + i * stride, items);
    for (let k = 0; k < items; k++){
      const v = src[k] * scale;
      out[i * items + k] = a.normalized && !asInt ? Math.max(-1, v) : v;
    }
  }
  return out;
}

// ---- vertex-cluster reduction -------------------------------------------------
// Returns {index, attrs} for one primitive reduced toward `target` triangles.
function cluster(P, idx, target, grid){
  const n = P.length / 3;
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < n; i++){
    const x = P[i*3], y = P[i*3+1], z = P[i*3+2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const span = Math.max(maxx - minx, maxy - miny, maxz - minz) || 1;
  const cs = span / grid;
  const nx = Math.max(1, Math.ceil((maxx - minx) / cs) + 1);
  const ny = Math.max(1, Math.ceil((maxy - miny) / cs) + 1);
  const cell = new Int32Array(n);
  const seen = new Map();
  let nc = 0;
  for (let i = 0; i < n; i++){
    const ix = Math.floor((P[i*3] - minx) / cs), iy = Math.floor((P[i*3+1] - miny) / cs),
          iz = Math.floor((P[i*3+2] - minz) / cs);
    const key = ix + iy * nx + iz * nx * ny;
    let c = seen.get(key);
    if (c === undefined){ c = nc++; seen.set(key, c); }
    cell[i] = c;
  }
  // surviving triangles, deduplicated
  const tris = [], have = new Set();
  for (let t = 0; t < idx.length; t += 3){
    const a = cell[idx[t]], b = cell[idx[t+1]], c = cell[idx[t+2]];
    if (a === b || b === c || a === c) continue;
    const s = a < b ? (b < c ? a+','+b+','+c : (a < c ? a+','+c+','+b : c+','+a+','+b))
                    : (a < c ? b+','+a+','+c : (b < c ? b+','+c+','+a : c+','+b+','+a));
    if (have.has(s)) continue;
    have.add(s);
    tris.push(a, b, c);
  }
  return { cell, nc, tris: tris.length / 3, triIdx: tris };
}

function reduce(prim, ratio){
  const P = prim.attrs.POSITION;
  const idx = prim.index;
  const srcTris = idx.length / 3;
  const target = Math.max(48, Math.round(srcTris * ratio));
  // Grid resolution that lands closest to the target without going under it.
  let lo = 3, hi = 400, best = null;
  for (let it = 0; it < 12 && lo <= hi; it++){
    const mid = (lo + hi) >> 1;
    const r = cluster(P, idx, target, mid);
    if (r.tris >= target){ best = r; hi = mid - 1; } else lo = mid + 1;
    if (!best) best = r;
  }
  const r = best;
  const n = P.length / 3;
  // representative vertex per cluster: averaged continuous attributes, and the
  // discrete ones (skin bindings, tangent handedness) taken from the member vertex
  // nearest that average so weights stay a valid convex set.
  const used = new Int32Array(r.nc).fill(-1);
  for (const c of r.triIdx) used[c] = 0;
  const remap = new Int32Array(r.nc).fill(-1);
  let outN = 0;
  for (let c = 0; c < r.nc; c++) if (used[c] === 0) remap[c] = outN++;

  const sum = {}, out = {};
  const names = Object.keys(prim.attrs);
  for (const k of names){
    const items = prim.items[k];
    sum[k] = new Float64Array(outN * items);
    out[k] = new (k === 'JOINTS_0' ? Uint16Array : Float32Array)(outN * items);
  }
  const cnt = new Float64Array(outN);
  for (let i = 0; i < n; i++){
    const c = remap[r.cell[i]]; if (c < 0) continue;
    cnt[c]++;
    for (const k of names){
      const items = prim.items[k], src = prim.attrs[k];
      for (let j = 0; j < items; j++) sum[k][c*items+j] += src[i*items+j];
    }
  }
  for (const k of names){
    const items = prim.items[k];
    for (let c = 0; c < outN; c++){
      const w = cnt[c] || 1;
      for (let j = 0; j < items; j++) sum[k][c*items+j] /= w;
    }
  }
  // nearest member to each average position, for the discrete attributes
  const nearest = new Int32Array(outN).fill(-1);
  const bestD = new Float64Array(outN).fill(Infinity);
  for (let i = 0; i < n; i++){
    const c = remap[r.cell[i]]; if (c < 0) continue;
    const dx = P[i*3] - sum.POSITION[c*3], dy = P[i*3+1] - sum.POSITION[c*3+1], dz = P[i*3+2] - sum.POSITION[c*3+2];
    const d = dx*dx + dy*dy + dz*dz;
    if (d < bestD[c]){ bestD[c] = d; nearest[c] = i; }
  }
  for (const k of names){
    const items = prim.items[k];
    const discrete = (k === 'JOINTS_0' || k === 'WEIGHTS_0');
    for (let c = 0; c < outN; c++){
      const src = discrete ? nearest[c] : -1;
      for (let j = 0; j < items; j++)
        out[k][c*items+j] = src >= 0 ? prim.attrs[k][src*items+j] : sum[k][c*items+j];
    }
    if (k === 'NORMAL' || k === 'TANGENT'){          // renormalize the averaged basis
      for (let c = 0; c < outN; c++){
        const o = c*items;
        const L = Math.hypot(out[k][o], out[k][o+1], out[k][o+2]) || 1;
        out[k][o] /= L; out[k][o+1] /= L; out[k][o+2] /= L;
        if (items === 4) out[k][o+3] = prim.attrs[k][nearest[c]*4+3] >= 0 ? 1 : -1;
      }
    }
  }
  const index = outN > 65535 ? new Uint32Array(r.triIdx.length) : new Uint16Array(r.triIdx.length);
  for (let i = 0; i < r.triIdx.length; i++) index[i] = remap[r.triIdx[i]];
  return { attrs: out, index, verts: outN, tris: index.length / 3 };
}

// ---- main ---------------------------------------------------------------------
const { json: g, bin } = readGLB(SRC);
const WANT = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0', 'COLOR_0', 'TANGENT'];
const entries = [], chunks = [];
let payload = 0;
function push(arr){
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  const rec = { o: payload, n: arr.length, t: arr.constructor.name };
  chunks.push(buf); payload += buf.length;
  const pad = (4 - (buf.length % 4)) % 4;
  if (pad){ chunks.push(Buffer.alloc(pad)); payload += pad; }
  return rec;
}

let srcTot = 0, lodTot = [0, 0];
for (const mesh of g.meshes) for (const p of mesh.primitives){
  const prim = { attrs: {}, items: {}, index: null };
  for (const k of WANT) if (p.attributes[k] !== undefined){
    prim.attrs[k] = readAccessor(g, bin, p.attributes[k], k === 'JOINTS_0');
    prim.items[k] = ITEMS[g.accessors[p.attributes[k]].type];
  }
  const ia = g.accessors[p.indices];
  const [ICtor] = COMP[ia.componentType];
  const ibv = g.bufferViews[ia.bufferView];
  prim.index = new ICtor(bin.buffer, bin.byteOffset + (ibv.byteOffset || 0) + (ia.byteOffset || 0), ia.count);

  const srcTris = ia.count / 3, srcVerts = g.accessors[p.attributes.POSITION].count;
  srcTot += srcTris;
  const entry = { mat: (g.materials[p.material] || {}).name || '', v: srcVerts, i: ia.count, lods: [] };
  LEVELS.forEach((ratio, li) => {
    const r = srcTris <= KEEP_BELOW
      ? { attrs: prim.attrs, index: prim.index, verts: srcVerts, tris: srcTris }
      : reduce(prim, ratio);
    lodTot[li] += r.tris;
    const lod = { verts: r.verts, tris: r.tris, index: push(r.index), attrs: {} };
    for (const k of Object.keys(r.attrs)) lod.attrs[k] = Object.assign({ items: prim.items[k] }, push(r.attrs[k]));
    entry.lods.push(lod);
  });
  entries.push(entry);
  console.log(String(Math.round(srcTris)).padStart(7), '->',
    entry.lods.map(l => String(Math.round(l.tris)).padStart(6)).join(' '), ' ', entry.mat);
}

const header = Buffer.from(JSON.stringify({ levels: LEVELS, entries }), 'utf8');
const hpad = (4 - (header.length % 4)) % 4;
const out = Buffer.concat([
  Buffer.from('GBLOD100', 'ascii'),
  (() => { const b = Buffer.alloc(4); b.writeUInt32LE(header.length + hpad); return b; })(),
  header, Buffer.alloc(hpad), ...chunks,
]);
fs.writeFileSync(OUT, out);
console.log('\nsource   ', Math.round(srcTot), 'tris');
LEVELS.forEach((r, i) => console.log('lod' + i + '     ', Math.round(lodTot[i]), 'tris  (' +
  (100 * lodTot[i] / srcTot).toFixed(1) + '% of source)'));
console.log('wrote', path.relative(process.cwd(), OUT), (out.length / 1048576).toFixed(2), 'MB');
