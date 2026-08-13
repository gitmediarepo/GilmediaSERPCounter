/* Minimal deterministic zip writer.
 *
 * Shared by store-package.js and release-package.js so the two archives are
 * produced by identical code and differ only in their file list. No external
 * dependency, because a build that needs npm install on a network drive is a
 * build that fails at the worst moment.
 */

const zlib = require('zlib');

function crcTable() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC = crcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Fixed timestamp so the same source always produces a byte-identical zip.
 * Makes it obvious whether an upload actually changed anything. */
const DOS_TIME = 0;
const DOS_DATE = 33; // 1980-01-01

function localHeader(name, data, deflated) {
  const n = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(0, 6); // flags
  h.writeUInt16LE(8, 8); // deflate
  h.writeUInt16LE(DOS_TIME, 10);
  h.writeUInt16LE(DOS_DATE, 12);
  h.writeUInt32LE(crc32(data), 14);
  h.writeUInt32LE(deflated.length, 18);
  h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(n.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, n]);
}

function centralHeader(name, data, deflated, offset) {
  const n = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(20, 6);
  h.writeUInt16LE(0, 8);
  h.writeUInt16LE(8, 10);
  h.writeUInt16LE(DOS_TIME, 12);
  h.writeUInt16LE(DOS_DATE, 14);
  h.writeUInt32LE(crc32(data), 16);
  h.writeUInt32LE(deflated.length, 20);
  h.writeUInt32LE(data.length, 24);
  h.writeUInt16LE(n.length, 28);
  h.writeUInt32LE(offset, 42); // relative offset of local header
  return Buffer.concat([h, n]);
}

/** files: [{ name, data }] where name uses forward slashes. */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of files) {
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const lh = localHeader(name, data, deflated);
    locals.push(lh, deflated);
    centrals.push(centralHeader(name, data, deflated, offset));
    offset += lh.length + deflated.length;
  }

  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, central, end]);
}

module.exports = { buildZip, crc32 };
