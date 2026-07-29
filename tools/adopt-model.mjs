/* adopt-model.mjs — grade a candidate player GLB against PLAYER_MODEL_PROMPT.md
 * and print the material mapping needed to wire it into the game.
 *
 *   node tools/adopt-model.mjs path/to/whatever.glb
 *
 * Written so a model from anywhere (Neural4D, a marketplace, a modeller) can be
 * judged in one command instead of being discovered the slow way. Every check here
 * exists because the current free asset failed it and cost hours to diagnose.
 */
import { NodeIO } from '@gltf-transform/core';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/adopt-model.mjs <model.glb>'); process.exit(1); }

const io = new NodeIO();
const doc = await io.read(file);
const root = doc.getRoot();
const pass = [], warn = [], fail = [];

// ---- geometry -------------------------------------------------------------------
let tris = 0, verts = 0, dupTotal = 0, degenTotal = 0;
const byMaterial = new Map();
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const nm = (prim.getMaterial() && prim.getMaterial().getName()) || '(unnamed)';
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    const n = pos ? pos.getCount() : 0;
    const t = idx ? idx.getCount()/3 : n/3;
    tris += t; verts += n;
    byMaterial.set(nm, (byMaterial.get(nm)||0) + t);

    if (pos) {
      const seen = new Set(), v = [0,0,0]; let dup = 0;
      for (let i=0;i<n;i++){ pos.getElement(i,v);
        const k = v.map(x=>x.toFixed(4)).join(','); if (seen.has(k)) dup++; else seen.add(k); }
      dupTotal += dup;
    }
    if (idx) { let d=0;
      for (let i=0;i<idx.getCount();i+=3){ const a=idx.getScalar(i),b=idx.getScalar(i+1),c=idx.getScalar(i+2);
        if (a===b||b===c||a===c) d++; }
      degenTotal += d; }
  }
}
const dupPct = verts ? 100*dupTotal/verts : 0;

// ---- rig ------------------------------------------------------------------------
const bones = new Set();
for (const skin of root.listSkins()) for (const j of skin.listJoints()) bones.add(j.getName()||'');
const boneList = [...bones];
const fingers = ['Thumb','Index','Middle','Ring','Pinky'];
const haveFingers = fingers.filter(f => boneList.some(b => new RegExp(f,'i').test(b)));

// ---- textures -------------------------------------------------------------------
const texes = root.listTextures().map(t => {
  const im = t.getImage(); return { name:t.getName()||'(unnamed)', kb:Math.round((im?im.byteLength:0)/1024), mime:t.getMimeType() };
});
let hasAO = false;
for (const m of root.listMaterials()) if (m.getOcclusionTexture()) hasAO = true;

// ---- grade ----------------------------------------------------------------------
(tris>=25000 && tris<=90000 ? pass : warn).push(`triangles: ${Math.round(tris).toLocaleString()} (want 40k-60k)`);
(dupPct < 4 ? pass : fail).push(`duplicate-position vertices: ${dupTotal} of ${verts} (${dupPct.toFixed(1)}%) — the current asset is 18%, which is what tore the head`);
(degenTotal === 0 ? pass : fail).push(`degenerate triangles: ${degenTotal}`);
(root.listSkins().length ? pass : fail).push(`rigged: ${root.listSkins().length ? 'yes, '+boneList.length+' bones' : 'NO — unusable, the game poses bones directly'}`);
(haveFingers.length >= 5 ? pass : warn).push(`finger bones: ${haveFingers.join(', ')||'none'} (want all five; the current asset has Thumb+Index only)`);
(hasAO ? pass : warn).push(`baked ambient occlusion: ${hasAO ? 'yes' : 'NO — this is what makes a model read flat'}`);

const badNames = [...byMaterial.keys()].filter(n => /^(Mat\.?\d|default|Material\.\d|\(unnamed\))/i.test(n));
const caseClash = [...byMaterial.keys()].filter((n,i,a) => a.some((m,j)=> j!==i && m.toLowerCase()===n.toLowerCase()));
(badNames.length === 0 ? pass : warn).push(`auto-generated material names: ${badNames.join(', ')||'none'}`);
(caseClash.length === 0 ? pass : fail).push(`names differing only by case: ${caseClash.join(', ')||'none'}`);

console.log(`\n=== ${file} ===`);
console.log(`${(Buffer.byteLength(await io.writeBinary(doc))/1e6).toFixed(2)}MB, ${Math.round(tris).toLocaleString()} tris, ${verts.toLocaleString()} verts\n`);
for (const p of pass) console.log('  PASS  ' + p);
for (const w of warn) console.log('  WARN  ' + w);
for (const f of fail) console.log('  FAIL  ' + f);

console.log('\n-- materials, by triangle share --');
for (const [n,t] of [...byMaterial].sort((a,b)=>b[1]-a[1]))
  console.log(`   ${n.padEnd(22)} ${String(Math.round(t)).padStart(7)}  ${(100*t/tris).toFixed(1).padStart(5)}%`);

console.log('\n-- textures --');
for (const t of texes) console.log(`   ${t.name.padEnd(22)} ${String(t.kb).padStart(6)}KB  ${t.mime}`);

console.log(`\n-- wiring --
Map these names into index.html makePlayer() and tools/optimize-model.mjs PART_RATIO.
The game needs to identify, at minimum: skin, jersey, pants, helmet shell, facemask,
and ideally visor / cleats / socks / sleeves as separate toggleable meshes.

If the names are not self-explanatory, do NOT guess them — colour-code each material
and render the player. That is the only reliable way, and it is how every part of the
current model was identified.`);
