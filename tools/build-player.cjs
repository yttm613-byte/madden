/*
 * build-player.cjs — generates assets/player.glb
 * A rigged skinned humanoid (American-football player) with a real skeleton
 * and authored animation clips: idle / run / tackle / celebrate.
 * Rigid per-segment skinning (each body part bound 100% to one bone) keeps the
 * exporter simple while giving true skeletal deformation at the joints.
 *
 * Runs fully offline: uses the locally-vendored three (UMD) + examples utils.
 */
const fs = require('fs');
const path = require('path');

// --- minimal DOM shims so GLTFExporter's GLB assembly works under Node ---
global.Blob = global.Blob || require('buffer').Blob;
global.window = global.window || {};
global.window.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(ab => { this.result = ab; this.onloadend && this.onloadend(); }); }
};

global.THREE = require('three');
require(path.join(__dirname, '..', 'vendor', 'BufferGeometryUtils.js'));
require(path.join(__dirname, '..', 'vendor', 'exporters', 'GLTFExporter.js'));
const THREE = global.THREE;
const BGU = THREE.BufferGeometryUtils;
const merge = (geos, useGroups) => BGU.mergeBufferGeometries(geos, useGroups);

// ---------------------------------------------------------------- skeleton ---
// [name, parentName, worldX, worldY, worldZ] — bind pose, facing +Z.
const BONES = [
  ['hips',      null,       0.00, 0.92, 0],
  ['spine',     'hips',     0.00, 1.06, 0],
  ['chest',     'spine',    0.00, 1.24, 0],
  ['neck',      'chest',    0.00, 1.42, 0],
  ['head',      'neck',     0.00, 1.54, 0],
  ['upperArmL', 'chest',   -0.22, 1.40, 0],
  ['forearmL',  'upperArmL',-0.22, 1.10, 0],
  ['handL',     'forearmL', -0.22, 0.84, 0],
  ['upperArmR', 'chest',    0.22, 1.40, 0],
  ['forearmR',  'upperArmR', 0.22, 1.10, 0],
  ['handR',     'forearmR',  0.22, 0.84, 0],
  ['upperLegL', 'hips',    -0.10, 0.90, 0],
  ['lowerLegL', 'upperLegL',-0.10, 0.47, 0],
  ['footL',     'lowerLegL',-0.10, 0.07, 0],
  ['upperLegR', 'hips',     0.10, 0.90, 0],
  ['lowerLegR', 'upperLegR', 0.10, 0.47, 0],
  ['footR',     'lowerLegR', 0.10, 0.07, 0],
];
const boneIndex = {};
BONES.forEach((b, i) => boneIndex[b[0]] = i);

const bones = BONES.map(([name, , x, y, z]) => {
  const b = new THREE.Bone(); b.name = name; return b;
});
BONES.forEach(([name, parent, x, y, z], i) => {
  const b = bones[i];
  if (parent) {
    const p = BONES[boneIndex[parent]];
    b.position.set(x - p[2], y - p[3], z - p[4]);   // local offset from parent
    bones[boneIndex[parent]].add(b);
  } else {
    b.position.set(x, y, z);
  }
});
const root = bones[0];

// --------------------------------------------------------------- geometry ----
// material slots: jersey, helmet, skin, pants, dark, trim, accent (team 2nd color)
const slots = { jersey: [], helmet: [], skin: [], pants: [], dark: [], trim: [], accent: [] };

function skinTo(geo, bIdx) {
  const n = geo.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i*4] = bIdx; sw[i*4] = 1; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  if (!geo.attributes.uv) {  // ensure uv exists so merges stay compatible
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n*2), 2));
  }
  geo.deleteAttribute('color');
  return geo;
}
function part(slot, boneName, geo, pos, rot) {
  geo.translate(pos[0], pos[1], pos[2]);
  if (rot) geo.rotateX(rot);
  skinTo(geo, boneIndex[boneName]);
  slots[slot].push(geo);
}
// rounder, smoother primitives so the silhouette reads as 3D rather than faceted
const cyl = (rt, rb, h, rs=18) => new THREE.CylinderGeometry(rt, rb, h, rs);
const box = (w,h,d) => new THREE.BoxGeometry(w,h,d, 2,2,2);
const sph = (r) => new THREE.SphereGeometry(r, 22, 16);

