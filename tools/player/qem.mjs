/* qem.mjs — quadric error metric decimation (Garland & Heckbert).
 *
 * Collapses the cheapest edge first, where cost is the squared distance from the
 * merged vertex to the planes of every face it used to touch. Flat areas collapse
 * freely and curvature holds its triangles, which is exactly the distribution a
 * character wants: the face and hands keep their detail, the back of the jersey does
 * not waste any.
 *
 * Guards that keep the result clean: the link condition (no non-manifold edges), a
 * flip test (no face may turn over), a sliver penalty, and boundary planes so open
 * edges (a culled neckline, a sleeve opening) do not wander.
 */
export function decimate(mesh, targetTris, { boundaryWeight = 1e3, minQuality = 0.12, log = null, protect = null } = {}) {
  const P = Float64Array.from(mesh.pos); const T = Int32Array.from(mesh.tris);
  const nv = P.length/3; let nt = T.length/3;
  if (nt <= targetTris) return mesh;
  const alive = new Uint8Array(nt).fill(1);
  const vtris = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nt; f++) for (let s = 0; s < 3; s++) vtris[T[3*f+s]].push(f);
  const Q = new Float64Array(nv*10);
  const addQ = (v, a, b, c, d, w) => {
    const o = v*10;
    Q[o] += w*a*a; Q[o+1] += w*a*b; Q[o+2] += w*a*c; Q[o+3] += w*a*d;
    Q[o+4] += w*b*b; Q[o+5] += w*b*c; Q[o+6] += w*b*d; Q[o+7] += w*c*c; Q[o+8] += w*c*d; Q[o+9] += w*d*d;
  };
  const faceN = (f, out) => {
    const a = T[3*f], b = T[3*f+1], c = T[3*f+2];
    const ux = P[3*b]-P[3*a], uy = P[3*b+1]-P[3*a+1], uz = P[3*b+2]-P[3*a+2];
    const vx = P[3*c]-P[3*a], vy = P[3*c+1]-P[3*a+1], vz = P[3*c+2]-P[3*a+2];
    out[0] = uy*vz-uz*vy; out[1] = uz*vx-ux*vz; out[2] = ux*vy-uy*vx;
    return Math.sqrt(out[0]*out[0]+out[1]*out[1]+out[2]*out[2]);
  };
  const n = [0, 0, 0];
  for (let f = 0; f < nt; f++) {
    const l = faceN(f, n); if (l < 1e-18) continue;
    const a = n[0]/l, b = n[1]/l, c = n[2]/l, v0 = T[3*f], d = -(a*P[3*v0]+b*P[3*v0+1]+c*P[3*v0+2]);
    const area = l/2;
    for (let s = 0; s < 3; s++) addQ(T[3*f+s], a, b, c, d, area);
  }
  // boundary edges: a plane through the edge, perpendicular to its face
  {
    const ec = new Map(), key = (a, b) => a < b ? a*nv+b : b*nv+a;
    for (let f = 0; f < nt; f++) for (let s = 0; s < 3; s++) { const k = key(T[3*f+s], T[3*f+(s+1)%3]); const e = ec.get(k); if (e) e.c++; else ec.set(k, { c: 1, f }); }
    for (const [k, e] of ec) if (e.c === 1) {
      const a = Math.floor(k/nv), b = k%nv; const l = faceN(e.f, n); if (l < 1e-18) continue;
      const ex = P[3*b]-P[3*a], ey = P[3*b+1]-P[3*a+1], ez = P[3*b+2]-P[3*a+2];
      let px = ey*n[2]-ez*n[1], py = ez*n[0]-ex*n[2], pz = ex*n[1]-ey*n[0];
      const pl = Math.sqrt(px*px+py*py+pz*pz); if (pl < 1e-18) continue; px /= pl; py /= pl; pz /= pl;
      const d = -(px*P[3*a]+py*P[3*a+1]+pz*P[3*a+2]), w = boundaryWeight*(ex*ex+ey*ey+ez*ez);
      addQ(a, px, py, pz, d, w); addQ(b, px, py, pz, d, w);
    }
  }
  if (protect) for (let v = 0; v < nv; v++) { const w = protect(P[3*v], P[3*v+1], P[3*v+2]); if (w > 0) for (let i = 0; i < 10; i++) Q[v*10+i] *= (1+w); }

  const stamp = new Int32Array(nv);
  const merged = new Int32Array(nv); for (let i = 0; i < nv; i++) merged[i] = i;
  // ---- heap of candidate collapses (typed arrays, lazy invalidation) ----------------
  let cap = 1 << 20;
  let hc = new Float64Array(cap), hu = new Int32Array(cap), hv = new Int32Array(cap), hsu = new Int32Array(cap), hsv = new Int32Array(cap), hx = new Float64Array(cap*3);
  let heap = new Int32Array(cap), hn = 0, free = [], next = 0;
  const grow = () => {
    const nc = cap*2;
    const g = (A, m = 1) => { const B = new A.constructor(nc*m); B.set(A); return B; };
    hc = g(hc); hu = g(hu); hv = g(hv); hsu = g(hsu); hsv = g(hsv); hx = g(hx, 3); heap = g(heap); cap = nc;
  };
  const less = (i, j) => hc[heap[i]] < hc[heap[j]];
  const swap = (i, j) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
  const push = (e) => { if (hn >= cap) grow(); heap[hn] = e; let i = hn++; while (i > 0) { const p = (i-1) >> 1; if (less(i, p)) { swap(i, p); i = p; } else break; } };
  const pop = () => {
    const top = heap[0]; heap[0] = heap[--hn]; let i = 0;
    for (;;) { const l = 2*i+1, r = l+1; let m = i; if (l < hn && less(l, m)) m = l; if (r < hn && less(r, m)) m = r; if (m === i) break; swap(i, m); i = m; }
    return top;
  };
  const alloc = () => { if (free.length) return free.pop(); if (next >= cap) grow(); return next++; };

  const qcost = (o1, o2, x, y, z) => {
    const q = (i) => Q[o1+i] + Q[o2+i];
    return q(0)*x*x + 2*q(1)*x*y + 2*q(2)*x*z + 2*q(3)*x + q(4)*y*y + 2*q(5)*y*z + 2*q(6)*y + q(7)*z*z + 2*q(8)*z + q(9);
  };
  const best = [0, 0, 0];
  const evalEdge = (u, v) => {
    const o1 = u*10, o2 = v*10, q = (i) => Q[o1+i] + Q[o2+i];
    const a = q(0), b = q(1), c = q(2), e = q(4), f = q(5), h = q(7);
    const det = a*(e*h-f*f) - b*(b*h-f*c) + c*(b*f-e*c);
    let bestC = Infinity;
    const scale = Math.abs(a)+Math.abs(e)+Math.abs(h);
    if (Math.abs(det) > 1e-10*scale*scale*scale) {
      const d1 = q(3), d2 = q(6), d3 = q(8);
      // solve [a b c; b e f; c f h] x = -[d1 d2 d3]
      const i00 = e*h-f*f, i01 = c*f-b*h, i02 = b*f-c*e, i11 = a*h-c*c, i12 = b*c-a*f, i22 = a*e-b*b;
      const x = -(i00*d1+i01*d2+i02*d3)/det, y = -(i01*d1+i11*d2+i12*d3)/det, z = -(i02*d1+i12*d2+i22*d3)/det;
      // keep the optimum near the edge — far solutions come from near-flat regions
      const mx = (P[3*u]+P[3*v])/2, my = (P[3*u+1]+P[3*v+1])/2, mz = (P[3*u+2]+P[3*v+2])/2;
      const el = Math.sqrt((P[3*u]-P[3*v])**2+(P[3*u+1]-P[3*v+1])**2+(P[3*u+2]-P[3*v+2])**2);
      if (Math.sqrt((x-mx)**2+(y-my)**2+(z-mz)**2) < el*1.5) { bestC = qcost(o1, o2, x, y, z); best[0] = x; best[1] = y; best[2] = z; }
    }
    for (const t of [0, 0.5, 1]) {
      const x = P[3*u]+(P[3*v]-P[3*u])*t, y = P[3*u+1]+(P[3*v+1]-P[3*u+1])*t, z = P[3*u+2]+(P[3*v+2]-P[3*u+2])*t;
      const cst = qcost(o1, o2, x, y, z);
      if (cst < bestC) { bestC = cst; best[0] = x; best[1] = y; best[2] = z; }
    }
    // mild length term so near-equal costs prefer short edges (keeps faces even)
    const el2 = (P[3*u]-P[3*v])**2+(P[3*u+1]-P[3*v+1])**2+(P[3*u+2]-P[3*v+2])**2;
    return Math.max(0, bestC) + el2*1e-6;
  };
  const pushEdge = (u, v) => {
    const c = evalEdge(u, v), e = alloc();
    hc[e] = c; hu[e] = u; hv[e] = v; hsu[e] = stamp[u]; hsv[e] = stamp[v]; hx[3*e] = best[0]; hx[3*e+1] = best[1]; hx[3*e+2] = best[2];
    push(e);
  };
  const neighbors = (v) => { const s = new Set(); for (const f of vtris[v]) if (alive[f]) for (let k = 0; k < 3; k++) { const w = T[3*f+k]; if (w !== v) s.add(w); } return s; };
  { const seen = new Set();
    for (let f = 0; f < nt; f++) for (let s = 0; s < 3; s++) { const a = T[3*f+s], b = T[3*f+(s+1)%3], k = a < b ? a*nv+b : b*nv+a; if (!seen.has(k)) { seen.add(k); pushEdge(Math.min(a, b), Math.max(a, b)); } } }

  const quality = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx-ax, uy = by-ay, uz = bz-az, vx = cx-ax, vy = cy-ay, vz = cz-az;
    const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx, ar = Math.sqrt(nx*nx+ny*ny+nz*nz);
    const s = ux*ux+uy*uy+uz*uz + vx*vx+vy*vy+vz*vz + (cx-bx)**2+(cy-by)**2+(cz-bz)**2;
    return s > 0 ? 3.4641*ar/s : 0;   // 1 for equilateral
  };
  let live = nt, collapses = 0, rejected = 0;
  while (live > targetTris && hn > 0) {
    const e = pop(); const u = hu[e], v = hv[e];
    const ok = merged[u] === u && merged[v] === v && hsu[e] === stamp[u] && hsv[e] === stamp[v];
    const tx = hx[3*e], ty = hx[3*e+1], tz = hx[3*e+2];
    free.push(e);
    if (!ok) continue;
    // link condition
    const Nu = neighbors(u), Nv = neighbors(v);
    if (!Nu.has(v)) continue;
    let common = 0; for (const w of Nu) if (Nv.has(w)) common++;
    let shared = 0; for (const f of vtris[u]) if (alive[f] && (T[3*f] === v || T[3*f+1] === v || T[3*f+2] === v)) shared++;
    if (common !== shared) { rejected++; continue; }
    // flip + sliver test on every face that survives
    let bad = false;
    for (const w of [u, v]) for (const f of vtris[w]) {
      if (!alive[f]) continue;
      const a = T[3*f], b = T[3*f+1], c = T[3*f+2];
      if ((a === u || b === u || c === u) && (a === v || b === v || c === v)) continue;
      faceN(f, n); const l0 = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
      const px = [P[3*a], P[3*b], P[3*c]], py = [P[3*a+1], P[3*b+1], P[3*c+1]], pz = [P[3*a+2], P[3*b+2], P[3*c+2]];
      const k = a === w ? 0 : (b === w ? 1 : 2); px[k] = tx; py[k] = ty; pz[k] = tz;
      const ux = px[1]-px[0], uy = py[1]-py[0], uz = pz[1]-pz[0], vx = px[2]-px[0], vy = py[2]-py[0], vz = pz[2]-pz[0];
      const mx = uy*vz-uz*vy, my = uz*vx-ux*vz, mz = ux*vy-uy*vx, l1 = Math.sqrt(mx*mx+my*my+mz*mz);
      if (l1 < 1e-14 || (n[0]*mx+n[1]*my+n[2]*mz) < 0.2*l0*l1) { bad = true; break; }
      if (quality(px[0], py[0], pz[0], px[1], py[1], pz[1], px[2], py[2], pz[2]) < minQuality) { bad = true; break; }
    }
    if (bad) { rejected++; continue; }
    // collapse v into u
    P[3*u] = tx; P[3*u+1] = ty; P[3*u+2] = tz;
    for (let i = 0; i < 10; i++) Q[u*10+i] += Q[v*10+i];
    for (const f of vtris[v]) {
      if (!alive[f]) continue;
      const hasU = T[3*f] === u || T[3*f+1] === u || T[3*f+2] === u;
      if (hasU) { alive[f] = 0; live--; continue; }
      for (let s = 0; s < 3; s++) if (T[3*f+s] === v) T[3*f+s] = u;
      vtris[u].push(f);
    }
    vtris[u] = vtris[u].filter(f => alive[f]); vtris[v] = [];
    merged[v] = u; stamp[u]++; stamp[v]++;
    collapses++;
    for (const w of neighbors(u)) { stamp[w]++; }
    for (const w of neighbors(u)) { pushEdge(Math.min(u, w), Math.max(u, w));
      for (const x of neighbors(w)) if (x !== u) pushEdge(Math.min(w, x), Math.max(w, x)); }
  }
  const outT = [];
  for (let f = 0; f < nt; f++) if (alive[f]) outT.push(T[3*f], T[3*f+1], T[3*f+2]);
  if (log) log(`  qem ${nt} -> ${live} tris (${collapses} collapses, ${rejected} rejected)`);
  // compact
  const map = new Int32Array(nv).fill(-1), np = [], tt = new Int32Array(outT.length);
  for (let i = 0; i < outT.length; i++) { const v = outT[i]; if (map[v] < 0) { map[v] = np.length/3; np.push(P[3*v], P[3*v+1], P[3*v+2]); } tt[i] = map[v]; }
  return { pos: Float64Array.from(np), tris: tt };
}
