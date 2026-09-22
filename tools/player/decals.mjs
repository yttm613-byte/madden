/* decals.mjs — number and nameplate patches that lie ON the jersey.
 *
 * A grid in a plane in front of the jersey is sphere-traced onto its surface and
 * lifted a millimetre off it, so the patch follows every curve of the pads and is
 * skinned with the torso like the fabric under it. UVs span the patch 0..1; the game
 * paints the player's own number (and name) into that texture at runtime.
 */
import { gradient, norm, cross, add, mul, sub, dot } from './sdf.mjs';

export function decal(f, { center, normal, up, width, height, nu = 16, nv = 14, lift = 0.0012 }) {
  const n = norm(normal), right = norm(cross(up, n)), u2 = norm(cross(n, right));
  const pos = [], uv = [], nrm = [], tris = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i/nu - 0.5, v = j/nv - 0.5;
    let p = add(add(add(center, mul(right, u*width)), mul(u2, v*height)), mul(n, 0.12));
    // march inward along -n until we hit the surface
    for (let it = 0; it < 200; it++) {
      const d = f(p[0], p[1], p[2]);
      if (Math.abs(d) < 1e-6) break;
      p = add(p, mul(n, -d*0.9));
    }
    const g = gradient(f, p[0], p[1], p[2]);
    p = add(p, mul(g, lift));
    pos.push(...p); nrm.push(...g); uv.push(i/nu, 1 - j/nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j*(nu+1)+i, b = a+1, c = a+nu+1, d = c+1;
    tris.push(a, c, b, b, c, d);
  }
  // wind so the face normal agrees with the surface normal
  const P = k => pos.slice(3*k, 3*k+3);
  const e1 = sub(P(tris[1]), P(tris[0])), e2 = sub(P(tris[2]), P(tris[0]));
  if (dot(cross(e1, e2), nrm.slice(0, 3)) < 0) for (let i = 0; i < tris.length; i += 3) { const t = tris[i+1]; tris[i+1] = tris[i+2]; tris[i+2] = t; }
  return { pos, uv, nrm, tris };
}

// A blocky athletic numeral font, rasterised with no canvas: each digit is a set of
// rectangles on a 5x7 grid. Only used for the texture embedded in the file so the
// model looks right in any viewer — the game paints its own numbers over it.
const DIG = {
  0: ['11111', '11011', '11011', '11011', '11011', '11011', '11111'],
  1: ['00110', '01110', '00110', '00110', '00110', '00110', '01111'],
  2: ['11111', '00011', '00011', '11111', '11000', '11000', '11111'],
  3: ['11111', '00011', '00011', '01111', '00011', '00011', '11111'],
  4: ['11011', '11011', '11011', '11111', '00011', '00011', '00011'],
  5: ['11111', '11000', '11000', '11111', '00011', '00011', '11111'],
  6: ['11111', '11000', '11000', '11111', '11011', '11011', '11111'],
  7: ['11111', '00011', '00011', '00110', '00110', '01100', '01100'],
  8: ['11111', '11011', '11011', '11111', '11011', '11011', '11111'],
  9: ['11111', '11011', '11011', '11111', '00011', '00011', '11111'],
};
export function numberImage(str, W = 256, H = 256) {
  const px = new Uint8Array(W*H*4);
  const cols = str.length*5 + (str.length-1)*1, rows = 7;
  const cell = Math.floor(Math.min(W*0.86/cols, H*0.86/rows));
  const ox = Math.floor((W - cols*cell)/2), oy = Math.floor((H - rows*cell)/2);
  const set = (x, y, r, g, b, a) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const k = 4*(y*W+x); px[k] = r; px[k+1] = g; px[k+2] = b; px[k+3] = a; };
  const on = (cx, cy) => { const d = Math.floor(cx/6), c = cx%6; if (d >= str.length || c === 5 || cy < 0 || cy >= 7) return false; return DIG[str[d]][cy][c] === '1'; };
  // outline first (a few px around each lit cell), then the fill
  const o = Math.max(2, Math.floor(cell*0.18));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = Math.floor((x-ox)/cell), gy = Math.floor((y-oy)/cell);
    if (x >= ox && y >= oy && on(gx, gy)) { set(x, y, 255, 255, 255, 255); continue; }
    let near = false;
    for (let dy = -o; dy <= o && !near; dy += o) for (let dx = -o; dx <= o && !near; dx += o) {
      const xx = x+dx, yy = y+dy; if (xx >= ox && yy >= oy && on(Math.floor((xx-ox)/cell), Math.floor((yy-oy)/cell))) near = true;
    }
    if (near) set(x, y, 30, 30, 34, 255);
  }
  return { px, W, H };
}
