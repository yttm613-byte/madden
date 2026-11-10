/* mesher.mjs — turn an SDF into a triangle mesh.
 *
 * Surface nets: one vertex per grid cell the surface passes through, one quad per
 * grid edge it crosses. Unlike marching cubes it gives evenly sized, well shaped
 * faces, and it is crack-free by construction because every crossing edge emits
 * exactly one quad shared by the four cells around it.
 *
 * Only cells near the surface are evaluated at full resolution. A coarse pass finds
 * where the surface can be (an SDF is a distance bound, so a coarse cell whose
 * corners are all further than its own diagonal cannot contain any), and the fine
 * pass skips everything else. That is what makes 2mm faces affordable.
 */
import { gradient } from './sdf.mjs';

export function surfaceNets(f, lo, hi, h, { band = 1.6, stride = 4, log = null } = {}) {
  // The origin is nudged off round numbers. Shapes are placed at round coordinates, and
  // a surface lying exactly on a grid plane is the one case that makes surface nets
  // emit a non-manifold edge (measured: a capsule top at z=0.040 on a 2mm grid).
  const ox = lo[0]-0.3183*h, oy = lo[1]-0.2718*h, oz = lo[2]-0.1618*h;
  const nx = Math.ceil((hi[0]-ox)/h)+2, ny = Math.ceil((hi[1]-oy)/h)+2, nz = Math.ceil((hi[2]-oz)/h)+2;
  const N = nx*ny*nz;
  if (N > 60e6) throw new Error(`grid too large: ${nx}x${ny}x${nz}`);
  const vals = new Float32Array(N);
  const idx = (i, j, k) => i + nx*(j + ny*k);

  // ---- coarse pass -------------------------------------------------------------------
  const S = stride;
  const cx = Math.ceil((nx-1)/S)+1, cy = Math.ceil((ny-1)/S)+1, cz = Math.ceil((nz-1)/S)+1;
  const coarse = new Float32Array(cx*cy*cz);
  let evals = 0;
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const fi = Math.min(i*S, nx-1), fj = Math.min(j*S, ny-1), fk = Math.min(k*S, nz-1);
    coarse[i + cx*(j + cy*k)] = f(ox+fi*h, oy+fj*h, oz+fk*h); evals++;
  }
  const H = S*h, reach = H*Math.sqrt(3)*band;
  // ---- fine pass, only inside coarse cells that can hold surface ----------------------
  const done = new Uint8Array(N);
  for (let k = 0; k < cz-1; k++) for (let j = 0; j < cy-1; j++) for (let i = 0; i < cx-1; i++) {
    let mn = Infinity, mx = -Infinity;
    for (let c = 0; c < 8; c++) {
      const v = coarse[(i+(c&1)) + cx*((j+((c>>1)&1)) + cy*(k+((c>>2)&1)))];
      if (Math.abs(v) < mn) mn = Math.abs(v); if (v > mx) mx = v;
    }
    const i0 = i*S, j0 = j*S, k0 = k*S, i1 = Math.min(i0+S, nx-1), j1 = Math.min(j0+S, ny-1), k1 = Math.min(k0+S, nz-1);
    if (mn > reach) {
      // far from the surface: every fine sample has the coarse sign
      const s = coarse[i + cx*(j + cy*k)] < 0 ? -reach : reach;
      for (let kk = k0; kk <= k1; kk++) for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const q = idx(ii, jj, kk); if (!done[q]) { vals[q] = s; }
      }
      continue;
    }
    for (let kk = k0; kk <= k1; kk++) for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
      const q = idx(ii, jj, kk); if (done[q]) continue;
      vals[q] = f(ox+ii*h, oy+jj*h, oz+kk*h); done[q] = 1; evals++;
    }
  }

  // ---- vertices ----------------------------------------------------------------------
  const cellsX = nx-1, cellsY = ny-1, cellsZ = nz-1;
  const cellVert = new Int32Array(cellsX*cellsY*cellsZ).fill(-1);
  const pos = [];
  const E = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const co = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const cv = new Float64Array(8);
  for (let k = 0; k < cellsZ; k++) for (let j = 0; j < cellsY; j++) for (let i = 0; i < cellsX; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = vals[idx(i+co[c][0], j+co[c][1], k+co[c][2])]; cv[c] = v; if (v < 0) mask |= 1<<c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va/(va-vb);
      sx += co[a][0] + (co[b][0]-co[a][0])*t; sy += co[a][1] + (co[b][1]-co[a][1])*t; sz += co[a][2] + (co[b][2]-co[a][2])*t; n++;
    }
    cellVert[i + cellsX*(j + cellsY*k)] = pos.length/3;
    pos.push(ox+(i+sx/n)*h, oy+(j+sy/n)*h, oz+(k+sz/n)*h);
  }
  // ---- faces -------------------------------------------------------------------------
  const tris = [];
  const cvx = (i, j, k) => cellVert[i + cellsX*(j + cellsY*k)];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    // split along the shorter diagonal
    const dac = (pos[3*a]-pos[3*c])**2 + (pos[3*a+1]-pos[3*c+1])**2 + (pos[3*a+2]-pos[3*c+2])**2;
    const dbd = (pos[3*b]-pos[3*d])**2 + (pos[3*b+1]-pos[3*d+1])**2 + (pos[3*b+2]-pos[3*d+2])**2;
    if (dac <= dbd) tris.push(a, b, c, a, c, d); else tris.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = vals[idx(i, j, k)], in0 = v0 < 0;
    // an edge needs all four cells around it, so edges on the grid's outer faces
    // (which can never carry surface given the padding) are skipped
    if (i < nx-1 && j > 0 && k > 0 && j < ny-1 && k < nz-1) {
      const in1 = vals[idx(i+1, j, k)] < 0;
      if (in0 !== in1) quad(cvx(i, j-1, k-1), cvx(i, j, k-1), cvx(i, j, k), cvx(i, j-1, k), !in0);
    }
    if (j < ny-1 && i > 0 && k > 0 && i < nx-1 && k < nz-1) {
      const in1 = vals[idx(i, j+1, k)] < 0;
      if (in0 !== in1) quad(cvx(i-1, j, k-1), cvx(i-1, j, k), cvx(i, j, k), cvx(i, j, k-1), !in0);
    }
    if (k < nz-1 && i > 0 && j > 0 && i < nx-1 && j < ny-1) {
      const in1 = vals[idx(i, j, k+1)] < 0;
      if (in0 !== in1) quad(cvx(i-1, j-1, k), cvx(i, j-1, k), cvx(i, j, k), cvx(i-1, j, k), !in0);
    }
  }
  if (log) log(`  nets ${nx}x${ny}x${nz} h=${(h*1000).toFixed(1)}mm evals=${(evals/1e6).toFixed(2)}M verts=${pos.length/3} tris=${tris.length/3}`);
  return { pos: Float64Array.from(pos), tris: Int32Array.from(tris) };
}

