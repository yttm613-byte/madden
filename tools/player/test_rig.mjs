import { buildRig } from './rig.mjs';
import THREE from './three.mjs';
const { J, byName } = buildRig();
console.log('joints', J.length);
const f = v => [v.x, v.y, v.z].map(a => a.toFixed(3)).join(',');
for (const n of ['Hips','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','LeftShoulder','LeftArm','LeftForeArm','LeftHand','LeftHandIndex1','RightArm','RightHand']) {
  const j = byName[n]; const m = new THREE.Matrix4().makeRotationFromQuaternion(j.restQ);
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3(); m.extractBasis(x, y, z);
  console.log(n.padEnd(16), 'rest', f(j.pos), 'bind', f(j.bindPos), ' X', f(x), ' Y', f(y), ' Z', f(z));
}
