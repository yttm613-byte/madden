/*
 * optimize-model.mjs — rebuild assets/fbplayer_opt.glb from assets/fbplayer_src.glb
 *
 * The players are viewed at broadcast distance, so perceived quality lives in the
 * TEXTURES, not the triangle count. An earlier pass had this backwards (99% of the
 * file was geometry, textures were crushed to 256px). This build flips the budget:
 * simplify the mesh hard, keep the textures large.
 *
 * A UNIFORM ratio is still wrong, because it preserves whatever lopsided
 * distribution the source had. Measured on this model at a flat 25%:
 *
 *     helmet shell   79,038 tris   46% of the entire model
 *     collar/pads    30,138
 *     cleats         13,646
 *     body + arms     ~5,600       <- the only part anyone looks at
 *
 * The helmet is a smooth shell that needs ~3k; the body carries every silhouette
 * and deformation the eye actually tracks, and at 5.6k the arms went faceted.
 * So the budget is now per-part: keep skin/jersey/pants dense, crush the hard
 * shells. Same file size, the triangles just land where they show.
 *
 *   TEX_SIZE   max texture edge in px
 *   GEO_RATIO  default fraction of triangles to keep (parts not in PART_RATIO)
 */
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld, simplify, simplifyPrimitive, resample, textureCompress, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'fs';

const TEX_SIZE  = +(process.env.TEX_SIZE  || 1024);
const GEO_RATIO = +(process.env.GEO_RATIO || 0.13);
const QUALITY   = +(process.env.TEX_Q     || 84);
const OUT       = process.env.OUT || 'assets/fbplayer_opt.glb';

// Fraction of source triangles to keep, per material. Material→body-part mapping was
// measured in-engine (see index.html makePlayer) — the names are not descriptive.
const PART_RATIO = {
  'Bodymat':        1.00,   // skin: arms, legs, neck, hands — every visible deformation
  'shirt_0':        0.85,   // jersey drapes over the pads, holds the silhouette
  'pants':          0.85,
  'Default':        0.60,   // socks
  'Fabric-Linen':   0.60,   // undersleeves
  'Fabric-Silk':    0.60,
  'Mat.3':          0.05,   // helmet shell: smooth, rigid, 128k tris of nothing
  'Plastic_Matte':  0.05,   // collar / neck roll
  'Mat.2_2mat':     0.08,   // belt
  'Mat.8_1':        0.08,   // helmet hardware
  'Mat.2':          0.08,
  'material':       0.10,   // facemask — thin tubes, needs a little more
  'default':        0.10,
  'sepatu_key.obj': 0.18,   // cleats
  'frosted_glass':  0.15,   // visor
};

const io = new NodeIO();
const doc = await io.read('assets/fbplayer_src.glb');

const triCount = (d) => d.getRoot().listMeshes()
  .flatMap(m => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);

const beforeTris = triCount(doc);
const beforeBytes = (await io.writeBinary(doc)).byteLength;

await doc.transform(dedup(), prune(), weld());

// Per-part simplification. simplifyPrimitive() works on one primitive at a time,
// which is what lets the ratio vary by body part instead of applying globally.
await MeshoptSimplifier.ready;
const ERR  = +(process.env.GEO_ERR || 0.02);
const LOCK = process.env.LOCK !== '0';
const kept = {};
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name  = (prim.getMaterial() && prim.getMaterial().getName()) || '';
    const ratio = name in PART_RATIO ? PART_RATIO[name] : GEO_RATIO;
    const before = (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    if (ratio < 1) {
      // Hard shells (helmet, collar, hardware) are rigid and untextured, so the
      // usual guards are what was stopping them: a tight error bound and locked
      // borders held the helmet at 46% of the model no matter what ratio was asked
      // for. Release both for shells; keep them for skin and cloth, where a seam
      // opening up or a silhouette shifting would actually show.
      const shell = ratio <= 0.2;
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio,
        error: shell ? 0.25 : ERR, lockBorder: shell ? false : LOCK });
    }
    const after = (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    const k = kept[name] || (kept[name] = { before: 0, after: 0 });
    k.before += before; k.after += after;
  }
}

// NB: no prune() here. Running one after simplification removed the Skin, which
// would leave the model rigid.
await doc.transform(
  resample(),
  // pack vertex attributes into ints (KHR_mesh_quantization) — big byte savings,
  // negligible visual cost. Verified supported by our vendored three r128 loader.
  quantize({ quantizePosition:14, quantizeNormal:10, quantizeTexcoord:12, quantizeWeight:8, quantizeGeneric:12 }),
);

const sharp = (await import('sharp')).default;
await doc.transform(textureCompress({
  encoder: sharp, targetFormat: 'webp', quality: QUALITY, resize: [TEX_SIZE, TEX_SIZE], resizeFilter: 'lanczos3',
}));

let glb = await io.writeBinary(doc);
// gltf-transform can omit the declaration for the quantized attributes it just wrote;
// declare it so strict validators/loaders accept the file.
glb = declareQuantization(Buffer.from(glb));
fs.writeFileSync(OUT, glb);

function declareQuantization(buf){
  const total=buf.readUInt32LE(8); let off=12;
  while(off<total){
    const clen=buf.readUInt32LE(off), ctype=buf.readUInt32LE(off+4);
    if(ctype===0x4E4F534A){                                   // JSON chunk
      const json=JSON.parse(buf.slice(off+8,off+8+clen).toString('utf8'));
      const used=new Set(json.extensionsUsed||[]);
      if(used.has('KHR_mesh_quantization')) return buf;
      used.add('KHR_mesh_quantization'); json.extensionsUsed=[...used];
      let txt=JSON.stringify(json); while(txt.length%4) txt+=' ';   // chunks are 4-byte aligned
      const jsonBuf=Buffer.from(txt,'utf8');
      const head=buf.slice(0,off), tail=buf.slice(off+8+clen);
      const pre=Buffer.alloc(8); pre.writeUInt32LE(jsonBuf.length,0); pre.writeUInt32LE(0x4E4F534A,4);
      const out=Buffer.concat([head,pre,jsonBuf,tail]);
      out.writeUInt32LE(out.length,8);                          // fix total length
      return out;
    }
    off+=8+clen;
  }
  return buf;
}

// report the geometry/texture split so the budget stays honest
let texBytes = 0;
for (const t of doc.getRoot().listTextures()) texBytes += t.getImage().byteLength;
const afterTris = triCount(doc);
console.log(`in : ${(beforeBytes/1e6).toFixed(1)}MB  ${Math.round(beforeTris).toLocaleString()} tris`);
console.log(`out: ${(glb.byteLength/1e6).toFixed(2)}MB  ${Math.round(afterTris).toLocaleString()} tris  @${TEX_SIZE}px`);
console.log(`     textures ${(texBytes/1e6).toFixed(2)}MB (${(100*texBytes/glb.byteLength).toFixed(0)}% of file), geometry ${(100*(glb.byteLength-texBytes)/glb.byteLength).toFixed(0)}%`);
console.log('     per-part triangle budget (share of the model is what matters):');
for (const [name, k] of Object.entries(kept).sort((a, b) => b[1].after - a[1].after))
  console.log(`       ${name.padEnd(16)} ${String(Math.round(k.before)).padStart(7)} -> ${String(Math.round(k.after)).padStart(6)}  ${(100*k.after/afterTris).toFixed(1).padStart(5)}%`);
