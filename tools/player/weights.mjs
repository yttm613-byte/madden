/* weights.mjs — skin weights from the skeleton, not from painting.
 *
 * Every vertex first decides which LIMB it belongs to — torso, an arm, a leg — by
 * its distance to that limb's axis minus the limb's radius at that point, softened so
 * the armpit and groin share. Within a limb it is weighted along the bone chain with
 * smoothstep blends centred on each joint, each blend as wide as that joint really
 * deforms: wide at the hip and shoulder, narrow at the knuckles.
 */
import THREE from './three.mjs';

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };

export function makeWeigher(rig) {
  const { J, byName } = rig;
  const idx = {}; J.forEach((j, i) => idx[j.name] = i);
  const P = n => byName[n].bindPos;
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // polyline helpers
  function chain(names, radii) {
    const pts = names.map(n => (typeof n === 'string' ? P(n) : n).clone());
    const segL = [], cum = [0];
    for (let i = 0; i < pts.length-1; i++) { segL.push(pts[i].distanceTo(pts[i+1])); cum.push(cum[i]+segL[i]); }
    return { names, pts, segL, cum, radii };
  }
  const tmp = v3(0, 0, 0), tmp2 = v3(0, 0, 0);
  function closest(ch, p) {   // -> {d, s (arclength), seg, t}
    let best = { d: Infinity };
    for (let i = 0; i < ch.pts.length-1; i++) {
      const a = ch.pts[i], b = ch.pts[i+1];
      tmp.subVectors(b, a); const l2 = tmp.lengthSq();
      let t = l2 > 0 ? tmp2.subVectors(p, a).dot(tmp)/l2 : 0; t = Math.max(0, Math.min(1, t));
      const d = tmp2.copy(a).addScaledVector(tmp, t).distanceTo(p);
      if (d < best.d) best = { d, seg: i, t, s: ch.cum[i] + t*ch.segL[i] };
    }
    // unclamped projection beyond the ends, for blends that start before the chain
    return best;
  }
  const radiusAt = (ch, s) => {
    const r = ch.radii; if (s <= ch.cum[0]) return r[0];
    for (let i = 0; i < ch.cum.length-1; i++) if (s <= ch.cum[i+1]) { const t = (s-ch.cum[i])/(ch.cum[i+1]-ch.cum[i]); return r[i]+(r[i+1]-r[i])*t; }
    return r[r.length-1];
  };

  const L = {};
  for (const side of ['Left', 'Right']) {
    L[side+'Arm'] = chain([side+'Arm', side+'ForeArm', side+'Hand', side+'HandMiddle1', side+'HandMiddle4'], [0.060, 0.042, 0.030, 0.030, 0.012]);
    L[side+'Leg'] = chain([side+'UpLeg', side+'Leg', side+'Foot', side+'ToeBase', side+'Toe_End'], [0.092, 0.056, 0.040, 0.040, 0.03]);
  }
  const torsoCh = chain([v3(0, 0.90, -0.01), 'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End'], [0.13, 0.15, 0.14, 0.14, 0.16, 0.065, 0.075, 0.07]);

  // ---- per-limb internal weighting ---------------------------------------------------
  function torsoW(p, out) {
    const y = p.y;
    // blend points between consecutive torso bones, by height
    const bones = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
    const cuts = [P('Spine').y, P('Spine1').y, P('Spine2').y+0.02, P('Neck').y+0.015, P('Head').y+0.012];
    const half = [0.045, 0.05, 0.06, 0.035, 0.025];
    let w = [1, 0, 0, 0, 0, 0];
    // successive split: weight of bone k+1 = ss over cut k
    for (let k = 0; k < cuts.length; k++) {
      const up = ss(cuts[k]-half[k], cuts[k]+half[k], y);
      const moved = w[k]*up; w[k] -= moved; w[k+1] += moved;
    }
    // the shoulder girdle: upper chest near the armpits follows the clavicles
    const ax = Math.abs(p.x), side = p.x >= 0 ? 'Left' : 'Right';
    const sh = 0.55*ss(0.09, 0.19, ax)*ss(1.36, 1.46, y)*(1-ss(1.52, 1.58, y));
    for (let k = 0; k < 6; k++) { add(out, bones[k], w[k]*(1-sh)); }
    if (sh > 0) add(out, side+'Shoulder', sh);
  }
  function armW(p, side, out, c) {
    const ch = L[side+'Arm'];
    const s = c.s, sE = ch.cum[1], sW = ch.cum[2], sM = ch.cum[3];
    // shoulder: the first few cm blend from the clavicle/chest into the arm
    const wArmIn = ss(-0.035, 0.055, s);
    const wFore = ss(sE-0.040, sE+0.030, s);
    const wHand = ss(sW-0.012, sW+0.022, s);
    let wArm = wArmIn*(1-wFore), wF = wFore*(1-wHand), wH = wHand;
    const pre = 1-wArmIn;   // goes to shoulder/spine
    add(out, side+'Shoulder', pre*0.65); add(out, 'Spine2', pre*0.35);
    add(out, side+'Arm', wArm); add(out, side+'ForeArm', wF);
    if (wH > 0) handW(p, side, out, wH);
  }
  const FING = {};
  for (const side of ['Left', 'Right']) {
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])
      FING[side+f] = chain([side+'Hand'+f+'1', side+'Hand'+f+'2', side+'Hand'+f+'3', side+'Hand'+f+'4'], [0.012, 0.011, 0.010, 0.009]);
    FING[side+'Palm'] = chain([side+'Hand', side+'HandMiddle1'], [0.03, 0.03]);
  }
  function handW(p, side, out, scale) {
    let best = null, bd = Infinity;
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      const ch = FING[side+f], c = closest(ch, p), d = c.d - radiusAt(ch, c.s);
      if (d < bd) { bd = d; best = { f, ch, c }; }
    }
    const palmD = closest(FING[side+'Palm'], p).d - 0.028;
    const { f, ch } = best, s = best.c.s;
    // into the finger only once past its knuckle and nearer the finger than the palm
    const into = ss(-0.006, 0.006, palmD - bd) * (f === 'Thumb' ? ss(-0.004, 0.012, s) : ss(-0.003, 0.010, s));
    const w1 = ss(ch.cum[1]-0.007, ch.cum[1]+0.005, s), w2 = ss(ch.cum[2]-0.005, ch.cum[2]+0.004, s);
    add(out, side+'Hand', scale*(1-into));
    add(out, side+'Hand'+f+'1', scale*into*(1-w1));
    add(out, side+'Hand'+f+'2', scale*into*w1*(1-w2));
    add(out, side+'Hand'+f+'3', scale*into*w1*w2);
  }
  function legW(p, side, out, c) {
    const ch = L[side+'Leg'], s = c.s, sK = ch.cum[1], sA = ch.cum[2], sB = ch.cum[3];
    // hip: blend pelvis -> thigh over the top of the thigh; the buttock stays with the pelvis longer
    const behind = ss(0.0, -0.06, p.z - P(side+'UpLeg').z);
    const wIn = ss(-0.03 - 0.02*behind, 0.075 + 0.05*behind, s);
    const wK = ss(sK-0.045, sK+0.035, s), wA = ss(sA-0.022, sA+0.018, s), wB = ss(sB-0.014, sB+0.012, s);
    add(out, 'Hips', 1-wIn);
    add(out, side+'UpLeg', wIn*(1-wK)); add(out, side+'Leg', wK*(1-wA)); add(out, side+'Foot', wA*(1-wB)); add(out, side+'ToeBase', wB);
  }
  function add(out, name, w) { if (w > 1e-5) { const i = idx[name]; out.set(i, (out.get(i)||0)+w); } }

  const TAU = 0.010;
  function weigh(x, y, z, mode = 'auto') {
    const p = v3(x, y, z), out = new Map();
    if (mode === 'head') { add(out, 'Head', 1); return pack(out); }
    if (mode === 'torso') { torsoW(p, out); return pack(out); }
    if (mode === 'jersey') {
      // Shoulder pads are rigid: the jersey follows the torso everywhere except the
      // sleeve past the pad cap, which goes with the arm.
      const base = new Map(); torsoW(p, base);
      const side = p.x >= 0 ? 'Left' : 'Right', c = closest(L[side+'Arm'], p);
      const wa = ss(0.035, 0.12, c.s) * ss(0.110, 0.088, c.d);
      const arm = new Map(); if (wa > 0) armW(p, side, arm, c);
      for (const [i, v] of base) out.set(i, (out.get(i)||0) + v*(1-wa));
      for (const [i, v] of arm) out.set(i, (out.get(i)||0) + v*wa);
      return pack(out);
    }
    // soft limb membership
    const cand = [];
    const ct = closest(torsoCh, p); cand.push({ k: 'torso', d: ct.d - radiusAt(torsoCh, ct.s)*1.0, c: ct });
    for (const side of ['Left', 'Right']) {
      if (mode !== 'noArms') { const ca = closest(L[side+'Arm'], p); cand.push({ k: side+'Arm', d: ca.d - radiusAt(L[side+'Arm'], ca.s), c: ca }); }
      if (mode !== 'noLegs') { const cl = closest(L[side+'Leg'], p); cand.push({ k: side+'Leg', d: cl.d - radiusAt(L[side+'Leg'], cl.s), c: cl }); }
    }
    let dmin = Infinity; for (const c of cand) dmin = Math.min(dmin, c.d);
    let tot = 0; for (const c of cand) { c.m = Math.exp(-(c.d-dmin)/TAU); tot += c.m; }
    for (const c of cand) {
      const m = c.m/tot; if (m < 0.01) continue;
      const part = new Map();
      if (c.k === 'torso') torsoW(p, part);
      else if (c.k.endsWith('Arm')) armW(p, c.k.replace('Arm', ''), part, c.c);
      else legW(p, c.k.replace('Leg', ''), part, c.c);
      let s = 0; for (const w of part.values()) s += w;
      for (const [i, w] of part) out.set(i, (out.get(i)||0) + m*w/(s||1));
    }
    return pack(out);
  }
  function pack(out) {
    const arr = [...out.entries()].sort((a, b) => b[1]-a[1]).slice(0, 4);
    let s = 0; for (const e of arr) s += e[1];
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    arr.forEach((e, i) => { j[i] = e[0]; w[i] = e[1]/s; });
    return { j, w };
  }
  return { weigh, idx };
}
