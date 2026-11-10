/* anim.mjs — the idle clip, keyed procedurally on the rig's own bone frames.
 *
 * A player standing between plays is never still: he breathes, shifts his weight
 * from leg to leg, looks around, rolls his shoulders. Every motion here is a smooth
 * periodic function of time with a period that divides the loop, so the clip loops
 * seamlessly, and the game desyncs players by starting each at a random time.
 *
 * Angles use the same conventions as the game's applyPose (they were measured on
 * this skeleton's frames): +X on a thigh swings it forward, -X on a shin bends the
 * knee, Z on an arm is fore/aft (mirrored left/right), X on an arm is lateral.
 */
import THREE from './three.mjs';

export function idleClip(rig, { duration = 8, fps = 30 } = {}) {
  const { J, byName } = rig;
  const n = Math.round(duration*fps) + 1;
  const times = new Float32Array(n); for (let i = 0; i < n; i++) times[i] = i/fps;
  const TAU = Math.PI*2, w = k => TAU*k/duration;    // k cycles per loop
  // smooth pseudo-random "look" curve: a few harmonics that all loop
  const look = t => 0.16*Math.sin(w(1)*t + 0.4) + 0.07*Math.sin(w(2)*t + 1.9) + 0.04*Math.sin(w(3)*t + 0.2);
  const shift = t => Math.sin(w(1)*t);                  // weight side to side, once a loop
  const breath = t => Math.sin(w(2)*t);                 // two breaths a loop (every 4s)
  const roll = t => Math.max(0, Math.sin(w(1)*t - 2.2))**6;   // one shoulder roll a loop
  // euler deltas (x,y,z) per bone as functions of time
  const D = {
    Hips:      t => [0.02, 0.05*shift(t), 0.030*shift(t)],
    Spine:     t => [0.02 + 0.010*breath(t), -0.02*shift(t), -0.020*shift(t)],
    Spine1:    t => [0.01 + 0.012*breath(t), 0, -0.012*shift(t)],
    Spine2:    t => [-0.01 - 0.016*breath(t), 0.25*look(t)*0.25, -0.010*shift(t)],
    Neck:      t => [0.03, 0.35*look(t), 0.01*shift(t)],
    Head:      t => [0.02 + 0.02*Math.sin(w(3)*t), 0.55*look(t), 0.02*shift(t)],
    LeftShoulder:  t => [0, 0, -0.02*breath(t) - 0.10*roll(t)],
    RightShoulder: t => [0, 0, 0.02*breath(t) + 0.10*roll(t)],
    // arms hang with a relaxed elbow, drifting a little with the weight shift
    LeftArm:   t => [-0.06 - 0.02*shift(t), 0.10, 0.05 + 0.03*shift(t)],
    RightArm:  t => [-0.06 + 0.02*shift(t), -0.10, -(0.05 - 0.03*shift(t))],
    LeftForeArm:  t => [0, 0, 0.30 + 0.04*breath(t)],
    RightForeArm: t => [0, 0, -(0.30 + 0.04*breath(t))],
    // the loaded leg straightens, the other softens at the knee
    LeftUpLeg:  t => [0.05 + 0.04*Math.max(0, -shift(t)), 0, -0.02*shift(t)],
    RightUpLeg: t => [0.05 + 0.04*Math.max(0, shift(t)), 0, -0.02*shift(t)],
    LeftLeg:    t => [-(0.06 + 0.10*Math.max(0, -shift(t))), 0, 0],
    RightLeg:   t => [-(0.06 + 0.10*Math.max(0, shift(t))), 0, 0],
    LeftFoot:   t => [0.0 + 0.05*Math.max(0, -shift(t)), 0, 0],
    RightFoot:  t => [0.0 + 0.05*Math.max(0, shift(t)), 0, 0],
  };
  const e = new THREE.Euler(), q = new THREE.Quaternion(), out = [];
  for (const [name, f] of Object.entries(D)) {
    const j = byName[name]; if (!j) continue;
    const arr = new Float32Array(n*4);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = f(times[i]);
      q.copy(j.localQ).multiply(new THREE.Quaternion().setFromEuler(e.set(x, y, z)));
      arr.set([q.x, q.y, q.z, q.w], i*4);
    }
    out.push({ joint: name, path: 'rotation', values: arr });
  }
  // the pelvis moves over the loaded foot, and dips a touch with the soft knee
  { const j = byName.Hips, arr = new Float32Array(n*3);
    for (let i = 0; i < n; i++) { const t = times[i];
      arr.set([j.localT.x + 0.018*shift(t), j.localT.y - 0.006 - 0.004*Math.abs(shift(t)), j.localT.z], i*3); }
    out.push({ joint: 'Hips', path: 'translation', values: arr }); }
  return { name: 'Idle', times, tracks: out };
}
