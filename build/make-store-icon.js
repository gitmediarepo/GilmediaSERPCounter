#!/usr/bin/env node
/* Generates the Chrome Web Store listing icon.
 *
 * NOT the same shape as the toolbar icons in icons/. The store spec is:
 *
 *   "The actual icon size should be 96x96 (for square icons); an additional 16
 *    pixels per side should be transparent padding, adding up to 128x128 total
 *    image size."
 *
 * So the mark is drawn at 96 and floated in the middle of a 128 canvas. The
 * toolbar icons stay full-bleed, which is right for a 16-pixel browser button
 * and wrong for a store tile. Same artwork either way.
 *
 * The alpha channel is deliberate: an icon without one gets dropped into a
 * frame with a 12-pixel corner radius, which would sit a rounded square inside
 * another rounded square. No border is drawn, because the store UI adds its own.
 *
 * Run: node build/make-store-icon.js
 */

const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png');
const { renderMark } = require('./shape');

const CANVAS = 128;
const ART = 96;

const OUT_DIR = path.join(__dirname, '..', 'assets');
fs.mkdirSync(OUT_DIR, { recursive: true });

const out = path.join(OUT_DIR, 'store-icon-128.png');
fs.writeFileSync(out, encodePNG(CANVAS, CANVAS, renderMark(CANVAS, ART)));

console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
console.log(`canvas ${CANVAS}x${CANVAS}, artwork ${ART}x${ART}, padding ${(CANVAS - ART) / 2}px per side`);