// torso / pelvis — athletic V-taper
part('pants',  'hips',  cyl(0.205,0.17,0.20,16), [0,0.93,0]);
part('jersey', 'spine', cyl(0.185,0.22,0.22), [0,1.06,0]);              // narrow waist
part('jersey', 'chest', cyl(0.275,0.20,0.26), [0,1.25,0]);             // broad chest
part('jersey', 'chest', box(0.62,0.20,0.40), [0,1.40,0]);              // shoulder pads
part('jersey', 'chest', sph(0.145), [-0.30,1.40,0]);                   // rounded pad caps
part('jersey', 'chest', sph(0.145), [ 0.30,1.40,0]);
part('jersey', 'chest', sph(0.135), [0,1.45,0.0]);                     // neck roll / collar
// neck + head
part('skin',   'neck',  cyl(0.092,0.085,0.12), [0,1.47,0]);
part('helmet', 'head',  sph(0.185), [0,1.57,0.01]);
part('trim',   'head',  box(0.06,0.22,0.34), [0,1.66,0.0]);            // helmet stripe
// facemask cage (bars)
part('dark','head', box(0.24,0.022,0.05),[0,1.585,0.175]);
part('dark','head', box(0.24,0.022,0.05),[0,1.540,0.190]);
part('dark','head', box(0.22,0.022,0.05),[0,1.495,0.175]);
part('dark','head', box(0.030,0.11,0.05),[0,1.540,0.190]);             // vertical bar
// arms — bicep + tapered forearm + glove
part('jersey', 'upperArmL', cyl(0.090,0.070,0.30), [-0.22,1.25,0]);
part('skin',   'forearmL',  cyl(0.066,0.050,0.26), [-0.22,0.97,0]);
part('dark',   'handL',     sph(0.082), [-0.22,0.81,0]);
part('jersey', 'upperArmR', cyl(0.090,0.070,0.30), [ 0.22,1.25,0]);
part('skin',   'forearmR',  cyl(0.066,0.050,0.26), [ 0.22,0.97,0]);
part('dark',   'handR',     sph(0.082), [ 0.22,0.81,0]);
// legs — fuller thigh, calf, rounded cleat
part('pants',  'upperLegL', cyl(0.120,0.085,0.44), [-0.10,0.68,0]);
part('pants',  'lowerLegL', cyl(0.090,0.058,0.40), [-0.10,0.27,0]);
part('dark',   'footL',     box(0.115,0.08,0.30),  [-0.10,0.045,0.07]);
part('pants',  'upperLegR', cyl(0.120,0.085,0.44), [ 0.10,0.68,0]);
part('pants',  'lowerLegR', cyl(0.090,0.058,0.40), [ 0.10,0.27,0]);
part('dark',   'footR',     box(0.115,0.08,0.30),  [ 0.10,0.045,0.07]);
// team-color accents (recolored in-game): sleeve bands, pant stripes, chest stripe
part('accent', 'upperArmL', cyl(0.094,0.094,0.06), [-0.22,1.12,0]);
part('accent', 'upperArmR', cyl(0.094,0.094,0.06), [ 0.22,1.12,0]);
part('accent', 'upperLegL', box(0.03,0.42,0.075),  [-0.205,0.68,0]);
part('accent', 'upperLegR', box(0.03,0.42,0.075),  [ 0.205,0.68,0]);
part('accent', 'chest',     box(0.50,0.055,0.42),  [0,1.32,0]);

const slotOrder = ['jersey','helmet','skin','pants','dark','trim','accent'];
const slotGeos = slotOrder.map(s => merge(slots[s], false));
const geometry = merge(slotGeos, true);   // grouped -> one group/material per slot

