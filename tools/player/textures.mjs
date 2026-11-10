/* textures.mjs — tiling fabric detail, generated.
 *
 * Height fields for each cloth, turned into tangent-space normal maps. They tile, so
 * one 512px tile covers a few centimetres of fabric and repeats; the pattern is fine
 * enough that projection seams vanish in it. Each returns RGBA8 pixels.
 */
function heightToNormal(H, N, strength) {
  const px = new Uint8Array(N*N*4);
  const at = (x, y) => H[((y+N)%N)*N + ((x+N)%N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (at(x+1, y) - at(x-1, y))*0.5*strength*N/512, dy = (at(x, y+1) - at(x, y-1))*0.5*strength*N/512;
    let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = 4*(y*N+x);
    // glTF normal maps: +Y up in texture space; image rows run down, so flip dy
    px[k] = Math.round((nx*0.5+0.5)*255); px[k+1] = Math.round((-ny*0.5+0.5)*255); px[k+2] = Math.round((nz*0.5+0.5)*255); px[k+3] = 255;
  }
  return px;
}
const TAU = Math.PI*2;
function hash(i, j) { let h = (i*374761393 + j*668265263) | 0; h = (h ^ (h >>> 13))*1274126177 | 0; return ((h ^ (h >>> 16)) & 0xffff)/0xffff; }

// Athletic interlock knit with a pinhole mesh: rows of rounded stitches, offset every
// other row, and small ventilation holes on a diamond lattice.
export function jerseyNormal(N = 512) {
  const H = new Float32Array(N*N);
  const cols = 32, rows = 32;              // stitches across one tile
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x/N*cols, v = y/N*rows;
    const r = Math.floor(v), off = (r & 1) ? 0.5 : 0;
    const fu = (u + off) % 1, fv = v % 1;
    const stitch = Math.sin(fu*Math.PI)**0.8 * Math.sin(fv*Math.PI)**0.6;     // a raised loop
    // pinholes on a coarser diamond lattice
    const a = (x/N*8 + y/N*8) % 1, b = (x/N*8 - y/N*8 + 16) % 1;
    const d = Math.hypot(a-0.5, b-0.5);
    const hole = d < 0.13 ? -((1 - d/0.13)**1.5)*1.4 : 0;
    H[y*N+x] = stitch*0.8 + hole;
  }
  return heightToNormal(H, N, 2.2);
}
// Stretch twill: fine diagonal wales.
export function pantsNormal(N = 512) {
  const H = new Float32Array(N*N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x/N, v = y/N;
    const w = Math.sin((u*40 + v*40)*TAU)*0.5 + Math.sin((u*80 - v*6)*TAU)*0.15;
    H[y*N+x] = w;
  }
  return heightToNormal(H, N, 1.6);
}
// Rib knit: vertical ribs with small stitch bumps along them.
export function sockNormal(N = 512) {
  const H = new Float32Array(N*N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x/N, v = y/N;
    const rib = Math.abs(Math.sin(u*24*Math.PI));
    const bump = 0.25*Math.sin(v*48*TAU)*rib;
    H[y*N+x] = rib*0.9 + bump;
  }
  return heightToNormal(H, N, 2.0);
}
// Pebbled grip: small random cells.
export function gloveNormal(N = 512) {
  const H = new Float32Array(N*N), C = 40;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x/N*C, v = y/N*C; const i = Math.floor(u), j = Math.floor(v);
    let best = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ci = i+di, cj = j+dj, cx = ci + 0.2 + 0.6*hash(((ci%C)+C)%C, ((cj%C)+C)%C), cy = cj + 0.2 + 0.6*hash(((cj%C)+C)%C + 99, ((ci%C)+C)%C);
      best = Math.min(best, Math.hypot(u-cx, v-cy));
    }
    H[y*N+x] = Math.max(0, 0.5 - best)*2;
  }
  return heightToNormal(H, N, 1.4);
}

// Per-triangle box projection: each triangle is mapped on the plane facing its normal
// most directly, at `scale` metres per texture repeat. Vertices are split where
// neighbouring triangles chose different planes, so no triangle interpolates across a
// jump. For a pattern this fine the seam is invisible.
export function boxUV(pos, tris, scale) {
  const nv = pos.length/3, key = new Map(), outPos = [], outUV = [], outSrc = [], outT = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i+1], c = tris[i+2];
    const ux = pos[3*b]-pos[3*a], uy = pos[3*b+1]-pos[3*a+1], uz = pos[3*b+2]-pos[3*a+2];
    const vx = pos[3*c]-pos[3*a], vy = pos[3*c+1]-pos[3*a+1], vz = pos[3*c+2]-pos[3*a+2];
    const nx = Math.abs(uy*vz-uz*vy), ny = Math.abs(uz*vx-ux*vz), nz = Math.abs(ux*vy-uy*vx);
    const ax = nx >= ny && nx >= nz ? 0 : (ny >= nz ? 1 : 2);
    for (let k = 0; k < 3; k++) {
      const v = tris[i+k], kk = v*3+ax; let id = key.get(kk);
      if (id === undefined) {
        id = outSrc.length; key.set(kk, id); outSrc.push(v);
        const x = pos[3*v], y = pos[3*v+1], z = pos[3*v+2];
        const uv = ax === 0 ? [z, y] : ax === 1 ? [x, z] : [x, y];
        outUV.push(uv[0]/scale, uv[1]/scale);
      }
      outT[i+k] = id;
    }
  }
  return { src: Int32Array.from(outSrc), uv: Float32Array.from(outUV), tris: outT };
}
