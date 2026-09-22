/* adopt-model.mjs — grade a candidate player GLB against PLAYER_MODEL_PROMPT.md
 * and print the material mapping needed to wire it into the game.
 *
 *   node tools/adopt-model.mjs path/to/whatever.glb [more.glb ...]
 *
 * Written so a model from anywhere (a generator, a marketplace, a modeller, or
 * tools/player/build.mjs) can be judged in one command instead of being discovered the
 * slow way. Every check here exists because the original free asset failed it.
 *
 * No dependencies: it reads the GLB container itself. The first version needed
 * @gltf-transform, which is not installable everywhere the game is worked on.
 */
import fs from 'fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/adopt-model.mjs <model.glb> [...]'); process.exit(1); }

function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error(file + ': not a GLB');
  const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.slice(20, 20+jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8, bin = buf.slice(binStart);
  const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const SZ = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const acc = (i) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], T = CT[a.componentType], n = SZ[a.type];
    const off = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || 0, es = T.BYTES_PER_ELEMENT*n;
    const out = new Float64Array(a.count*n);
    for (let k = 0; k < a.count; k++) {
      const base = off + k*(stride || es);
      const arr = new T(bin.buffer.slice(bin.byteOffset + base, bin.byteOffset + base + es));
      for (let c = 0; c < n; c++) out[k*n+c] = arr[c];
    }
    return { data: out, n, count: a.count, normalized: !!a.normalized, T };
  };
  return { json, acc, bytes: buf.length };
}