const materials = [
  new THREE.MeshStandardMaterial({ name:'jersey', color:0xffffff, roughness:0.55, metalness:0.05 }),
  new THREE.MeshStandardMaterial({ name:'helmet', color:0xffffff, roughness:0.16, metalness:0.5 }),
  new THREE.MeshStandardMaterial({ name:'skin',   color:0x9c6b43, roughness:0.8 }),
  new THREE.MeshStandardMaterial({ name:'pants',  color:0xe7eaf0, roughness:0.8 }),
  new THREE.MeshStandardMaterial({ name:'dark',   color:0x14161c, roughness:0.4, metalness:0.3 }),
  new THREE.MeshStandardMaterial({ name:'trim',   color:0xffffff, roughness:0.35 }),
  new THREE.MeshStandardMaterial({ name:'accent', color:0x224488, roughness:0.5 }),
];

// ------------------------------------------------------------------ bind -----
const mesh = new THREE.SkinnedMesh(geometry, materials);
mesh.name = 'Player';
mesh.add(root);
mesh.updateMatrixWorld(true);
const skeleton = new THREE.Skeleton(bones);   // inverses computed from bind pose
mesh.bind(skeleton);

// --------------------------------------------------------------- clips -------
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
function quatTrack(boneName, times, eulers) {  // eulers: array of [x,y,z]
  const vals = [];
  for (const e of eulers) { _q.setFromEuler(_e.set(e[0]||0, e[1]||0, e[2]||0)); vals.push(_q.x,_q.y,_q.z,_q.w); }
  return new THREE.QuaternionKeyframeTrack(boneName + '.quaternion', times, vals);
}
function posTrack(boneName, times, ys) {
  const base = bones[boneIndex[boneName]].position;
  const vals = [];
  for (const y of ys) vals.push(base.x, y, base.z);
  return new THREE.VectorKeyframeTrack(boneName + '.position', times, vals);
}

// RUN — sampled sinusoidal gait
function runClip() {
  const D = 0.7, N = 12, t = [];
  const data = {};
  const add = (b, e) => (data[b] = data[b] || []).push(e);
  for (let i = 0; i < N; i++) {
    const tt = i / (N - 1) * D; t.push(tt);
    const ph = (i / (N - 1)) * Math.PI * 2;
    const legA = 0.85, armA = 0.6;
    const lL = Math.sin(ph), lR = Math.sin(ph + Math.PI);
    add('upperLegL', [ legA*lL, 0, 0]);
    add('upperLegR', [ legA*lR, 0, 0]);
    add('lowerLegL', [ Math.max(0,-lL)*1.6, 0, 0]);   // knee folds back
    add('lowerLegR', [ Math.max(0,-lR)*1.6, 0, 0]);
    add('footL',     [ -0.2 + Math.max(0,lL)*0.4, 0, 0]);
    add('footR',     [ -0.2 + Math.max(0,lR)*0.4, 0, 0]);
    add('upperArmL', [ -armA*lL, 0, 0.12]);            // arms opposite, slight out
    add('upperArmR', [ -armA*lR, 0, -0.12]);
    add('forearmL',  [ -0.7 - Math.max(0,-lL)*0.4, 0, 0]);
    add('forearmR',  [ -0.7 - Math.max(0,-lR)*0.4, 0, 0]);
    add('chest',     [ 0.20, 0.06*Math.sin(ph), 0]);   // forward lean + counter-rotate
    add('hips',      [ 0.0, -0.06*Math.sin(ph), 0]);
    add('head',      [ -0.12, 0, 0]);
  }
  const tracks = Object.keys(data).map(b => quatTrack(b, t, data[b]));
  tracks.push(posTrack('hips', t, t.map((_,i)=>0.92 + 0.035*Math.abs(Math.sin(i/(N-1)*Math.PI*2)) )));
  return new THREE.AnimationClip('run', D, tracks);
}

// IDLE — subtle breathing / weight shift
function idleClip() {
  const D = 2.6, t = [0, D/2, D];
  const tracks = [
    quatTrack('chest',     t, [[0.05,0,0],[0.09,0,0],[0.05,0,0]]),
    quatTrack('upperArmL', t, [[0.05,0,0.06],[0.0,0,0.06],[0.05,0,0.06]]),
    quatTrack('upperArmR', t, [[0.05,0,-0.06],[0.0,0,-0.06],[0.05,0,-0.06]]),
    quatTrack('head',      t, [[0,-0.05,0],[0,0.05,0],[0,-0.05,0]]),
    posTrack('hips',       t, [0.92, 0.935, 0.92]),
  ];
  return new THREE.AnimationClip('idle', D, tracks);
}

