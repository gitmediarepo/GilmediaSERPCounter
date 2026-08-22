/* Settings page: colours, bubble shape and font for the on-page badges.
 *
 * Saved as one `style` object in chrome.storage.sync, read by content.js on
 * every SERP it touches. This page never reads the domain list - that stays
 * on options.html, one job per page.
 */

const DEFAULT_STYLE = {
  colors: {
    organic: '#f37333',
    ad: '#7a5cff',
    lsa: '#4a86e8',
    local: '#2b7fd4',
    ai: '#9457f0',
    hit: '#627d47',
    mention: '#d4832b',
  },
  bubble: 'circle',
  fontSize: 12,
  fontFamily: 'Mulish, -apple-system, Segoe UI, Arial, sans-serif',
};

const COLOR_KEYS = ['organic', 'ad', 'lsa', 'local', 'ai', 'hit', 'mention'];
const $ = (id) => document.getElementById(id);

function clamp255(n) {
  return Math.max(0, Math.min(255, n));
}

/** Same shade math as content.js, kept in step so the preview matches the page. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const toward = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  r = clamp255(Math.round((toward - r) * p) + r);
  g = clamp255(Math.round((toward - g) * p) + g);
  b = clamp255(Math.round((toward - b) * p) + b);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function gradient(hex) {
  return `linear-gradient(160deg, ${shade(hex, 0.28)} 0%, ${hex} 55%, ${shade(hex, -0.22)} 100%)`;
}

let style = { ...DEFAULT_STYLE, colors: { ...DEFAULT_STYLE.colors } };

function setStatus(msg, kind) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.className = `status${kind ? ' ' + kind : ''}`;
}

function radiusFor(variant) {
  return { circle: '50%', rounded: '10px', square: '4px', pill: '15px' }[variant] || '50%';
}

function paintPreview() {
  const radius = radiusFor(style.bubble);
  const pillW = style.bubble === 'pill';
  const font = `700 ${style.fontSize}px/1 ${style.fontFamily}`;

  const badges = [
    { wrap: $('previewOrganic'), color: style.colors.organic },
    { wrap: $('previewAi'), color: style.colors.ai },
    { wrap: $('previewHit'), color: style.colors.hit },
  ];
  for (const b of badges) {
    if (!b.wrap) continue;
    b.wrap.style.background = gradient(b.color);
    b.wrap.style.borderRadius = radius;
    b.wrap.style.color = '#fff';
    b.wrap.style.font = font;
    if (pillW) {
      b.wrap.style.width = 'auto';
      b.wrap.style.minWidth = '30px';
      b.wrap.style.padding = '0 10px';
    } else {
      b.wrap.style.width = '30px';
      b.wrap.style.minWidth = '';
      b.wrap.style.padding = '0';
    }
  }

  for (const v of document.querySelectorAll('.variant')) {
    v.classList.toggle('on', v.dataset.v === style.bubble);
  }
}

function saveStyle() {
  chrome.storage.sync.set({ style }, () => {
    if (chrome.runtime.lastError) {
      setStatus('could not save', 'bad');
      return;
    }
    setStatus('saved', 'ok');
    setTimeout(() => setStatus(''), 1800);
  });
}

function applyToForm() {
  for (const key of COLOR_KEYS) {
    const el = $(`c-${key}`);
    if (el) el.value = style.colors[key] || DEFAULT_STYLE.colors[key];
  }
  const fam = $('fontFamily');
  if (fam) fam.value = style.fontFamily;
  const size = $('fontSize');
  if (size) size.value = style.fontSize;
  const sizeOut = $('fontSizeOut');
  if (sizeOut) sizeOut.textContent = style.fontSize;
  paintPreview();
}

for (const key of COLOR_KEYS) {
  const el = $(`c-${key}`);
  if (!el) continue;
  el.addEventListener('input', () => {
    style.colors[key] = el.value;
    paintPreview();
    saveStyle();
  });
}

for (const el of document.querySelectorAll('.variant')) {
  el.addEventListener('click', () => {
    style.bubble = el.dataset.v;
    paintPreview();
    saveStyle();
  });
}

const fontFamilySel = $('fontFamily');
if (fontFamilySel) {
  fontFamilySel.addEventListener('change', () => {
    style.fontFamily = fontFamilySel.value;
    paintPreview();
    saveStyle();
  });
}

const fontSizeInput = $('fontSize');
if (fontSizeInput) {
  fontSizeInput.addEventListener('input', () => {
    style.fontSize = Number(fontSizeInput.value) || DEFAULT_STYLE.fontSize;
    const out = $('fontSizeOut');
    if (out) out.textContent = style.fontSize;
    paintPreview();
  });
  fontSizeInput.addEventListener('change', saveStyle);
}

const resetBtn = $('reset');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    style = { ...DEFAULT_STYLE, colors: { ...DEFAULT_STYLE.colors } };
    applyToForm();
    saveStyle();
  });
}

chrome.storage.sync.get({ style: DEFAULT_STYLE }, (cfg) => {
  style = {
    ...DEFAULT_STYLE,
    ...(cfg.style || {}),
    colors: { ...DEFAULT_STYLE.colors, ...((cfg.style || {}).colors || {}) },
  };
  applyToForm();
});
