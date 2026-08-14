/* The Gilmedia mark, defined once in unit coordinates so it renders identically
 * at 16 pixels in the toolbar and at 96 pixels on the store listing.
 */

const ORANGE = [243, 115, 51];
const DARK = [22, 22, 22];

/** Rounded square filling the unit box. */
const roundedSquare = (u, v) => {
  const r = 0.22;
  const dx = Math.max(r - u, u - (1 - r), 0);
  const dy = Math.max(r - v, v - (1 - r), 0);
  return Math.hypot(dx, dy) <= r;
};

/** A "G": ring with a bite taken out on the right, plus the crossbar. */
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

/** Coverage of one pixel by a unit-space shape, sampled 3x3 for antialiasing. */
function coverage(x, y, art, inset, inside) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const u = (x + (sx + 0.5) / 3 - inset) / art;
      const v = (y + (sy + 0.5) / 3 - inset) / art;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && inside(u, v)) hits++;
    }
  }
  return hits / 9;
}

/**
 * Renders the mark into PNG scanlines.
 *
 * canvas: full image size in pixels.
 * art:    size of the mark itself, centred. Equal to canvas for a full-bleed
 *         toolbar icon; smaller than canvas when the store's transparent
 *         padding is required.
 */
function renderMark(canvas, art = canvas) {
  const inset = (canvas - art) / 2;
  const raw = Buffer.alloc(canvas * (canvas * 4 + 1));
  let p = 0;
  for (let y = 0; y < canvas; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < canvas; x++) {
      const bg = coverage(x, y, art, inset, roundedSquare);
      const fg = coverage(x, y, art, inset, glyph);
      // Glyph is dark on orange; alpha comes from the rounded square.
      const t = Math.min(fg, bg);
      raw[p++] = Math.round(ORANGE[0] * (1 - t) + DARK[0] * t);
      raw[p++] = Math.round(ORANGE[1] * (1 - t) + DARK[1] * t);
      raw[p++] = Math.round(ORANGE[2] * (1 - t) + DARK[2] * t);
      raw[p++] = Math.round(bg * 255);
    }
  }
  return raw;
}

module.exports = { renderMark, roundedSquare, glyph, ORANGE, DARK };