// TACKLE — explosive lunge forward, arms wrap
function tackleClip() {
  const D = 0.5, t = [0, 0.22, 0.5];
  const tracks = [
    quatTrack('chest',     t, [[0.1,0,0],[0.55,0,0],[0.5,0,0]]),
    quatTrack('hips',      t, [[0,0,0],[0.25,0,0],[0.2,0,0]]),
    quatTrack('upperArmL', t, [[0,0,0.1],[-1.5,0,0.3],[-1.3,0,0.3]]),
    quatTrack('upperArmR', t, [[0,0,-0.1],[-1.5,0,-0.3],[-1.3,0,-0.3]]),
    quatTrack('forearmL',  t, [[-0.7,0,0],[-0.4,0,0],[-0.5,0,0]]),
    quatTrack('forearmR',  t, [[-0.7,0,0],[-0.4,0,0],[-0.5,0,0]]),
    quatTrack('upperLegL', t, [[0,0,0],[-0.5,0,0],[-0.3,0,0]]),
    quatTrack('upperLegR', t, [[0,0,0],[0.6,0,0],[0.4,0,0]]),
    quatTrack('lowerLegR', t, [[0,0,0],[0.7,0,0],[0.5,0,0]]),
    posTrack('hips',       t, [0.92, 0.80, 0.84]),
  ];
  return new THREE.AnimationClip('tackle', D, tracks);
}

// CELEBRATE — arms up, little hop
function celebrateClip() {
  const D = 1.4, t = [0, 0.35, 0.7, 1.05, 1.4];
  const tracks = [
    quatTrack('upperArmL', t, [[0,0,2.5],[0.3,0,2.6],[0,0,2.5],[0.3,0,2.6],[0,0,2.5]]),
    quatTrack('upperArmR', t, [[0,0,-2.5],[0.3,0,-2.6],[0,0,-2.5],[0.3,0,-2.6],[0,0,-2.5]]),
    quatTrack('forearmL',  t, [[-0.3,0,0],[-0.1,0,0],[-0.3,0,0],[-0.1,0,0],[-0.3,0,0]]),
    quatTrack('forearmR',  t, [[-0.3,0,0],[-0.1,0,0],[-0.3,0,0],[-0.1,0,0],[-0.3,0,0]]),
    quatTrack('chest',     t, [[-0.1,0,0],[-0.18,0,0],[-0.1,0,0],[-0.18,0,0],[-0.1,0,0]]),
    quatTrack('head',      t, [[-0.2,0,0],[-0.3,0,0],[-0.2,0,0],[-0.3,0,0],[-0.2,0,0]]),
    posTrack('hips',       t, [0.92, 1.0, 0.92, 1.0, 0.92]),
  ];
  return new THREE.AnimationClip('celebrate', D, tracks);
}

// THROW — QB overhand: wind up, rotate, release & follow through
function throwClip() {
  const D = 0.5, t = [0, 0.18, 0.34, 0.5];
  const tracks = [
    quatTrack('chest',     t, [[0.1,0.35,0],[0.05,0.55,0],[0.1,-0.25,0],[0.12,-0.1,0]]),
    quatTrack('upperArmR', t, [[-0.2,0,-0.2],[-2.5,0,-0.7],[-1.4,0,-0.3],[-0.9,0,-0.15]]),
    quatTrack('forearmR',  t, [[-0.8,0,0],[-1.7,0,0],[-0.3,0,0],[-0.5,0,0]]),
    quatTrack('upperArmL', t, [[-0.1,0,0.15],[-1.0,0,0.4],[-0.5,0,0.25],[-0.2,0,0.15]]),
    quatTrack('forearmL',  t, [[-0.7,0,0],[-1.0,0,0],[-0.6,0,0],[-0.5,0,0]]),
    quatTrack('head',      t, [[-0.1,0.2,0],[-0.1,0.3,0],[-0.1,-0.1,0],[-0.1,0,0]]),
    quatTrack('upperLegL', t, [[0,0,0],[0.15,0,0],[-0.2,0,0],[-0.1,0,0]]),
    quatTrack('upperLegR', t, [[0,0,0],[-0.15,0,0],[0.2,0,0],[0.1,0,0]]),
  ];
  return new THREE.AnimationClip('throw', D, tracks);
}

