/* Generates the extension icons as real PNGs, no image editor required.
 * A rounded Gilmedia-orange square with a white "G" cut into it.
 * Run: node build/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');
const ORANGE = [243, 115, 51];
const DARK = [22, 22, 22];

/** Coverage of a pixel by the glyph, sampled 3x3 for cheap antialiasing. */
function coverage(x, y, size, inside) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      if (inside((x + (sx + 0.5) / 3) / size, (y + (sy + 0.5) / 3) / size)) hits++;
    }
  }
  return hits / 9;
}

// Unit-square shapes, so one definition scales to every icon size.
const roundedSquare = (u, v) => {
  const r = 0.22;
  const dx = Math.max(r - u, u - (1 - r), 0);
  const dy = Math.max(r - v, v - (1 - r), 0);
  return Math.hypot(dx, dy) <= r;
};

// A "G": ring with a bite taken out on the right, plus the crossbar.
const glyph = (u, v) => {
  const cx = 0.5;
  const cy = 0.5;
  const d = Math.hypot(u - cx, v - cy);
  const onRing = d >= 0.2 && d <= 0.32;
  const angle = Math.atan2(v - cy, u - cx); // 0 = right, grows downward
  const mouth = angle > -0.55 && angle < 0.28 && u > cx;
  const bar = v >= 0.46 && v <= 0.56 && u >= cx - 0.02 && u <= 0.74 && d <= 0.32;
  return (onRing && !mouth) || bar;
};

function render(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const bg = coverage(x, y, size, roundedSquare);
      const fg = coverage(x, y, size, glyph);
      // Glyph is dark on orange; alpha comes from the rounded square.
      const t = Math.min(fg, bg);
      const rgb = [0, 1, 2].map((i) => Math.round(ORANGE[i] * (1 - t) + DARK[i] * t));
      raw[p++] = rgb[0];
      raw[p++] = rgb[1];
      raw[p++] = rgb[2];
      raw[p++] = Math.round(bg * 255);
    }
  }
  return raw;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(file, png(size));
  console.log(`wrote ${file} (${fs.statSync(file).size} bytes)`);
}
