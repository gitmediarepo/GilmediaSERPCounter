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
const { buildZip } = require('./zip');

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