// Pull every vertex onto the zero set with a few Newton steps along the gradient.
export function project(f, mesh, h, iters = 3) {
  const p = mesh.pos;
  for (let v = 0; v < p.length/3; v++) {
    let x = p[3*v], y = p[3*v+1], z = p[3*v+2];
    for (let it = 0; it < iters; it++) {
      const d = f(x, y, z); if (Math.abs(d) < 1e-6) break;
      const g = gradient(f, x, y, z);
      const s = Math.max(-h, Math.min(h, d));
      x -= g[0]*s; y -= g[1]*s; z -= g[2]*s;
    }
    p[3*v] = x; p[3*v+1] = y; p[3*v+2] = z;
  }
  return mesh;
}

// Drop triangles whose three vertices all satisfy `hidden` (e.g. skin inside the
// jersey), then compact the vertex list.
export function cull(mesh, hidden) {
  const p = mesh.pos, t = mesh.tris, nv = p.length/3;
  const hid = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) hid[v] = hidden(p[3*v], p[3*v+1], p[3*v+2]) ? 1 : 0;
  const keepT = [];
  for (let i = 0; i < t.length; i += 3) if (!(hid[t[i]] && hid[t[i+1]] && hid[t[i+2]])) keepT.push(t[i], t[i+1], t[i+2]);
  return compact({ pos: p, tris: Int32Array.from(keepT) });
}
export function compact(mesh) {
  const p = mesh.pos, t = mesh.tris, nv = p.length/3;
  const map = new Int32Array(nv).fill(-1); const np = [];
  const nt = new Int32Array(t.length);
  for (let i = 0; i < t.length; i++) {
    const v = t[i]; if (map[v] < 0) { map[v] = np.length/3; np.push(p[3*v], p[3*v+1], p[3*v+2]); }
    nt[i] = map[v];
  }
  const out = { pos: Float64Array.from(np), tris: nt };
  for (const k of Object.keys(mesh)) if (k !== 'pos' && k !== 'tris') out[k] = mesh[k];
  return out;
}
// Keep only the largest connected component (surface nets can leave specks where a
// thin feature grazes the grid).
export function largestComponents(mesh, keep = 1, minTris = 0) {
  const t = mesh.tris, nv = mesh.pos.length/3, parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < t.length; i += 3) { const a = find(t[i]), b = find(t[i+1]), c = find(t[i+2]); parent[b] = a; parent[c] = a; }
  const count = new Map();
  for (let i = 0; i < t.length; i += 3) { const r = find(t[i]); count.set(r, (count.get(r)||0)+1); }
  const ranked = [...count.entries()].sort((a, b) => b[1]-a[1]);
  const ok = new Set(ranked.filter((e, i) => i < keep || e[1] >= minTris && minTris > 0).map(e => e[0]));
  const nt = [];
  for (let i = 0; i < t.length; i += 3) if (ok.has(find(t[i]))) nt.push(t[i], t[i+1], t[i+2]);
  return compact({ pos: mesh.pos, tris: Int32Array.from(nt) });
}
// Taubin smoothing (shrink-free): lambda/mu passes of umbrella smoothing.
export function taubin(mesh, iters = 4, lambda = 0.5, mu = -0.53, pin = null) {
  const p = mesh.pos, t = mesh.tris, nv = p.length/3;
  const nb = Array.from({ length: nv }, () => new Set());
  for (let i = 0; i < t.length; i += 3) { const a = t[i], b = t[i+1], c = t[i+2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  const tmp = new Float64Array(p.length);
  const pass = (w) => {
    for (let v = 0; v < nv; v++) {
      if (pin && pin[v]) { tmp[3*v] = p[3*v]; tmp[3*v+1] = p[3*v+1]; tmp[3*v+2] = p[3*v+2]; continue; }
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const u of nb[v]) { sx += p[3*u]; sy += p[3*u+1]; sz += p[3*u+2]; n++; }
      if (!n) { tmp[3*v] = p[3*v]; tmp[3*v+1] = p[3*v+1]; tmp[3*v+2] = p[3*v+2]; continue; }
      tmp[3*v]   = p[3*v]   + w*(sx/n - p[3*v]);
      tmp[3*v+1] = p[3*v+1] + w*(sy/n - p[3*v+1]);
      tmp[3*v+2] = p[3*v+2] + w*(sz/n - p[3*v+2]);
    }
    p.set(tmp);
  };
  for (let i = 0; i < iters; i++) { pass(lambda); pass(mu); }
  return mesh;
}
export function boundaryVerts(mesh) {
  const t = mesh.tris, nv = mesh.pos.length/3, e = new Map();
  const key = (a, b) => a < b ? a*nv+b : b*nv+a;
  for (let i = 0; i < t.length; i += 3) for (let s = 0; s < 3; s++) { const k = key(t[i+s], t[i+(s+1)%3]); e.set(k, (e.get(k)||0)+1); }
  const pin = new Uint8Array(nv);
  for (const [k, c] of e) if (c === 1) { pin[Math.floor(k/nv)] = 1; pin[k%nv] = 1; }
  return pin;
}

// Split any vertex whose faces form more than one fan (and any edge used by more than
// two faces) so the result is a 2-manifold. Surface nets can pinch two sheets into one
// vertex where a feature is thinner than a cell; the decimator's link test needs a
// manifold to reason about.
export function makeManifold(mesh) {
  const p = Array.from(mesh.pos), t = Int32Array.from(mesh.tris), nv = mesh.pos.length/3, nf = t.length/3;
  const ekey = (a, b) => a < b ? a*nv+b : b*nv+a;
  const ecount = new Map();
  for (let f = 0; f < nf; f++) for (let s = 0; s < 3; s++) { const k = ekey(t[3*f+s], t[3*f+(s+1)%3]); ecount.set(k, (ecount.get(k)||0)+1); }
  const vf = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf; f++) for (let s = 0; s < 3; s++) vf[t[3*f+s]].push(f);
  let splits = 0;
  for (let v = 0; v < nv; v++) {
    const fs = vf[v]; if (fs.length < 2) continue;
    const par = fs.map((_, i) => i);
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const other = (f) => { const r = []; for (let s = 0; s < 3; s++) if (t[3*f+s] !== v) r.push(t[3*f+s]); return r; };
    for (let i = 0; i < fs.length; i++) for (let j = i+1; j < fs.length; j++) {
      const a = other(fs[i]), b = other(fs[j]);
      for (const w of a) if (b.includes(w) && ecount.get(ekey(v, w)) === 2) par[find(i)] = find(j);
    }
    const groups = new Map();
    fs.forEach((f, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(f); });
    if (groups.size < 2) continue;
    let first = true;
    for (const g of groups.values()) {
      if (first) { first = false; continue; }
      const nvId = p.length/3; p.push(p[3*v], p[3*v+1], p[3*v+2]); splits++;
      for (const f of g) for (let s = 0; s < 3; s++) if (t[3*f+s] === v) t[3*f+s] = nvId;
    }
  }
  const out = { ...mesh, pos: Float64Array.from(p), tris: t };
  out.splits = splits;
  return out;
}
export function manifoldReport(m) {
  const e = new Map(), nv = m.pos.length/3;
  for (let i = 0; i < m.tris.length; i += 3) for (let s = 0; s < 3; s++) { const a = m.tris[i+s], b = m.tris[i+(s+1)%3]; const k = a < b ? a*nv+b : b*nv+a; e.set(k, (e.get(k)||0)+1); }
  let bad = 0, bnd = 0; for (const c of e.values()) { if (c > 2) bad++; if (c === 1) bnd++; }
  return { verts: nv, tris: m.tris.length/3, nonManifoldEdges: bad, boundaryEdges: bnd };
}

