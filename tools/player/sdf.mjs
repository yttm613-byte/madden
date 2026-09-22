/* sdf.mjs — signed-distance primitives and operators for sculpting the player.
 *
 * Every shape is a plain function (x,y,z) => distance, negative inside. They are
 * built once and evaluated millions of times by the mesher, so nothing in the
 * returned closures allocates. Distances are in metres.
 */
const sqrt = Math.sqrt, abs = Math.abs, max = Math.max, min = Math.min;

// ---- small vector helpers (build time only) ------------------------------------------
export const v3 = (x, y, z) => [x, y, z];
export const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const mul = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
export const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const len = a => sqrt(dot(a, a));
export const norm = a => { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
export const lerp3 = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
export const mirX = a => [-a[0], a[1], a[2]];

// Orthonormal frame whose Y axis is `up`; X is as close to `hint` as possible.
export function frameY(up, hint = [1, 0, 0]) {
  const y = norm(up);
  let x = sub(hint, mul(y, dot(hint, y)));
  if (len(x) < 1e-6) x = sub([0, 0, 1], mul(y, y[2]));
  x = norm(x);
  const z = cross(x, y);
  return [x, y, z];
}
// Rotation frame from yaw/pitch/roll (radians) applied Y then X then Z.
export function frameEuler(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Ry * Rx * Rz ; columns are the local axes expressed in world space
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const m = (A, B) => A.map((r, i) => [0, 1, 2].map(j => A[i][0]*B[0][j] + A[i][1]*B[1][j] + A[i][2]*B[2][j]));
  const R = m(m(Ry, Rx), Rz);
  return [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
}

// ---- primitives -----------------------------------------------------------------------
export function sphere(c, r) {
  const cx = c[0], cy = c[1], cz = c[2];
  return (x, y, z) => { const dx = x-cx, dy = y-cy, dz = z-cz; return sqrt(dx*dx+dy*dy+dz*dz) - r; };
}

// Ellipsoid with radii (rx,ry,rz) along a frame [X,Y,Z] (defaults to world axes).
// Inigo Quilez's bound: k0*(k0-1)/k1. Close to exact near the surface, which is all
// the mesher needs.
export function ellipsoid(c, r, frame) {
  const cx = c[0], cy = c[1], cz = c[2], ax = r[0], ay = r[1], az = r[2];
  const F = frame || [[1,0,0],[0,1,0],[0,0,1]];
  const X = F[0], Y = F[1], Z = F[2];
  return (x, y, z) => {
    const px = x-cx, py = y-cy, pz = z-cz;
    const lx = px*X[0]+py*X[1]+pz*X[2], ly = px*Y[0]+py*Y[1]+pz*Y[2], lz = px*Z[0]+py*Z[1]+pz*Z[2];
    const k0x = lx/ax, k0y = ly/ay, k0z = lz/az;
    const k0 = sqrt(k0x*k0x+k0y*k0y+k0z*k0z);
    const k1x = lx/(ax*ax), k1y = ly/(ay*ay), k1z = lz/(az*az);
    const k1 = sqrt(k1x*k1x+k1y*k1y+k1z*k1z);
    return k1 > 1e-12 ? k0*(k0-1)/k1 : -min(ax, ay, az);
  };
}

// Capsule whose radius tapers from r1 at a to r2 at b (IQ's exact round cone).
export function roundCone(a, b, r1, r2) {
  const ax = a[0], ay = a[1], az = a[2];
  const bax = b[0]-a[0], bay = b[1]-a[1], baz = b[2]-a[2];
  const l2 = bax*bax+bay*bay+baz*baz, rr = r1-r2, a2 = l2-rr*rr, il2 = 1/l2;
  return (x, y, z) => {
    const pax = x-ax, pay = y-ay, paz = z-az;
    const yv = pax*bax+pay*bay+paz*baz, zv = yv-l2;
    const qx = pax*l2-bax*yv, qy = pay*l2-bay*yv, qz = paz*l2-baz*yv;
    const x2 = qx*qx+qy*qy+qz*qz, y2 = yv*yv*l2, z2 = zv*zv*l2;
    const k = Math.sign(rr)*rr*rr*x2;
    if (Math.sign(zv)*a2*z2 > k) return sqrt(x2+z2)*il2 - r2;
    if (Math.sign(yv)*a2*y2 < k) return sqrt(x2+y2)*il2 - r1;
    return (sqrt(x2*a2*il2)+yv*rr)*il2 - r1;
  };
}
export const capsule = (a, b, r) => roundCone(a, b, r, r);

// Rounded box: half extents h, corner radius rad, oriented by frame.
export function roundBox(c, h, rad, frame) {
  const cx = c[0], cy = c[1], cz = c[2];
  const F = frame || [[1,0,0],[0,1,0],[0,0,1]]; const X = F[0], Y = F[1], Z = F[2];
  const hx = h[0]-rad, hy = h[1]-rad, hz = h[2]-rad;
  return (x, y, z) => {
    const px = x-cx, py = y-cy, pz = z-cz;
    const qx = abs(px*X[0]+py*X[1]+pz*X[2])-hx, qy = abs(px*Y[0]+py*Y[1]+pz*Y[2])-hy, qz = abs(px*Z[0]+py*Z[1]+pz*Z[2])-hz;
    const mx = max(qx, 0), my = max(qy, 0), mz = max(qz, 0);
    return sqrt(mx*mx+my*my+mz*mz) + min(max(qx, max(qy, qz)), 0) - rad;
  };
}

// Torus in the frame's XZ plane: major radius R, tube radius r.
export function torus(c, R, r, frame) {
  const cx = c[0], cy = c[1], cz = c[2];
  const F = frame || [[1,0,0],[0,1,0],[0,0,1]]; const X = F[0], Y = F[1], Z = F[2];
  return (x, y, z) => {
    const px = x-cx, py = y-cy, pz = z-cz;
    const lx = px*X[0]+py*X[1]+pz*X[2], ly = px*Y[0]+py*Y[1]+pz*Y[2], lz = px*Z[0]+py*Z[1]+pz*Z[2];
    const q = sqrt(lx*lx+lz*lz)-R; return sqrt(q*q+ly*ly)-r;
  };
}

// Half-space: points on the side the normal faces are OUTSIDE (positive).
export function plane(p, n) {
  const nn = norm(n), nx = nn[0], ny = nn[1], nz = nn[2], d = dot(p, nn);
  return (x, y, z) => x*nx+y*ny+z*nz-d;
}

// Tube along a polyline (piecewise capsules, hard union — joints are round anyway).
export function tube(points, r) {
  const segs = [];
  for (let i = 0; i < points.length-1; i++) segs.push(capsule(points[i], points[i+1], typeof r === 'function' ? r(i) : r));
  return union(...segs);
}

// ---- operators ----------------------------------------------------------------------------
export function union(...fs) {
  if (fs.length === 1) return fs[0];
  if (fs.length === 2) { const a = fs[0], b = fs[1]; return (x, y, z) => min(a(x, y, z), b(x, y, z)); }
  return (x, y, z) => { let d = fs[0](x, y, z); for (let i = 1; i < fs.length; i++) { const e = fs[i](x, y, z); if (e < d) d = e; } return d; };
}
export function smin(a, b, k) { const h = max(k-abs(a-b), 0)/k; return min(a, b) - h*h*k*0.25; }
export function smax(a, b, k) { const h = max(k-abs(a-b), 0)/k; return max(a, b) + h*h*k*0.25; }
// Smooth union of many, blending each successive shape in with radius k.
export function sunion(k, ...fs) {
  if (fs.length === 1) return fs[0];
  return (x, y, z) => {
    let d = fs[0](x, y, z);
    for (let i = 1; i < fs.length; i++) { const e = fs[i](x, y, z); const h = max(k-abs(d-e), 0)/k; d = min(d, e) - h*h*k*0.25; }
    return d;
  };
}
// Smooth union where each shape carries its own blend radius: sunionK([[f,k],[g,k2],...])
export function sunionK(list) {
  const fs = list.map(e => e[0]), ks = list.map(e => e[1] || 0);
  return (x, y, z) => {
    let d = fs[0](x, y, z);
    for (let i = 1; i < fs.length; i++) {
      const e = fs[i](x, y, z), k = ks[i];
      if (k <= 0) { if (e < d) d = e; continue; }
      const h = max(k-abs(d-e), 0)/k; d = min(d, e) - h*h*k*0.25;
    }
    return d;
  };
}
export function intersect(...fs) {
  return (x, y, z) => { let d = fs[0](x, y, z); for (let i = 1; i < fs.length; i++) { const e = fs[i](x, y, z); if (e > d) d = e; } return d; };
}
export function sintersect(k, a, b) { return (x, y, z) => smax(a(x, y, z), b(x, y, z), k); }
export function subtract(a, b) { return (x, y, z) => max(a(x, y, z), -b(x, y, z)); }
export function ssubtract(k, a, b) { return (x, y, z) => smax(a(x, y, z), -b(x, y, z), k); }
// Hollow a solid into a shell of thickness t centred on its surface.
export function shell(f, t) { const h = t/2; return (x, y, z) => abs(f(x, y, z)) - h; }
// Grow (+) or shrink (-) a shape.
export function offset(f, o) { return (x, y, z) => f(x, y, z) - o; }
// Mirror across x=0 (for bilateral symmetry): evaluates f at |x|.
export function mirrorX(f) { return (x, y, z) => f(x < 0 ? -x : x, y, z); }
// Add a displacement field (keep amplitude small relative to features: it breaks the
// distance bound by roughly its gradient).
export function displace(f, g) { return (x, y, z) => f(x, y, z) + g(x, y, z); }
// Axis-aligned bounding box test to skip expensive children far away.
export function bounded(f, lo, hi, pad = 0.02) {
  const x0 = lo[0]-pad, y0 = lo[1]-pad, z0 = lo[2]-pad, x1 = hi[0]+pad, y1 = hi[1]+pad, z1 = hi[2]+pad;
  return (x, y, z) => {
    const dx = max(x0-x, 0, x-x1), dy = max(y0-y, 0, y-y1), dz = max(z0-z, 0, z-z1);
    const d = sqrt(dx*dx+dy*dy+dz*dz);
    return d > 0 ? d + pad : f(x, y, z);   // outside the box: a safe lower bound
  };
}

// Numerical gradient (normalised) — used for normals and for projecting vertices.
export function gradient(f, x, y, z, e = 2.5e-4) {
  const gx = f(x+e, y, z) - f(x-e, y, z), gy = f(x, y+e, z) - f(x, y-e, z), gz = f(x, y, z+e) - f(x, y, z-e);
  const l = sqrt(gx*gx+gy*gy+gz*gz) || 1;
  return [gx/l, gy/l, gz/l];
}

// ---- smooth value noise (for fabric folds, skin variation) ----------------------------
function hash3(i, j, k) {
  let h = (i*374761393 + j*668265263 + k*1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0; h = h ^ (h >>> 16);
  return (h & 0xffffff) / 0xffffff;
}
export function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x-i, fy = y-j, fz = z-k;
  const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy), uz = fz*fz*(3-2*fz);
  const a = hash3(i, j, k), b = hash3(i+1, j, k), c = hash3(i, j+1, k), d = hash3(i+1, j+1, k);
  const e = hash3(i, j, k+1), f = hash3(i+1, j, k+1), g = hash3(i, j+1, k+1), h = hash3(i+1, j+1, k+1);
  const x1 = a+(b-a)*ux, x2 = c+(d-c)*ux, x3 = e+(f-e)*ux, x4 = g+(h-g)*ux;
  const y1 = x1+(x2-x1)*uy, y2 = x3+(x4-x3)*uy;
  return (y1+(y2-y1)*uz)*2-1;
}
export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { s += a*noise3(x*f, y*f, z*f); f *= 2.03; a *= 0.5; }
  return s;
}
export const smoothstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x-e0)/(e1-e0))); return t*t*(3-2*t); };
