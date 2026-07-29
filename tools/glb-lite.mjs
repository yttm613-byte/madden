/* glb-lite.mjs — the slice of @gltf-transform/core that tools/adopt-model.mjs uses,
 * with no dependencies.
 *
 * A candidate model has to be gradeable wherever it lands, and `npm install` does not
 * work in a sandbox whose egress allowlist excludes registry.npmjs.org. adopt-model.mjs
 * prefers the real library when it is installed and falls back to this.
 *
 * Deliberately narrow: GLB in, read-only, the exact accessors adopt-model.mjs calls.
 * Element values follow the glTF normalisation rules so a quantised model
 * (KHR_mesh_quantization) reads the same here as it does through the library.
 * Anything it cannot decode honestly — Draco, meshopt, sparse accessors — throws
 * rather than returning numbers that would grade a model on partial geometry.
 */
import fs from 'fs';
import path from 'path';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const CTYPE = {
  5120: { size: 1, get: (v, o) => v.getInt8(o),     denorm: c => Math.max(c / 127, -1) },
  5121: { size: 1, get: (v, o) => v.getUint8(o),    denorm: c => c / 255 },
  5122: { size: 2, get: (v, o) => v.getInt16(o, true),  denorm: c => Math.max(c / 32767, -1) },
  5123: { size: 2, get: (v, o) => v.getUint16(o, true), denorm: c => c / 65535 },
  5125: { size: 4, get: (v, o) => v.getUint32(o, true), denorm: c => c },
  5126: { size: 4, get: (v, o) => v.getFloat32(o, true), denorm: c => c },
};

class Accessor {
  constructor(gltf, def, buffers) {
    if (def.sparse) throw new Error('sparse accessors are not supported by glb-lite — install @gltf-transform/core');
    this._def = def;
    this._n = COMPONENTS[def.type];
    this._ct = CTYPE[def.componentType];
    if (!this._n || !this._ct) throw new Error(`unsupported accessor ${def.type}/${def.componentType}`);
    const view = gltf.bufferViews[def.bufferView];
    // An accessor with no bufferView reads as zeroes per the glTF spec.
    if (view === undefined) { this._view = null; return; }
    const buf = buffers[view.buffer];
    this._base = (view.byteOffset || 0) + (def.byteOffset || 0);
    this._stride = view.byteStride || this._n * this._ct.size;
    this._view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const end = this._base + this._stride * (def.count - 1) + this._n * this._ct.size;
    if (end > (view.byteOffset || 0) + view.byteLength || end > buf.byteLength)
      throw new Error('accessor reads past the end of its bufferView — malformed file');
  }
  getCount() { return this._def.count; }
  getElement(i, out) {
    for (let c = 0; c < this._n; c++) {
      if (!this._view) { out[c] = 0; continue; }
      const raw = this._ct.get(this._view, this._base + this._stride * i + c * this._ct.size);
      out[c] = this._def.normalized ? this._ct.denorm(raw) : raw;
    }
    return out;
  }
  getScalar(i) { return this.getElement(i, [0])[0]; }
}

class Texture {
  constructor(gltf, def, buffers) {
    const img = gltf.images && gltf.images[def.source] || {};
    this._name = img.name || def.name || '';
    this._mime = img.mimeType || (img.uri && /\.png/i.test(img.uri) ? 'image/png' : 'image/jpeg');
    if (img.bufferView !== undefined) {
      const v = gltf.bufferViews[img.bufferView];
      const b = buffers[v.buffer];
      this._image = b.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    } else if (img.uri && img.uri.startsWith('data:')) {
      this._image = Buffer.from(img.uri.slice(img.uri.indexOf(',') + 1), 'base64');
    } else {
      this._image = null;   // external file: size unknown, reported as 0KB
    }
  }
  getName() { return this._name; }
  getMimeType() { return this._mime; }
  getImage() { return this._image; }
}

class Material {
  constructor(def, textures) { this._def = def; this._textures = textures; }
  getName() { return this._def.name || ''; }
  getOcclusionTexture() {
    const t = this._def.occlusionTexture;
    return t ? this._textures[t.index] : null;
  }
}

class Primitive {
  constructor(gltf, def, accessors, materials) { this._def = def; this._a = accessors; this._m = materials; }
  getMaterial() { return this._def.material === undefined ? null : this._m[this._def.material]; }
  getAttribute(name) {
    const i = this._def.attributes[name];
    return i === undefined ? null : this._a[i];
  }
  getIndices() { return this._def.indices === undefined ? null : this._a[this._def.indices]; }
}

class Root {
  constructor(gltf, buffers) {
    for (const ext of gltf.extensionsRequired || []) {
      if (/draco|meshopt/i.test(ext))
        throw new Error(`${ext} is required to read this file — install @gltf-transform/core and its codec`);
    }
    this._textures = (gltf.textures || []).map(d => new Texture(gltf, d, buffers));
    this._materials = (gltf.materials || []).map(d => new Material(d, this._textures));
    const accessors = (gltf.accessors || []).map(d => new Accessor(gltf, d, buffers));
    this._meshes = (gltf.meshes || []).map(d => ({
      getName: () => d.name || '',
      listPrimitives: () => d.primitives.map(p => new Primitive(gltf, p, accessors, this._materials)),
    }));
    const nodes = (gltf.nodes || []).map(d => ({ getName: () => d.name || '' }));
    this._skins = (gltf.skins || []).map(d => ({ listJoints: () => (d.joints || []).map(j => nodes[j]) }));
  }
  listMeshes()    { return this._meshes; }
  listSkins()     { return this._skins; }
  listTextures()  { return this._textures; }
  listMaterials() { return this._materials; }
}

export class NodeIO {
  async read(file) {
    const bytes = fs.readFileSync(file);
    let gltf, buffers;

    if (bytes.slice(0, 4).toString('latin1') === 'glTF') {
      if (bytes.readUInt32LE(4) !== 2) throw new Error('only glTF 2.0 is supported');
      let off = 12, json = null, bin = null;
      while (off + 8 <= bytes.length) {
        const len = bytes.readUInt32LE(off), type = bytes.slice(off + 4, off + 8).toString('latin1');
        const data = bytes.subarray(off + 8, off + 8 + len);
        if (type === 'JSON') json = data; else if (type.startsWith('BIN')) bin = data;
        off += 8 + len;                       // GLB requires chunk lengths to be 4-byte aligned
      }
      if (!json) throw new Error('GLB has no JSON chunk');
      gltf = JSON.parse(json.toString('utf8'));
      buffers = (gltf.buffers || []).map(b => b.uri === undefined ? bin : resolveUri(b.uri, file));
    } else {
      gltf = JSON.parse(bytes.toString('utf8'));
      buffers = (gltf.buffers || []).map(b => resolveUri(b.uri, file));
    }

    const root = new Root(gltf, buffers);
    return { getRoot: () => root, _bytes: bytes };
  }
  // adopt-model.mjs only measures the result. Report the bytes on disk rather than
  // re-serialising, which is both the honest number and the one a reader can check.
  async writeBinary(doc) { return doc._bytes; }
}

function resolveUri(uri, file) {
  if (uri === undefined) throw new Error('buffer has no uri and no BIN chunk');
  if (uri.startsWith('data:')) return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
  return fs.readFileSync(path.resolve(path.dirname(file), decodeURIComponent(uri)));
}
