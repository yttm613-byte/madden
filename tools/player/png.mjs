/* png.mjs — encode RGBA8/RGB8 pixel buffers as PNG using Node's built-in zlib. */
import zlib from 'zlib';
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePNG(pixels, w, h, channels = 4) {
  const stride = w*channels, raw = Buffer.alloc((stride+1)*h);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = pixels.subarray(y*stride, (y+1)*stride), up = y ? pixels.subarray((y-1)*stride, y*stride) : prev;
    // pick the filter with the smallest absolute sum (the usual heuristic)
    let bestF = 0, bestS = Infinity, best = null;
    for (let f = 0; f < 5; f++) {
      const out = new Uint8Array(stride); let s = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? row[i-channels] : 0, b = up[i], c = i >= channels ? up[i-channels] : 0, x = row[i];
        let v;
        if (f === 0) v = x; else if (f === 1) v = x - a; else if (f === 2) v = x - b; else if (f === 3) v = x - ((a + b) >> 1);
        else { const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c); v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        out[i] = v & 255; s += out[i] < 128 ? out[i] : 256 - out[i];
      }
      if (s < bestS) { bestS = s; bestF = f; best = out; }
    }
    raw[y*(stride+1)] = bestF; raw.set(best, y*(stride+1)+1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
