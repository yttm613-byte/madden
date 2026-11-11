/* body.mjs — the player, sculpted as signed distance fields in the BIND pose.
 *
 * Each part is its own field so it can be meshed at its own resolution, carry its
 * own material, and hide what it covers (skin under the jersey is culled, not kept
 * and z-fought). Anatomy is laid out on the rig's joints, so moving a joint in
 * rig.mjs moves the flesh with it.
 *
 * Where one layer ends over another — a sleeve over the arm, a glove cuff over the
 * wrist, a sock into a cleat — the outer layer is built as an offset of the inner
 * one with a lip at its edge, so the seam is a real overlap rather than two meshes
 * crossing at a jagged line.
 */
import fs from 'fs';
import zlib from 'zlib';
import { sphere, ellipsoid, roundCone, capsule, roundBox, torus, plane, union, sunion, sunionK, intersect,
  subtract, ssubtract, smax, smin, shell, offset, mirrorX, displace, frameY, frameEuler, norm, sub, add, mul, cross, dot, lerp3,
  fbm3, noise3, smoothstep, len } from './sdf.mjs';

const smax2 = (fa, fb, k) => (x, y, z) => { const a = fa(x, y, z), b = fb(x, y, z); const h = Math.max(k-Math.abs(a-b), 0)/k; return Math.max(a, b) + h*h*k*0.25; };
const smin2 = (fa, fb, k) => (x, y, z) => { const a = fa(x, y, z), b = fb(x, y, z); const h = Math.max(k-Math.abs(a-b), 0)/k; return Math.min(a, b) - h*h*k*0.25; };
const cut = (f, g, k = 0.004) => smax2(f, (x, y, z) => -g(x, y, z), k);          // f minus g
const rot = (v, axis, ang) => { // rotate vector v about unit axis (Rodrigues)
  const c = Math.cos(ang), s = Math.sin(ang), d = dot(axis, v), cr = cross(axis, v);
  return [v[0]*c + cr[0]*s + axis[0]*d*(1-c), v[1]*c + cr[1]*s + axis[1]*d*(1-c), v[2]*c + cr[2]*s + axis[2]*d*(1-c)];
};

// The real body: signed distance to MakeHuman's CC0 body posed on this skeleton, on a 4mm
// grid (human/body_prep.py). Everything worn is built round it. SCULPT_BODY=1 keeps the
// hand-sculpted body instead.
function realBody() {
  const meta = JSON.parse(fs.readFileSync(new URL('./human/body_sdf.json', import.meta.url)));
  const buf = zlib.gunzipSync(fs.readFileSync(new URL('./human/body_sdf.bin.gz', import.meta.url)));
  const a = new Int16Array(buf.buffer, buf.byteOffset, buf.length/2), [nx, ny, nz] = meta.n, [lx, ly, lz] = meta.lo, h = meta.h, u = meta.unit;
  const sampler = arr => (x, y, z) => {
    let fx = (Math.abs(x)-lx)/h, fy = (y-ly)/h, fz = (z-lz)/h, out = 0;
    const cl = (v, n) => { const c = Math.max(0, Math.min(n-1.001, v)); out += (v-c)*(v-c); return c; };
    fx = cl(fx, nx); fy = cl(fy, ny); fz = cl(fz, nz);
    const i = fx|0, j = fy|0, k = fz|0, tx = fx-i, ty = fy-j, tz = fz-k, o = (i*ny + j)*nz + k, sx = ny*nz, sy = nz;
    const c00 = arr[o]*(1-tz) + arr[o+1]*tz, c01 = arr[o+sy]*(1-tz) + arr[o+sy+1]*tz, c10 = arr[o+sx]*(1-tz) + arr[o+sx+1]*tz, c11 = arr[o+sx+sy]*(1-tz) + arr[o+sx+sy+1]*tz;
    return ((c00*(1-ty) + c01*ty)*(1-tx) + (c10*(1-ty) + c11*ty)*tx)*u + Math.sqrt(out)*h;
  };
  // A blurred copy (sigma 2cm): cloth does not follow every muscle, it spans the hollows.
  // The grid holds x >= 0 only, so the blur reflects at x = 0 the way the body does.
  const soft = Float32Array.from(a), tmp = new Float32Array(a.length), R = 10, w = [];
  for (let d = -R; d <= R; d++) w.push(Math.exp(-d*d/(2*5*5)));
  const ws = w.reduce((p, c) => p + c, 0), i0 = Math.round(-lx/h);
  const pass = (src, dst, n, stride, mirror) => { const outer = a.length/n/stride;
    for (let b = 0; b < outer; b++) for (let r = 0; r < stride; r++) { const base = b*n*stride + r;
      for (let q = 0; q < n; q++) { let acc = 0;
        for (let d = -R; d <= R; d++) { let t = q + d; if (mirror && t < i0) t = 2*i0 - t; t = t < 0 ? 0 : t >= n ? n-1 : t; acc += w[d+R]*src[base + t*stride]; }
        dst[base + q*stride] = acc/ws; } } };
  pass(soft, tmp, nz, 1, false); pass(tmp, soft, ny, nz, false); pass(soft, tmp, nx, ny*nz, true);
  return { exact: sampler(a), soft: sampler(tmp) };
}

