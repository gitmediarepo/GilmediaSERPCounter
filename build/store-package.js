#!/usr/bin/env node
/* Builds the Chrome Web Store upload zip.
 *
 * This is NOT the same zip as the GitHub release. The store requires
 * manifest.json at the ROOT of the archive; a nested folder is rejected with
 * "manifest file is missing or unreadable". The GitHub release zip deliberately
 * nests, so that unzipping gives one clean folder to Load unpacked. Hence two
 * builds.
 *
 * Also strips anything the store has no use for: README, LICENSE, tests, build
 * scripts, docs. Smaller package, less surface for a reviewer to query.
 *
 * Run: node build/store-package.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

// Exactly what the extension needs at runtime, nothing else.
const INCLUDE = [
  'manifest.json',
  'src/content.js',
  'src/serp.css',
  'src/popup.html',
  'src/popup.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

// ---------------------------------------------------------------- zip writer

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
  h.writeUInt32LE(0, 42); // relative offset
  h.writeUInt32LE(offset, 42);
  return Buffer.concat([h, n]);
}

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

// ------------------------------------------------------------------- build

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const problems = [];
if (manifest.description.length > 132) {
  problems.push(`description is ${manifest.description.length} chars, store limit is 132`);
}
if (manifest.name.length > 45) {
  problems.push(`name is ${manifest.name.length} chars, store limit is 45`);
}
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  problems.push(`version "${manifest.version}" is not a valid store version`);
}

const files = [];
for (const rel of INCLUDE) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    problems.push(`missing file: ${rel}`);
    continue;
  }
  files.push({ name: rel.replace(/\\/g, '/'), data: fs.readFileSync(full) });
}

// Every script and stylesheet the manifest names must be in the package.
const referenced = [
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  manifest.action && manifest.action.default_popup,
  ...Object.values(manifest.icons || {}),
].filter(Boolean);

for (const ref of referenced) {
  if (!files.some((f) => f.name === ref)) problems.push(`manifest references ${ref}, not packaged`);
}

if (problems.length) {
  console.error('Cannot package:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `serp-counter-store-v${manifest.version}.zip`);
fs.writeFileSync(out, buildZip(files));

console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
console.log(`manifest at root: yes`);
console.log(`files (${files.length}):`);
for (const f of files) console.log('  ' + f.name);
console.log(`\nname:        ${manifest.name} (${manifest.name.length}/45)`);
console.log(`description: ${manifest.description.length}/132 chars`);
console.log(`version:     ${manifest.version}`);
console.log(`permissions: ${(manifest.permissions || []).join(', ') || 'none'}`);
console.log(`host perms:  ${(manifest.host_permissions || []).length}`);