// Cut a mesh exactly along the zero contour of a scalar field. Every triangle whose
// corners straddle the contour is split at the interpolated crossing points (shared
// per edge, so the result stays watertight), and each output triangle is tagged with
// the side it lies on. This is how a colour band gets a clean edge on a surface whose
// triangles know nothing about it.
// Several fields: cut along each in turn; a triangle is 'inside' only if it is on the
// negative side of all of them (a band between two planes is two linear cuts, which is
// exact, rather than one kinked field, which is not).
export function splitByFields(mesh, fields) {
  let m = mesh, side = null;
  for (const f of fields) {
    const r = splitByField(m, f);
    if (side) {
      // carry the previous side through: new triangles inherit from their parent — easier to
      // recompute it from the centroid against the earlier fields, which are already exact cuts
      const s2 = new Uint8Array(r.side.length);
      for (let i = 0; i < r.tris.length; i += 3) {
        const c = [0, 1, 2].map(k => (r.pos[3*r.tris[i]+k] + r.pos[3*r.tris[i+1]+k] + r.pos[3*r.tris[i+2]+k])/3);
        let inAll = r.side[i/3] === 1;
        for (const g of fields) { if (g === f) break; if (g(c[0], c[1], c[2]) >= 0) { inAll = false; break; } }
        s2[i/3] = inAll ? 1 : 0;
      }
      side = s2;
    } else side = r.side;
    m = { pos: r.pos, tris: r.tris };
  }
  return { pos: m.pos, tris: m.tris, side };
}
export function splitByField(mesh, field) {
  const p = Array.from(mesh.pos), t = mesh.tris, nv0 = mesh.pos.length/3;
  const val = new Float64Array(nv0);
  for (let v = 0; v < nv0; v++) val[v] = field(p[3*v], p[3*v+1], p[3*v+2]);
  const edgeV = new Map();
  const cross = (a, b) => {
    const k = a < b ? a*nv0+b : b*nv0+a; let r = edgeV.get(k); if (r !== undefined) return r;
    const s = val[a]/(val[a]-val[b]);
    // a crossing that lands on a corner IS that corner: a new vertex there would be a
    // duplicate and leave a zero-area sliver behind
    if (s < 1e-4) { edgeV.set(k, a); return a; }
    if (s > 1-1e-4) { edgeV.set(k, b); return b; }
    r = p.length/3; p.push(p[3*a]+(p[3*b]-p[3*a])*s, p[3*a+1]+(p[3*b+1]-p[3*a+1])*s, p[3*a+2]+(p[3*b+2]-p[3*a+2])*s);
    edgeV.set(k, r); return r;
  };
  const out = [], side = [];
  const emit = (a, b, c, s) => { if (a === b || b === c || a === c) return; out.push(a, b, c); side.push(s); };
  for (let i = 0; i < t.length; i += 3) {
    const v = [t[i], t[i+1], t[i+2]], s = v.map(x => val[x] < 0 ? 1 : 0);
    const n1 = s[0]+s[1]+s[2];
    if (n1 === 0 || n1 === 3) { emit(v[0], v[1], v[2], n1 ? 1 : 0); continue; }
    // rotate so v[0] is the odd one out
    let r = 0; for (let k = 0; k < 3; k++) if (s[k] !== s[(k+1)%3] && s[k] !== s[(k+2)%3]) r = k;
    const a = v[r], b = v[(r+1)%3], c = v[(r+2)%3], sa = s[r];
    const ab = cross(a, b), ac = cross(a, c);
    emit(a, ab, ac, sa);
    emit(ab, b, c, 1-sa); emit(ab, c, ac, 1-sa);
  }
  return { pos: Float64Array.from(p), tris: Int32Array.from(out), side: Uint8Array.from(side) };
}