export function buildBody(rig) {
  const B = n => { const p = rig.byName[n].bindPos; return [p.x, p.y, p.z]; };
  const FWD = [0, 0, 1];
  const REAL = process.env.SCULPT_BODY ? null : realBody(), RB = REAL && REAL.exact;
  // the line between the trunk and an arm: down the armpit, then out along the inside of the arm
  const xb = y => 0.185 + Math.max(0, 1.45 - y)*0.42;

  // ============================ HEAD ============================
  const EYE = [0.0315, 1.766, 0.0735], EYE_R = 0.0122;
  const head = (() => {
    const cranium = ellipsoid([0, 1.772, -0.020], [0.077, 0.097, 0.100]);
    const face = ellipsoid([0, 1.728, 0.030], [0.066, 0.084, 0.072]);
    const jaw = ellipsoid([0, 1.689, 0.022], [0.066, 0.046, 0.066]);
    const jawAngle = mirrorX(ellipsoid([0.051, 1.681, -0.004], [0.018, 0.029, 0.030]));
    const chin = ellipsoid([0, 1.659, 0.073], [0.025, 0.019, 0.019]);
    const cheek = mirrorX(ellipsoid([0.049, 1.752, 0.056], [0.021, 0.015, 0.020]));
    const brow = ellipsoid([0, 1.787, 0.075], [0.052, 0.011, 0.019]);
    const noseBridge = roundCone([0, 1.776, 0.088], [0, 1.735, 0.110], 0.0075, 0.0105);
    const noseTip = sphere([0, 1.729, 0.114], 0.0118);
    const alae = mirrorX(sphere([0.0135, 1.722, 0.100], 0.0092));
    const upperLip = ellipsoid([0, 1.702, 0.096], [0.025, 0.0082, 0.0110]);
    const lowerLip = ellipsoid([0, 1.6895, 0.0945], [0.022, 0.0090, 0.0108]);
    const ear = mirrorX(ellipsoid([0.075, 1.763, -0.012], [0.011, 0.030, 0.019]));
    let h = sunionK([[cranium, 0], [face, 0.035], [jaw, 0.03], [jawAngle, 0.02], [chin, 0.018], [cheek, 0.02], [brow, 0.018],
      [noseBridge, 0.012], [noseTip, 0.008], [alae, 0.006], [upperLip, 0.008], [lowerLip, 0.008], [ear, 0.01]]);
    h = cut(h, mirrorX(ellipsoid([EYE[0], 1.766, 0.082], [0.019, 0.0125, 0.013])), 0.008);   // sockets
    h = cut(h, ellipsoid([0, 1.6965, 0.104], [0.022, 0.0012, 0.010]), 0.002);                // mouth line
    h = cut(h, mirrorX(ellipsoid([0.0075, 1.7155, 0.106], [0.004, 0.0025, 0.004])), 0.002); // nostrils
    const lidUpper = intersect(shell(sphere(EYE, EYE_R+0.0022), 0.0026), plane([0, EYE[1]+0.0035, 0], [0, -1, 0]));
    const lidLower = intersect(shell(sphere(EYE, EYE_R+0.0020), 0.0022), plane([0, EYE[1]-0.0052, 0], [0, 1, 0]));
    return smin2(h, mirrorX(union(lidUpper, lidLower)), 0.004);
  })();
  const eyes = mirrorX(sphere(EYE, EYE_R));

  // ============================ NECK & TORSO ============================
  const neck = RB ? intersect(RB, (x, y, z) => Math.max(Math.abs(y-1.57)-0.16, Math.abs(x)-0.13)) : sunionK([
    [roundCone([0, 1.440, -0.036], [0, 1.668, -0.012], 0.090, 0.072), 0],
    [mirrorX(capsule([0.050, 1.702, -0.020], [0.021, 1.500, 0.052], 0.019)), 0.03],   // sternocleidomastoid
    [ellipsoid([0, 1.535, -0.066], [0.066, 0.068, 0.036]), 0.045],                    // back of the neck / traps
  ]);
  const torso = RB ? intersect(RB, (x, y, z) => Math.max(Math.abs(x)-xb(y), 0.90-y, y-1.62)) : sunionK([
    [ellipsoid([0, 1.370, 0.004], [0.190, 0.172, 0.134]), 0],
    [ellipsoid([0, 1.170, 0.010], [0.154, 0.140, 0.112]), 0.06],
    [ellipsoid([0, 1.005, -0.006], [0.162, 0.105, 0.118]), 0.06],
    [mirrorX(capsule([0.02, 1.512, -0.050], [0.165, 1.482, -0.040], 0.056)), 0.05],   // trapezius
    [mirrorX(ellipsoid([0.085, 1.415, 0.068], [0.088, 0.066, 0.045])), 0.04],         // pecs
  ]);

  // ============================ ARMS ============================
  const S = B('LeftArm'), E = B('LeftForeArm'), Wr = B('LeftHand');
  const aU = norm(sub(E, S)), aF = norm(sub(Wr, E));
  const antU = norm(sub(FWD, mul(aU, dot(FWD, aU)))), latU = norm(cross(antU, aU));
  const antF = norm(sub(FWD, mul(aF, dot(FWD, aF)))), latF = norm(cross(antF, aF));
  const PU = (t, an, la) => add(add(add(S, mul(aU, t)), mul(antU, an)), mul(latU, la));
  const PF = (t, an, la) => add(add(add(E, mul(aF, t)), mul(antF, an)), mul(latF, la));
  const frU = [latU, aU, antU], frF = [latF, aF, antF];
  const armL = RB ? intersect(RB, (x, y, z) => xb(y)-x, plane(add(Wr, mul(aF, 0.02)), aF)) : sunionK([
    [roundCone(add(S, mul(aU, 0.012)), E, 0.061, 0.045), 0],
    [ellipsoid(PU(0.042, 0.004, 0.022), [0.058, 0.080, 0.064], frU), 0.03],      // deltoid
    [ellipsoid(PU(0.160, 0.028, 0.000), [0.047, 0.094, 0.046], frU), 0.025],     // biceps
    [ellipsoid(PU(0.135, -0.028, 0.004), [0.051, 0.102, 0.046], frU), 0.025],    // triceps
    [ellipsoid(PU(0.210, 0.004, 0.017), [0.031, 0.052, 0.026], frU), 0.02],      // brachialis
    [sphere(add(E, mul(antU, -0.008)), 0.039), 0.03],                            // elbow
    [sphere(add(add(E, mul(antU, -0.033)), mul(aU, -0.006)), 0.018), 0.015],     // olecranon
    [roundCone(E, Wr, 0.048, 0.031), 0.03],
    [ellipsoid(PF(0.070, 0.009, -0.011), [0.045, 0.090, 0.039], frF), 0.03],    // flexors
    [ellipsoid(PF(0.050, 0.006, 0.022), [0.036, 0.084, 0.037], frF), 0.03],     // brachioradialis
    [ellipsoid(PF(0.245, 0, 0), [0.020, 0.030, 0.031], frF), 0.02],             // wrist
  ]);
  const arms = mirrorX(armL);
  const skinFull = RB ? sunionK([[intersect(RB, (x, y, z) => Math.max(0.88-y, y-1.66)), 0], [head, 0.035]]) : sunionK([[torso, 0], [neck, 0.05], [head, 0.035], [arms, 0.05]]);

  // ============================ GLOVES ============================
  const glovesL = (() => {
    const M = B('LeftHandMiddle1');
    const hy = norm(sub(M, Wr));
    const hz = norm(sub(B('LeftHandIndex1'), B('LeftHandPinky1')));
    const hx = norm(cross(hy, hz));
    const fr = [hz, hy, hx];
    const parts = [
      [roundBox(add(Wr, mul(hy, 0.050)), [0.041, 0.047, 0.0158], 0.0135, fr), 0],                    // palm
      [ellipsoid(add(add(Wr, mul(hy, 0.034)), mul(hz, 0.028)), [0.019, 0.034, 0.017], fr), 0.012],   // thenar pad
      [ellipsoid(add(Wr, mul(hy, 0.012)), [0.035, 0.022, 0.021], fr), 0.018],                         // heel of the hand
    ];
    const R = { Index: 0.0101, Middle: 0.0107, Ring: 0.0100, Pinky: 0.0087, Thumb: 0.0117 };
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'])
      for (let k = 1; k <= 3; k++) {
        const a = B('LeftHand'+f+k), b = B('LeftHand'+f+(k+1));
        parts.push([roundCone(a, b, R[f]*(1-0.05*(k-1)), R[f]*(1-0.05*k)), k === 1 ? 0.012 : 0.003]);
      }
    const hand = sunionK(parts);
    // cuff: the forearm itself, grown by the glove thickness, from 5.5cm above the wrist
    const cuffEnd = add(Wr, mul(aF, -0.058));
    const cuff = intersect(offset(armL, 0.0032), plane(cuffEnd, mul(aF, -1)));
    const lip = torus(add(cuffEnd, mul(aF, 0.0012)), 0.0305, 0.0022, [latF, aF, antF]);
    return smin2(smin2(hand, intersect(cuff, plane(add(Wr, mul(aF, 0.02)), aF)), 0.01), intersect(lip, offset(armL, 0.006)), 0.002);
  })();
  const gloves = mirrorX(glovesL);

  // ============================ LEGS ============================
  const legL = (() => {
    const H = B('LeftUpLeg'), K = B('LeftLeg'), A = B('LeftFoot');
    const a = norm(sub(K, H)), a2 = norm(sub(A, K));
    const ant = norm(sub(FWD, mul(a, dot(FWD, a)))), lat = norm(cross(a, ant));
    const ant2 = norm(sub(FWD, mul(a2, dot(FWD, a2)))), lat2 = norm(cross(a2, ant2));
    const fr = [lat, a, ant], fr2 = [lat2, a2, ant2];
    const P = (t, an, la) => add(add(add(H, mul(a, t)), mul(ant, an)), mul(lat, la));
    const Q = (t, an, la) => add(add(add(K, mul(a2, t)), mul(ant2, an)), mul(lat2, la));
    return sunionK([
      [roundCone(add(H, [0, 0.01, 0]), K, 0.097, 0.062), 0],
      [ellipsoid(P(0.20, 0.032, 0.012), [0.071, 0.178, 0.064], fr), 0.04],     // quads
      [ellipsoid(P(0.17, -0.036, 0.000), [0.062, 0.165, 0.058], fr), 0.04],    // hamstrings
      [ellipsoid(P(0.33, 0.028, -0.030), [0.034, 0.070, 0.036], fr), 0.03],    // vastus medialis
      [sphere(add(K, mul(ant, 0.010)), 0.051), 0.03],                          // knee
      [roundCone(K, add(A, [0, 0.030, 0]), 0.058, 0.039), 0.03],
      [ellipsoid(Q(0.125, -0.036, -0.006), [0.059, 0.128, 0.056], fr2), 0.03], // calf
      [ellipsoid(Q(0.105, -0.022, 0.020), [0.041, 0.104, 0.041], fr2), 0.03],  // outer calf
      [sphere(A, 0.036), 0.02],
    ]);
  })();
  const legs = RB ? union(intersect(RB, (x, y, z) => Math.max(y-1.02, 0.072-y, Math.abs(x)-xb(y))), mirrorX(sphere(B('LeftFoot'), 0.036))) : mirrorX(legL);
  // with a real body the pelvis and legs are one surface, so nothing is blended on top of itself
  const pelvis = RB ? intersect(RB, (x, y, z) => Math.max(y-1.13, 0.072-y, Math.abs(x)-xb(y))) : sunionK([
    [ellipsoid([0, 1.000, -0.004], [0.166, 0.110, 0.122]), 0],
    [mirrorX(ellipsoid([0.082, 0.938, -0.070], [0.088, 0.095, 0.080])), 0.05],   // glutes
  ]);

  // The tucked-in jersey's waist. The pants are built around it, so the jersey is
  // always INSIDE the pants below the waistband instead of poking out over them.
  const WAIST = ellipsoid([0, 1.058, 0.000], [0.170, 0.100, 0.128]);
  let PANTS_BODY;
  // ============================ PANTS ============================
  const K_L = B('LeftLeg'), A_L = B('LeftFoot');
  const shinDir = norm(sub(A_L, K_L));
  const pants = (() => {
    const pads = [];
    for (const s of [1, -1]) {
      const H = B('LeftUpLeg'), K = K_L;
      const h = [H[0]*s, H[1], H[2]], k = [K[0]*s, K[1], K[2]];
      const a = norm(sub(k, h)), ant = norm(sub(FWD, mul(a, dot(FWD, a)))), lat = norm(cross(a, ant));
      pads.push([roundBox(add(add(h, mul(a, 0.20)), mul(ant, RB ? 0.076 : 0.082)), [0.054, 0.090, 0.012], 0.011, [lat, a, ant]), 0.03]);   // thigh pad
      pads.push([roundBox(add(add(k, mul(ant, RB ? 0.050 : 0.062)), mul(a, -0.010)), RB ? [0.040, 0.046, 0.010] : [0.048, 0.050, 0.013], RB ? 0.009 : 0.011, [lat, a, ant]), RB ? 0.03 : 0.020]); // knee pad
      pads.push([ellipsoid([0.156*s, 0.994, 0.004], [0.020, 0.056, 0.066]), 0.04]);   // hip pad
    }
    const bodyShape = sunionK([[pelvis, 0], ...(RB ? [] : [[legs, 0.06]]), ...pads, [ellipsoid([0, 0.99, -0.118], [0.058, 0.048, 0.02]), 0.04], [WAIST, 0.05]]);
    let p = offset(bodyShape, 0.0085);
    PANTS_BODY = p;
    // folds: behind the knee and across the hip crease
    p = displace(p, (x, y, z) => {
      const ax = Math.abs(x), dk = Math.hypot(ax-K_L[0], y-K_L[1]-0.01);
      const back = smoothstep(K_L[2]+0.005, K_L[2]-0.03, z);
      const knee = back*smoothstep(0.08, 0.02, dk)*0.0028*Math.sin(y*170 + 1.2*noise3(x*18, y*18, z*18));
      const hip = smoothstep(0.05, 0.0, Math.abs(y-0.915+0.25*(ax-0.1)))*smoothstep(-0.02, 0.04, z)*0.0014*Math.sin((y+0.3*ax)*190);
      return knee + hip;
    });
    p = smax2(p, plane([0, 1.086, 0], [0, 1, 0]), 0.004);
    const hem = s => plane(add([K_L[0]*s, K_L[1], K_L[2]], mul([shinDir[0]*s, shinDir[1], shinDir[2]], 0.082)), [shinDir[0]*s, shinDir[1], shinDir[2]]);
    const h1 = hem(1), h2 = hem(-1);
    return smax2(p, (x, y, z) => x >= 0 ? h1(x, y, z) : h2(x, y, z), 0.004);
  })();
  const belt = intersect(offset(sunionK([[pelvis, 0], [WAIST, 0.05]]), 0.0142), plane([0, 1.083, 0], [0, 1, 0]), plane([0, 1.052, 0], [0, -1, 0]));

  // ============================ SOCKS ============================
  const SOCK_TOP = add(K_L, mul(shinDir, 0.030));
  const socks = (() => {
    const topL = plane(SOCK_TOP, mul(shinDir, -1));
    let s = offset(legs, 0.0035);
    s = intersect(s, (x, y, z) => x >= 0 ? topL(x, y, z) : topL(-x, y, z));
    // ribbed top band, slightly thicker
    const band = intersect(offset(legs, 0.0052), (x, y, z) => { const q = x >= 0 ? [x, y, z] : [-x, y, z]; const d = dot(sub(q, SOCK_TOP), shinDir); return Math.max(-d - 0.022, d); });
    return smin2(s, band, 0.002);
  })();

  // ============================ CLEATS ============================
  const cleatL = (() => {
    const A = B('LeftFoot'), T = B('LeftToe_End');
    const fwd = norm([T[0]-A[0], 0, T[2]-A[2]]), side = norm(cross([0, 1, 0], fwd));
    const G = (f, s, y) => [A[0] + fwd[0]*f + side[0]*s, y, A[2] + fwd[2]*f + side[2]*s];
    const fr = [side, [0, 1, 0], fwd];
    let upper = sunionK([
      [ellipsoid(G(0.170, 0.002, 0.030), [0.046, 0.025, 0.058], fr), 0],        // toe box
      [ellipsoid(G(0.100, 0.004, 0.040), [0.051, 0.035, 0.076], fr), 0.03],     // forefoot
      [ellipsoid(G(0.020, 0.000, 0.058), [0.044, 0.050, 0.074], fr), 0.035],    // instep
      [ellipsoid(G(-0.052, 0.000, 0.052), [0.039, 0.048, 0.042], fr), 0.03],    // heel
      [roundCone(G(-0.006, 0, 0.066), G(-0.010, 0, 0.108), 0.043, 0.041), 0.025], // collar
    ]);
    upper = smax2(upper, plane([0, 0.010, 0], [0, -1, 0]), 0.004);
    // sole: the outline of the upper near its base, 3mm proud, 7mm thick
    const outline = (x, y, z) => upper(x, 0.026, z) - 0.0025;
    const sole = (x, y, z) => Math.max(outline(x, y, z), Math.abs(y-0.0065) - 0.0055);
    let c = smin2(upper, sole, 0.004);
    const studs = [];
    for (const [f, s] of [[0.19, 0.022], [0.19, -0.020], [0.125, 0.030], [0.125, -0.028], [0.065, 0.0], [-0.03, 0.022], [-0.03, -0.022]])
      studs.push(roundCone(G(f, s, 0.003), G(f, s, -0.010), 0.0068, 0.0042));
    for (const st of studs) c = smin2(c, st, 0.003);   // blended, not butted: a hard crease pinches the mesh
    const oc = G(-0.010, 0, 0);
    return smax2(c, (x, y, z) => -Math.max(Math.hypot(x-oc[0], z-oc[2]) - 0.0385, 0.092 - y), 0.004);
  })();
  const cleats = mirrorX(cleatL);

  // ============================ JERSEY OVER SHOULDER PADS ============================
  // Real pads make the silhouette: the shoulders of a player in pads are nearly three
  // helmets wide, flat across the top with a hard shelf at each edge, and the arch
  // rises toward the neck so the helmet sits down into them. The first pads were a
  // modest bump on natural shoulders and read as a man in a T-shirt.
  const padsL = (() => {
    // Modern pads are low and sloped: the yoke falls away from the neck to the point of
    // the shoulder, and a rounded cap sits over the deltoid. The first pads here were a
    // flat shelf with a slab epaulet on top of it; lit from above they read as a pillow,
    // and with the arm down the slab's corner stood up like a wing.
    const arch = roundBox([0.148, 1.556, -0.016], [0.150, 0.036, 0.158], 0.036, frameEuler(0, 0, -0.13));
    const archIn = roundBox([0.094, 1.570, -0.020], [0.060, 0.028, 0.140], 0.028, frameEuler(0, 0, -0.34));
    const capC = add(add(S, mul(latU, 0.060)), mul(aU, 0.012));
    const cap = roundBox(add(capC, mul(latU, 0.004)), [0.046, 0.084, 0.112], 0.044, [latU, aU, antU]);
    return sunionK([[arch, 0], [archIn, 0.04], [cap, 0.06]]);
  })();
  const pads = sunionK([
    [mirrorX(padsL), 0],
    [roundBox([0, 1.446, 0.090], [0.198, 0.100, 0.052], 0.046), 0.045],   // front plates
    [roundBox([0, 1.456, -0.112], [0.206, 0.112, 0.060], 0.050), 0.045],  // back plates
  ]);
  // Where the trim colour goes: a band around the neck opening and one at each sleeve
  // hem. A soft 0..1 mask (1 inside the band) used both for the rib and the split.
  const sleeveEnd = add(S, mul(aU, 0.142));
  const axisD = (q) => { const r = sub(q, S), t = dot(r, aU); return len(sub(r, mul(aU, t))); };
  // The sleeve stripe: a 2.4cm band round the cap, a finger above the hem. Its edges are
  // planes across the arm (STRIPE_CUTS), cut one at a time so a long triangle cannot
  // step over the band, which is what a single |t-c|-w field lets it do.
  const ST0 = 0.076, ST1 = 0.100;
  const sleeveT = (x, y, z) => { const q = x >= 0 ? [x, y, z] : [-x, y, z]; return dot(sub(q, sleeveEnd), aU) + 0.142; };
  const sleeveR = (x, y, z) => axisD(x >= 0 ? [x, y, z] : [-x, y, z]);
  const sleeveLat = (x, y, z) => dot(sub(x >= 0 ? [x, y, z] : [-x, y, z], S), latU);
  const STRIPE_CUTS = [(x, y, z) => sleeveT(x, y, z) - ST0, (x, y, z) => sleeveT(x, y, z) - ST1,
    (x, y, z) => sleeveR(x, y, z) - 0.150, (x, y, z) => -sleeveLat(x, y, z) - 0.035];
  const inSleeveStripe = (x, y, z) => { const t = sleeveT(x, y, z); return t > ST0 && t < ST1 && sleeveR(x, y, z) < 0.150 && sleeveLat(x, y, z) > -0.035; };
  const TRIM_D = (x, y, z) => {
    const collarD = COLLAR(x, y, z) - 0.022;                             // < 0 within 1.6cm of the opening
    const q = x >= 0 ? [x, y, z] : [-x, y, z]; const t = dot(sub(q, sleeveEnd), aU);
    // One-sided: negative past the plane 1.5cm from the hem. A max() of the two slab
    // faces put its kink inside the band, and linear interpolation across a decimated
    // triangle skipped right over it — that was the sawtooth hem.
    const sleeveD = Math.max(-(t + 0.015), axisD(q) - 0.108, -dot(sub(q, S), latU) - 0.035);
    return Math.min(collarD, sleeveD);
  };
  const TRIM_MASK = (x, y, z) => smoothstep(0.0008, -0.0008, TRIM_D(x, y, z));
  // Crew collar, a touch lower at the front of the throat than at the nape.
  // A V-neck, as on the reference photographs: the round neck hole plus a wedge in front
  // whose point sits on the breastbone. (The first collar's front notch was a small
  // ellipsoid, which opened a keyhole in the chest plate, not a V.)
  const COLLAR = sunionK([[roundCone([0, 1.46, -0.036], [0, 1.66, -0.014], 0.089, 0.085), 0],
    [(x, y, z) => Math.max((Math.abs(x)*0.80 - (y-1.468)*0.62)*0.79, 0.015 - z, y - 1.64), 0.012]]);
  const jersey = (() => {
    // over a real body the jersey is simply that body's own shape, a finger's width out
    // (kept a little inside the armpit line, so no sliver of it reaches the arm)
    const inJ = (x, y, z) => Math.max(Math.abs(x)-xb(y)+0.018, 0.90-y, y-1.62);
    const softTorso = RB && intersect(REAL.soft, inJ);
    const core = RB ? sunionK([[offset(intersect(RB, inJ), 0.005), 0], [offset(softTorso, 0.017), 0.02], [WAIST, 0.05]]) : sunionK([
      [ellipsoid([0, 1.345, 0.000], [0.202, 0.180, 0.140]), 0],
      [roundBox([0, 1.225, 0.030], [0.166, 0.165, 0.094], 0.075), 0.07],   // front of the torso: flat, not bulbous
      [ellipsoid([0, 1.160, 0.006], [0.174, 0.170, 0.124]), 0.06],
      [mirrorX(ellipsoid([0.142, 1.300, -0.036], [0.060, 0.135, 0.084])), 0.06],   // lats: the V from the pads to the waist
      [ellipsoid([0, 1.370, -0.070], [0.165, 0.150, 0.082]), 0.06],                // upper back
      [WAIST, 0.06],
    ]);
    // sleeves: snug tubes over the cap and the top of the arm
    const sleeveEnd = add(S, mul(aU, 0.142));
    const sleeveL = intersect(sunionK([[roundCone(add(S, mul(aU, -0.015)), sleeveEnd, 0.080, 0.069), 0], [offset(armL, 0.009), 0.01]]),
      plane(sleeveEnd, aU), plane(add(S, mul(latU, -0.10)), mul(latU, -1)));
    let j = sunionK([[core, 0], [pads, 0.038], [mirrorX(sleeveL), 0.03]]);
    // wrinkles where the jersey tucks in, and a little drag under the pads
    j = displace(j, (x, y, z) => {
      const tuck = smoothstep(1.16, 1.10, y)*smoothstep(1.075, 1.10, y);
      const w = tuck*0.0034*Math.sin(y*105 + 1.9*noise3(x*7, y*2, z*7) + Math.abs(x)*14);
      const side = smoothstep(0.12, 0.18, Math.abs(x));
      const drape = side*smoothstep(1.34, 1.27, y)*smoothstep(1.14, 1.22, y)*0.0026*Math.sin((y + 0.55*Math.abs(z))*105 + 2*noise3(x*12, 0, z*12));
      // the cloth hangs off the chest plate and pulls across the belly
      const belly = smoothstep(1.36, 1.30, y)*smoothstep(1.12, 1.20, y)*(1-side)*0.0022*Math.sin(x*52 + 3.0*noise3(x*5, y*9, z*5) + y*26);
      return w + drape + belly;
    });
    // neck opening with a shallow V in front
    j = cut(j, COLLAR, 0.012);
    // tucked: below the waistband the jersey is held 5mm inside the pants
    const tuck = (x, y, z) => PANTS_BODY(x, y, z) + 0.005 - 0.6*smoothstep(1.092, 1.115, y);
    j = smax2(j, tuck, 0.006);
    return smax2(j, plane([0, 1.02, 0], [0, -1, 0]), 0.01);
  })();


  // ============================ HELMET ============================
  // The stripe sits in a 2.5mm bed cut into the shell, so its edge is a real step in
  // the helmet's own geometry rather than two surfaces crossing at a shallow angle.
  const STRIPE_W = 0.024;
  let STRIPE_BED;
  const HC = [0, 1.773, -0.014];
  // The back of a real shell drops almost straight from its widest point to a rim at
  // the base of the skull. The first version was an egg-shaped dome with a lobe blended
  // on underneath: it sagged into a pear at the back, its rim hung to the middle of the
  // neck, and the stripe — laid on the dome alone — dived under the lobe and stopped
  // halfway down with a ragged end.
  // A real shell is not an ellipsoid: the crown is flatter and the sides and back fuller,
  // seen from the front. An ellipsoid tall enough to clear the head came to a point on
  // top and read as an egg. So: squared off across (exponent 2.4) but round front to
  // back, which keeps the classic round side profile.
  const SQ = 2.4, sq = v => Math.pow(Math.abs(v), SQ);
  const dome = (x, y, z) => { const a = Math.pow(sq(x/0.134) + sq((y-HC[1])/0.137), 1/SQ), b = (z-HC[2])/0.160; return (Math.hypot(a, b) - 1)*0.134; };
  const skirt = smax2(intersect((x, y, z) => (Math.hypot(x/0.128, (z-HC[2])/0.154) - 1)*0.128, (x, y, z) => y - HC[1]),
    (x, y, z) => z - HC[2] - 0.02, 0.05);
  const shellOuter = sunionK([[dome, 0], [skirt, 0.03]]);
  const helmetFill = sunionK([
    [shellOuter, 0],
    [mirrorX(ellipsoid([0.098, 1.690, 0.044], [0.031, 0.080, 0.082])), 0.05],   // jaw flaps, swept forward to the chin
  ]);
  // the face opening: square-shouldered, a level brow line and upright jaw flaps, not an oval
  const faceHole = roundBox([0, 1.711, 0.170], [0.081, 0.086, 0.168], 0.034);
  // bumpers: the raised pads at the brow and at the base of the skull
  const bumpers = union(
    intersect(offset(shellOuter, 0.0045), roundBox([0, 1.8215, 0.13], [0.043, 0.0135, 0.08], 0.008)),
    intersect(offset(shellOuter, 0.0045), roundBox([0, 1.683, -0.15], [0.050, 0.0135, 0.07], 0.008)));
  // the lower edge arches up over the ear and comes down at the nape and at the jaw flap
  const rimAt = z => 1.668 - 1.2*(z+0.03)*(z+0.03);
  const RIM = (x, y, z) => rimAt(z) - y;
  // the shell cuts back at eye level between the brow and the jaw flap
  const eyeNotch = mirrorX(ellipsoid([0.135, 1.766, 0.128], [0.085, 0.031, 0.082]));
  STRIPE_BED = intersect((x, y, z) => Math.abs(x) - STRIPE_W, offset(shellOuter, 0.004),
    (x, y, z) => -shellOuter(x, y, z) - 0.0025, (x, y, z) => rimAt(z) + 0.005 - y, (x, y, z) => -faceHole(x, y, z) + 0.012);
  const helmet = (() => {
    const inner = sunionK([[ellipsoid(HC, [0.108, 0.120, 0.138]), 0], [mirrorX(ellipsoid([0.082, 1.684, 0.036], [0.022, 0.072, 0.064])), 0.05]]);
    let h = cut(helmetFill, inner, 0.004);
    h = cut(h, faceHole, 0.01);
    h = cut(h, eyeNotch, 0.008);
    h = smax2(h, RIM, 0.008);
    h = cut(h, mirrorX((x, y, z) => Math.hypot(y-1.734, z+0.008) - 0.0125 + 0*x), 0.0018);     // ear holes
    h = cut(h, STRIPE_BED, 0.0015);
    h = sunion(0.0025, h, bumpers);                                                       // bed for the stripe
    return h;   // no crown vents: at game distance they read as holes punched in the shell
  })();
  // the stripe runs from above the face opening, over the crown, down to the rim
  const stripe = intersect(offset(shellOuter, 0.0012), (x, y, z) => Math.abs(x) - (STRIPE_W - 0.0004), (x, y, z) => -shellOuter(x, y, z) - 0.0032,
    (x, y, z) => -faceHole(x, y, z) + 0.0124, (x, y, z) => rimAt(z) + 0.0053 - y);
  const facemask = (() => {
    const r = 0.0047;
    const arc = pts => sunion(0.002, ...pts.slice(0, -1).map((p, i) => capsule(p, pts[i+1], r)));
    // each bar is a parabola in plan: out in front at the middle, swept back to the shell
    const curve = (y, zc, xs, zs, yEnds) => t => [t*xs, y + (yEnds-y)*t*t, zc - zs*t*t];
    const bar = c => { const pts = []; const n = 10; for (let i = -n; i <= n; i++) pts.push(c(i/n)); return arc(pts); };
    const link = (a, ta, b2, tb) => mirrorX(capsule(a(ta), b2(tb), r));
    // the cage stands well out in front of the face, as on a real helmet
    const cU = curve(1.726, 0.208, 0.106, 0.128, 1.722), cL = curve(1.670, 0.194, 0.096, 0.117, 1.680);
    const cT = curve(1.786, 0.158, 0.080, 0.064, 1.778), cC = curve(1.640, 0.152, 0.072, 0.074, 1.656);
    const upper = bar(cU), lower = bar(cL), top = bar(cT), chin = bar(cC);
    const centre = capsule(cU(0), cL(0), r);
    const sides = union(link(cU, 0.66, cL, 0.68), link(cT, 1, cU, 0.88));
    const chinLinks = link(cL, 0.65, cC, 0.78);
    return sunion(0.004, upper, lower, top, centre, sides, chin, chinLinks);
  })();
  const visor = intersect(shell(ellipsoid([0, 1.756, 0.010], [0.112, 0.112, 0.150]), 0.0022),
    (x, y, z) => Math.abs(x) - 0.088, (x, y, z) => Math.abs(y-1.756) - 0.027, (x, y, z) => -z + 0.09);
  const chinstrap = (() => {
    const cup = intersect(shell(ellipsoid([0, 1.658, 0.073], [0.030, 0.024, 0.024]), 0.0035), plane([0, 0, 0.062], [0, 0, -1]));
    const strap = (p0, p1) => { const d = norm(sub(p1, p0)), n1 = norm(cross(d, [0, 1, 0])), n2 = norm(cross(n1, d));
      return roundBox(lerp3(p0, p1, 0.5), [0.0032, 0.0075, len(sub(p1, p0))/2], 0.0028, [n1, n2, d]); };
    return union(cup, mirrorX(union(strap([0.026, 1.662, 0.080], [0.097, 1.694, 0.076]), strap([0.025, 1.650, 0.064], [0.099, 1.658, 0.016]))));
  })();

  // ---- kit detail: fields the build cuts materials along ----
  // Pants stripe: down the outside of each leg, hip to hem.
  const HIP_L = B('LeftUpLeg');
  const legAx = y => { const t = Math.max(0, Math.min(1, (HIP_L[1]-y)/(HIP_L[1]-K_L[1]))); return [HIP_L[0] + (K_L[0]-HIP_L[0])*t, HIP_L[2] + (K_L[2]-HIP_L[2])*t]; };
  const PSTRIPE_W = 0.019;
  const PSTRIPE_CUTS = [(x, y, z) => z - legAx(y)[1] - PSTRIPE_W, (x, y, z) => -(z - legAx(y)[1]) - PSTRIPE_W, (x, y, z) => legAx(y)[0] - Math.abs(x)];
  const inPantsStripe = (x, y, z) => { const a = legAx(y); return Math.abs(z - a[1]) < PSTRIPE_W && Math.abs(x) > a[0]; };
  // Socks: team colour to mid-calf, white below it.
  const sockT = (x, y, z) => dot(sub(x >= 0 ? [x, y, z] : [-x, y, z], K_L), shinDir);
  const SOCK_SPLIT = 0.250;
  // Arm: a compression sleeve from above the elbow to the glove, and a wristband on it.
  const armT = (x, y, z) => dot(sub(x >= 0 ? [x, y, z] : [-x, y, z], S), aU);
  const foreT = (x, y, z) => dot(sub(x >= 0 ? [x, y, z] : [-x, y, z], E), aF);
  const ARM = { sleeveFrom: 0.205, band0: 0.150, band1: 0.200, armT, foreT };

  // Jersey and pants as ONE surface: meshed once and cut into materials along the
  // waistline, so the tuck has no mesh-crossing seam at all.
  const uniform = smin2(jersey, pants, 0.003);
  return {
    uniform,
    armL, glovesL, cleatL, EYE, EYE_R, HC, S, aU, latU, antU,
    skinFull, head, neck, torso, arms, eyes, gloves, legs, pelvis, pants, belt, socks, cleats, jersey, pads, TRIM_D,
    STRIPE_CUTS, inSleeveStripe, PSTRIPE_CUTS, inPantsStripe, sockT, SOCK_SPLIT, ARM, shellOuter,
    helmet, helmetFill, faceHole, stripe, facemask, visor, chinstrap,
  };
}