for (const file of files) {
  const { json, acc, bytes } = readGLB(file);
  const pass = [], warn = [], fail = [];
  let tris = 0, verts = 0, dupTotal = 0, trueDup = 0, degenTotal = 0, boundary = 0, nonManifold = 0;
  const byMaterial = new Map(); let hasColorAO = false;
  const matName = i => (i !== undefined && json.materials && json.materials[i] && json.materials[i].name) || '(unnamed)';
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    const nm = matName(prim.material);
    const pos = acc(prim.attributes.POSITION), n = pos.count;
    const uv = prim.attributes.TEXCOORD_0 !== undefined ? acc(prim.attributes.TEXCOORD_0) : null;
    if (prim.attributes.COLOR_0 !== undefined) hasColorAO = true;
    const idx = prim.indices !== undefined ? acc(prim.indices).data : Float64Array.from({ length: n }, (_, i) => i);
    const t = idx.length/3; tris += t; verts += n;
    byMaterial.set(nm, (byMaterial.get(nm)||0) + t);
    // duplicate positions: a seam (different UVs) is legitimate, same position AND same UV is not
    const seen = new Map();
    for (let i = 0; i < n; i++) {
      const k = [0, 1, 2].map(c => pos.data[i*3+c].toFixed(5)).join(',');
      const u = uv ? uv.data[i*2].toFixed(4)+','+uv.data[i*2+1].toFixed(4) : '';
      if (seen.has(k)) { dupTotal++; if (seen.get(k).has(u)) trueDup++; else seen.get(k).add(u); } else seen.set(k, new Set([u]));
    }
    // topology on welded positions (so UV seams do not count as open edges)
    const weld = new Map(), id = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = [0, 1, 2].map(c => pos.data[i*3+c].toFixed(5)).join(','); if (!weld.has(k)) weld.set(k, weld.size); id[i] = weld.get(k); }
    const edges = new Map();
    for (let f = 0; f < t; f++) {
      const a = id[idx[3*f]], b = id[idx[3*f+1]], c = id[idx[3*f+2]];
      if (a === b || b === c || a === c) { degenTotal++; continue; }
      for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? p+','+q : q+','+p; edges.set(k, (edges.get(k)||0)+1); }
    }
    for (const c of edges.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
  }
  const dupPct = verts ? 100*dupTotal/verts : 0, truePct = verts ? 100*trueDup/verts : 0;
  // rig
  const bones = new Set();
  for (const s of (json.skins || [])) for (const j of s.joints) bones.add(json.nodes[j].name || '');
  const boneList = [...bones];
  const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
  const haveFingers = fingers.filter(f => boneList.some(b => new RegExp(f, 'i').test(b)));
  let hasAOTex = false;
  for (const m of (json.materials || [])) if (m.occlusionTexture) hasAOTex = true;
  const textures = (json.images || []).map((im, i) => ({ name: im.name || '(image '+i+')', kb: Math.round((json.bufferViews[im.bufferView]||{}).byteLength/1024), mime: im.mimeType }));

  (tris >= 25000 && tris <= 90000 ? pass : warn).push(`triangles: ${Math.round(tris).toLocaleString()} (want 40k-60k)`);
  (truePct < 4 ? pass : fail).push(`duplicate-position vertices: ${trueDup} true duplicates (${truePct.toFixed(1)}%), ${dupTotal - trueDup} more at UV/material seams — the original asset was 18%, which is what tore the head`);
  (degenTotal === 0 ? pass : fail).push(`degenerate triangles: ${degenTotal}`);
  (nonManifold === 0 ? pass : warn).push(`non-manifold edges: ${nonManifold} (open edges where layers meet: ${boundary})`);
  ((json.skins||[]).length ? pass : fail).push(`rigged: ${(json.skins||[]).length ? 'yes, '+boneList.length+' bones' : 'NO — unusable, the game poses bones directly'}`);
  (haveFingers.length >= 5 ? pass : warn).push(`finger bones: ${haveFingers.join(', ')||'none'} (want all five; the original asset had Thumb+Index only)`);
  (hasAOTex || hasColorAO ? pass : warn).push(`baked ambient occlusion: ${hasAOTex ? 'occlusion texture' : hasColorAO ? 'yes, in COLOR_0 (the game enables vertex colours)' : 'NO — this is what makes a model read flat'}`);
  const badNames = [...byMaterial.keys()].filter(n => /^(Mat\.?\d|default|Material\.\d|\(unnamed\))/i.test(n));
  const caseClash = [...byMaterial.keys()].filter((n, i, a) => a.some((m, j) => j !== i && m.toLowerCase() === n.toLowerCase()));
  (badNames.length === 0 ? pass : warn).push(`auto-generated material names: ${badNames.join(', ')||'none'}`);
  (caseClash.length === 0 ? pass : fail).push(`names differing only by case: ${caseClash.join(', ')||'none'}`);
  const extras = json.asset && json.asset.extras; if (extras && extras.license) warn.push(`licence: ${extras.license}${extras.author ? ' — author ' + extras.author : ''} (credit it where the game is published)`);

  console.log(`\n=== ${file} ===`);
  console.log(`${(bytes/1e6).toFixed(2)}MB, ${Math.round(tris).toLocaleString()} tris, ${verts.toLocaleString()} verts, ${(json.meshes||[]).reduce((n, m) => n + m.primitives.length, 0)} draw calls per player, ${(json.animations||[]).length} animation(s)\n`);
  for (const p of pass) console.log('  PASS  ' + p);
  for (const w of warn) console.log('  WARN  ' + w);
  for (const f of fail) console.log('  FAIL  ' + f);
  console.log('\n-- materials, by triangle share --');
  for (const [n, t] of [...byMaterial].sort((a, b) => b[1]-a[1])) console.log(`   ${n.padEnd(22)} ${String(Math.round(t)).padStart(7)}  ${(100*t/tris).toFixed(1).padStart(5)}%`);
  console.log('\n-- textures --');
  for (const t of textures) console.log(`   ${t.name.padEnd(22)} ${String(t.kb).padStart(6)}KB  ${t.mime}`);
}
console.log(`\n-- wiring --
Map these names into index.html makePlayer(). The game needs to identify, at minimum:
skin, jersey, pants, helmet shell, facemask, and ideally visor / cleats / socks / gloves
as separate materials. If the names are not self-explanatory, do NOT guess them —
colour-code each material and render the player.`);
