/* glb.mjs — a minimal glTF 2.0 binary writer. No dependencies.
 *
 * Only what the player needs: meshes with skinning attributes, one skin, PBR
 * materials with embedded PNG textures, and animation clips. Each accessor gets its
 * own tightly packed bufferView, aligned to 4 bytes as the spec requires.
 */
export class GLTFBuilder {
  constructor(meta = {}) {
    this.json = { asset: { version: '2.0', generator: 'gridiron-blitz tools/player', ...meta },
      scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] };
    this.chunks = []; this.byteLength = 0;
  }
  _view(bytes, target) {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.byteLength += pad; }
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.byteLength += bytes.byteLength;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
  }
  accessor(arr, type, { normalized = false, target = null, minmax = false } = {}) {
    const comp = arr instanceof Float32Array ? 5126 : arr instanceof Uint32Array ? 5125 : arr instanceof Uint16Array ? 5123
      : arr instanceof Uint8Array ? 5121 : arr instanceof Int16Array ? 5122 : arr instanceof Int8Array ? 5120 : null;
    if (comp === null) throw new Error('unsupported array type');
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc = { bufferView: this._view(arr, target), componentType: comp, count: arr.length / size, type };
    if (normalized) acc.normalized = true;
    if (minmax) {
      const mn = new Array(size).fill(Infinity), mx = new Array(size).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) { const c = i % size; if (arr[i] < mn[c]) mn[c] = arr[i]; if (arr[i] > mx[c]) mx[c] = arr[i]; }
      acc.min = mn; acc.max = mx;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  image(png, name) {
    (this.json.images ||= []).push({ bufferView: this._view(png), mimeType: 'image/png', name });
    return this.json.images.length - 1;
  }
  sampler(s = { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }) {
    (this.json.samplers ||= []).push(s); return this.json.samplers.length - 1;
  }
  texture(image, sampler) { (this.json.textures ||= []).push({ source: image, sampler }); return this.json.textures.length - 1; }
  material(m) { (this.json.materials ||= []).push(m); return this.json.materials.length - 1; }
  node(n) { this.json.nodes.push(n); return this.json.nodes.length - 1; }
  mesh(m) { this.json.meshes.push(m); return this.json.meshes.length - 1; }
  skin(s) { (this.json.skins ||= []).push(s); return this.json.skins.length - 1; }
  animation(a) { (this.json.animations ||= []).push(a); return this.json.animations.length - 1; }
  build() {
    this.json.buffers = [{ byteLength: this.byteLength }];
    const pad4 = (b, fill) => { const p = (4 - (b.length % 4)) % 4; return p ? Buffer.concat([b, Buffer.alloc(p, fill)]) : b; };
    const jsonBuf = pad4(Buffer.from(JSON.stringify(this.json), 'utf8'), 0x20);
    const bin = pad4(Buffer.concat(this.chunks), 0);
    const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
    const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
    header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
    jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
    bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
    return Buffer.concat([header, jh, jsonBuf, bh, bin]);
  }
}
