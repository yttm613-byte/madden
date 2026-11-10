/* rig.mjs — the player's skeleton.
 *
 * Mixamo bone names AND Mixamo bone frames. The game poses bones procedurally, and
 * every axis in its applyPose() was measured on the old Mixamo rig: +X on the hip
 * swings the leg forward, -X on the knee bends it, Z on the arm is fore/aft and X is
 * lateral (mirrored left/right). Reproducing those local frames exactly is what lets
 * this model drop into the game without touching a line of the animation code.
 *
 * Two poses:
 *   rest — arms hanging ~13 degrees off the body, the pose the game treats as
 *          neutral. Written as the nodes' TRS.
 *   bind — the same skeleton with both arms raised into an A-pose. The mesh is
 *          sculpted here, where the arms are clear of the torso, and the inverse bind
 *          matrices are taken from it. three.js then skins the A-pose mesh down into
 *          the rest pose on load.
 */
import THREE from './three.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- rest-pose joint positions (metres; y up, facing +z, character's left = +x) ----
// A 6'2" (1.88 m) player. Proportions from standard adult-male anthropometry,
// pushed toward an NFL build: thick neck, long arms, big hands and feet.
const P = {
  Hips: V(0, 1.000, 0.000),
  Spine: V(0, 1.095, -0.012),
  Spine1: V(0, 1.205, -0.018),
  Spine2: V(0, 1.320, -0.020),
  Neck: V(0, 1.560, -0.040),
  Head: V(0, 1.655, -0.018),
  HeadTop_End: V(0, 1.880, -0.005),
  // Shoulder height from anthropometry: acromion at ~0.82x stature (1.54m), the
  // joint centre ~4cm below it. An earlier 1.46 left 15cm of bare neck above the pads.
  LeftShoulder: V(0.030, 1.508, -0.030),
  LeftArm: V(0.200, 1.498, -0.040),
  LeftForeArm: V(0.268, 1.196, -0.058),
  LeftHand: V(0.300, 0.931, -0.030),
  LeftUpLeg: V(0.098, 0.952, 0.008),
  LeftLeg: V(0.106, 0.525, 0.018),
  LeftFoot: V(0.112, 0.090, -0.030),
  LeftToeBase: V(0.118, 0.026, 0.108),
  LeftToe_End: V(0.122, 0.022, 0.205),
};
// Hand: the palm hangs facing the thigh (-x for the left hand), thumb forward.
// Knuckle (MCP) positions relative to the wrist, then phalanx lengths.
const FINGERS = {
  //        MCP offset from wrist (x,y,z)   phalanx lengths         splay (rad, about z-fwd)
  Index:  { mcp: V(-0.008, -0.097, 0.026), len: [0.045, 0.027, 0.022], splay: 0.02 },
  Middle: { mcp: V(-0.006, -0.101, 0.007), len: [0.049, 0.030, 0.024], splay: 0.0 },
  Ring:   { mcp: V(-0.004, -0.096, -0.012), len: [0.046, 0.028, 0.023], splay: -0.02 },
  Pinky:  { mcp: V(-0.001, -0.086, -0.028), len: [0.035, 0.021, 0.020], splay: -0.05 },
};
const THUMB = { cmc: V(-0.016, -0.030, 0.026), len: [0.040, 0.033, 0.027] };
// Relaxed curl of each finger joint in the modelled pose (radians of flexion). A hand
// at rest is not flat: every joint carries some flexion, more toward the little finger.
const CURL = [0.42, 0.58, 0.36];

export const BIND_ABDUCT = 0.36;  // extra arm raise in the bind pose (rad) -> ~34 deg off the body

function mirror(v) { return V(-v.x, v.y, v.z); }