// KICK — place-kicker: plant left, swing right leg through the ball
function kickClip() {
  const D = 0.5, t = [0, 0.16, 0.32, 0.5];
  const tracks = [
    quatTrack('upperLegR', t, [[0,0,0],[0.55,0,0],[-1.5,0,0],[-0.9,0,0]]),
    quatTrack('lowerLegR', t, [[0,0,0],[0.9,0,0],[0.1,0,0],[0.0,0,0]]),
    quatTrack('upperLegL', t, [[0,0,0],[-0.1,0,0],[-0.15,0,0],[-0.1,0,0]]),
    quatTrack('chest',     t, [[0.05,0,0],[0.18,0,0.1],[-0.12,0,-0.1],[-0.05,0,0]]),
    quatTrack('upperArmL', t, [[0,0,0.5],[0,0,0.9],[0,0,1.1],[0,0,0.8]]),
    quatTrack('upperArmR', t, [[0,0,-0.4],[0,0,-0.7],[0,0,-0.9],[0,0,-0.6]]),
    quatTrack('forearmL',  t, [[-0.4,0,0],[-0.5,0,0],[-0.5,0,0],[-0.4,0,0]]),
    quatTrack('forearmR',  t, [[-0.4,0,0],[-0.5,0,0],[-0.5,0,0],[-0.4,0,0]]),
    posTrack('hips',       t, [0.92, 0.95, 0.94, 0.92]),
  ];
  return new THREE.AnimationClip('kick', D, tracks);
}

// SET — pre-snap athletic ready stance (knees bent, hands ready, leaning in)
function setClip() {
  const D = 1.6, t = [0, 0.8, 1.6];
  const tracks = [
    quatTrack('chest',     t, [[0.42,0,0],[0.46,0,0],[0.42,0,0]]),
    quatTrack('hips',      t, [[0.18,0,0],[0.2,0,0],[0.18,0,0]]),
    quatTrack('upperLegL', t, [[0.30,0,0.04],[0.33,0,0.04],[0.30,0,0.04]]),
    quatTrack('upperLegR', t, [[0.30,0,-0.04],[0.33,0,-0.04],[0.30,0,-0.04]]),
    quatTrack('lowerLegL', t, [[0.5,0,0],[0.54,0,0],[0.5,0,0]]),
    quatTrack('lowerLegR', t, [[0.5,0,0],[0.54,0,0],[0.5,0,0]]),
    quatTrack('upperArmL', t, [[-0.55,0,0.12],[-0.6,0,0.12],[-0.55,0,0.12]]),
    quatTrack('upperArmR', t, [[-0.55,0,-0.12],[-0.6,0,-0.12],[-0.55,0,-0.12]]),
    quatTrack('forearmL',  t, [[-1.1,0,0],[-1.05,0,0],[-1.1,0,0]]),
    quatTrack('forearmR',  t, [[-1.1,0,0],[-1.05,0,0],[-1.1,0,0]]),
    quatTrack('head',      t, [[-0.32,0,0],[-0.3,0,0],[-0.32,0,0]]),
    posTrack('hips',       t, [0.80, 0.785, 0.80]),
  ];
  return new THREE.AnimationClip('set', D, tracks);
}

const clips = [idleClip(), runClip(), tackleClip(), celebrateClip(), throwClip(), kickClip(), setClip()];

// ----------------------------------------------------------------- export ----
const exporter = new THREE.GLTFExporter();
const scene = new THREE.Scene();
scene.add(mesh);
exporter.parse(scene, (result) => {
  const buf = Buffer.from(result);
  const out = path.join(__dirname, '..', 'assets', 'player.glb');
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes;',
    'bones', bones.length, 'verts', geometry.attributes.position.count,
    'clips', clips.map(c => c.name + '(' + c.duration + 's)').join(','));
}, { binary: true, animations: clips, onlyVisible: false });
