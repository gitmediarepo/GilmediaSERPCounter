#!/usr/bin/env node
/* Builds the GitHub release zip, the one humans download and sideload.
 *
 * Deliberately NESTED inside a single folder, so unzipping gives one clean
 * directory to point "Load unpacked" at. That is the opposite of what the
 * Chrome Web Store wants, which is why there are two builders. See
 * store-package.js for the flat one.
 *
 * Run: node build/release-package.js
 */

const fs = require('fs');
const path = require('path');
const { buildZip } = require('./zip');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

const INCLUDE = [
  'manifest.json',
  'README.md',
  'LICENSE',
  'src/content.js',
  'src/serp.css',
  'src/popup.html',
  'src/popup.js',
  'src/options.html',
  'src/options.js',
  'src/parse.js',
  'src/help.html',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const folder = `gilmedia-serp-counter-v${manifest.version}`;

const problems = [];
const files = [];
for (const rel of INCLUDE) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    problems.push(`missing file: ${rel}`);
    continue;
  }
  files.push({ name: `${folder}/${rel.replace(/\\/g, '/')}`, data: fs.readFileSync(full) });
}

if (problems.length) {
  console.error('Cannot package:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `${folder}.zip`);
fs.writeFileSync(out, buildZip(files));

console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
console.log(`unzips to: ${folder}/`);
for (const f of files) console.log('  ' + f.name);