// Build the joint list in hierarchy order.
export function buildRig() {
  const J = [];                 // {name, parent, rest:{pos, quatWorld}}
  const byName = {};
  const add = (name, parent, pos) => { const j = { name, parent, pos: pos.clone(), children: [] }; J.push(j); byName[name] = j; if (parent) byName[parent].children.push(j); return j; };

  add('Hips', null, P.Hips);
  add('Spine', 'Hips', P.Spine);
  add('Spine1', 'Spine', P.Spine1);
  add('Spine2', 'Spine1', P.Spine2);
  add('Neck', 'Spine2', P.Neck);
  add('Head', 'Neck', P.Head);
  add('HeadTop_End', 'Head', P.HeadTop_End);
  for (const side of ['Left', 'Right']) {
    const m = side === 'Left' ? (v => v.clone()) : mirror;
    add(side+'Shoulder', 'Spine2', m(P.LeftShoulder));
    add(side+'Arm', side+'Shoulder', m(P.LeftArm));
    add(side+'ForeArm', side+'Arm', m(P.LeftForeArm));
    add(side+'Hand', side+'ForeArm', m(P.LeftHand));
    // fingers, built in the left hand's space and mirrored
    const wrist = P.LeftHand;
    // thumb: from the CMC joint, pointing forward-down-inward
    { let p = wrist.clone().add(THUMB.cmc);
      const dirs = [V(-0.30, -0.78, 0.55).normalize(), V(-0.24, -0.93, 0.28).normalize(), V(-0.14, -0.98, 0.10).normalize()];
      let par = side+'Hand';
      for (let k = 0; k < 4; k++) {
        const nm = side+'HandThumb'+(k+1); add(nm, par, m(p)); par = nm;
        if (k < 3) p = p.clone().addScaledVector(dirs[k], THUMB.len[k]);
      } }
    for (const [fname, F] of Object.entries(FINGERS)) {
      let p = wrist.clone().add(F.mcp);
      let dir = V(0, -1, 0).applyAxisAngle(V(0, 0, 1), F.splay*0.5);  // down, fanned slightly
      let par = side+'Hand';
      for (let k = 0; k < 4; k++) {
        const nm = side+'Hand'+fname+(k+1); add(nm, par, m(p)); par = nm;
        if (k < 3) {
          // flex toward the palm (-x for the left hand) about the forward axis
          const extra = fname === 'Pinky' ? 0.10 : fname === 'Ring' ? 0.05 : 0;
          dir = dir.clone().applyAxisAngle(V(0, 0, 1), -(CURL[k]+extra)).normalize();
          p = p.clone().addScaledVector(dir, F.len[k]);
        }
      }
    }
  }
  for (const side of ['Left', 'Right']) {
    const m = side === 'Left' ? (v => v.clone()) : mirror;
    add(side+'UpLeg', 'Hips', m(P.LeftUpLeg));
    add(side+'Leg', side+'UpLeg', m(P.LeftLeg));
    add(side+'Foot', side+'Leg', m(P.LeftFoot));
    add(side+'ToeBase', side+'Foot', m(P.LeftToeBase));
    add(side+'Toe_End', side+'ToeBase', m(P.LeftToe_End));
  }
  // reorder Hips' children to Mixamo order: Spine, LeftUpLeg, RightUpLeg (already so)

  // ---- rest frames (world) -------------------------------------------------------
  const frameFrom = (xHint, yDir) => {
    const y = yDir.clone().normalize();
    const x = xHint.clone().addScaledVector(y, -xHint.dot(y)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  };
  for (const j of J) {
    const n = j.name;
    const child = j.children.find(c => !/Thumb|Index|Middle|Ring|Pinky/.test(c.name) || /Hand$/.test(n) === false) || j.children[0];
    let q;
    if (/^(Hips|Spine|Spine1|Spine2|Neck|Head|HeadTop_End)$/.test(n)) q = new THREE.Quaternion();
    else if (/UpLeg|Leg$|Foot|ToeBase|Toe_End/.test(n)) {
      const tgt = child ? child.pos : null;
      q = tgt ? frameFrom(V(-1, 0, 0), tgt.clone().sub(j.pos)) : null;
    } else {
      // arm chain: left X points back, right X points forward (Mixamo mirrors the arms)
      const xh = n.startsWith('Left') ? V(0, 0, -1) : V(0, 0, 1);
      let tgt = null;
      if (/Hand$/.test(n)) tgt = byName[n+'Middle1'].pos;
      else if (child) tgt = child.pos;
      q = tgt ? frameFrom(xh, tgt.clone().sub(j.pos)) : null;
    }
    j.restQ = q;   // null -> inherit parent's
  }
  for (const j of J) if (!j.restQ) j.restQ = byName[j.parent].restQ.clone();

  // ---- bind pose: arms raised into an A-pose about each shoulder -------------------
  for (const j of J) { j.bindPos = j.pos.clone(); j.bindQ = j.restQ.clone(); }
  for (const side of ['Left', 'Right']) {
    const pivot = byName[side+'Arm'].pos;
    const R = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), side === 'Left' ? BIND_ABDUCT : -BIND_ABDUCT);
    const sub = []; const walk = j => { sub.push(j); j.children.forEach(walk); }; walk(byName[side+'Arm']);
    for (const j of sub) { j.bindPos = j.pos.clone().sub(pivot).applyQuaternion(R).add(pivot); j.bindQ = R.clone().multiply(j.restQ); }
  }
  // ---- local TRS (rest) and inverse bind matrices (bind) ----------------------------
  for (const j of J) {
    const p = j.parent ? byName[j.parent] : null;
    const pq = p ? p.restQ : new THREE.Quaternion(), pp = p ? p.pos : V(0, 0, 0);
    j.localT = j.pos.clone().sub(pp).applyQuaternion(pq.clone().invert());
    j.localQ = pq.clone().invert().multiply(j.restQ);
    const wb = new THREE.Matrix4().compose(j.bindPos, j.bindQ, V(1, 1, 1));
    j.ibm = wb.clone().invert();
    j.bindMat = wb;
  }
  return { J, byName };
}
