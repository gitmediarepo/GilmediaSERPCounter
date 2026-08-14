/* Generates the extension's toolbar icons as real PNGs, no image editor needed.
 * A rounded Gilmedia-orange square with a dark "G" cut into it, full-bleed.
 *
 * Full-bleed is correct here: at 16 pixels in a browser toolbar, padding would
 * throw away a quarter of an already tiny icon. The Web Store listing icon has
 * the opposite requirement and is built by make-store-icon.js.
 *
 * Run: node build/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png');
const { renderMark } = require('./shape');

const OUT = path.join(__dirname, '..', 'icons');

fs.mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(file, encodePNG(size, size, renderMark(size)));
  console.log(`wrote ${file} (${fs.statSync(file).size} bytes)`);
}
