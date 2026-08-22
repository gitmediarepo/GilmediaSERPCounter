/* Verifies the part that actually matters: that page 3 numbers 21-30 and not
 * 1-10, that Ads and the local pack are counted on their own scales, and that
 * the tracked domain gets marked.
 *
 * The local pack fixtures deliberately use three DIFFERENT structures Google
 * has shipped, because that section is the one that keeps breaking.
 *
 * Run: node test/numbering.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

const TARGET = 'northside-windows.example';

// A stripped-down copy of the shapes Google actually ships: a heading inside a
// link inside a result wrapper, ads under #tads, local pack rows with .dbg0pd.
function fixture() {
  const organic = Array.from({ length: 10 }, (_, i) => {
    const host = i === 3 ? TARGET : `site${i}.com`;
    return `<div class="MjjYud"><div class="g"><div><a href="https://www.${host}/page">
      <h3>Result ${i + 1} from ${host}</h3></a><span>snippet text</span></div></div></div>`;
  }).join('');

  const ads = `<div id="tads">
      <div class="uEierd"><a href="https://ad-one.com/"><h3>Ad one</h3></a></div>
      <div class="uEierd"><a href="https://${TARGET}/quote"><h3>Windows and doors</h3></a></div>
    </div>`;

  // Row 1: classic .dbg0pd. Row 2: newer .VkpGBb with a Maps link and no cid.
  // Row 3: .rllt__link wrapper. Plus a "More places" footer that must NOT count.
  const local = `<div data-async-context="local:1">
      <div jsaction="x" data-cid="1"><div class="dbg0pd">Some Other Company</div>
        <span aria-label="Rated 4.1 out of 5">4.1</span> (88) &middot; Appliance repair service
        &middot; 12 King St &middot; Open &middot; Closes 6 pm
        <a href="https://other.example/">website</a></div>
      <div class="VkpGBb"><div class="dbg0pd">Northside Windows and Doors</div>
        <span aria-label="Rated 4.8 out of 5">4.8</span> (214) &middot; Window installation service
        &middot; 400 Queen Rd &middot; Google Guaranteed &middot; Onsite services
        <a href="https://www.google.com/maps/place/Northside/@0,0,17z/data=0x1:0x2">directions</a>
        <a href="https://${TARGET}/">website</a></div>
      <div class="rllt__link"><div class="dbg0pd">Third Local Business</div>
        <a href="https://third.example/">website</a></div>
      <div class="VkpGBb"><a href="https://www.google.com/maps/search/windows">More places</a></div>
    </div>`;

  return `<!doctype html><html><body><div id="center_col">
      ${ads}${local}<div id="rso">${organic}</div>
    </div></body></html>`;
}

function boot(url) {
  const dom = new JSDOM(fixture(), { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  dom.window.chrome = {
    storage: {
      sync: {
        get: (defaults, cb) =>
          cb({ ...defaults, targets: [{ domain: TARGET, name: 'Northside' }] }),
      },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(SRC);
  return dom.window;
}

const window = boot('https://www.google.com/search?q=windows+installer&start=20');

// ------------------------------------------------------------------- assert

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

const doc = window.document;
/** Badge number only, ignoring the small type tag appended inside it. */
const nums = (kind) =>
  [...doc.querySelectorAll(`.gil-serp-badge--${kind}`)].map((b) => b.firstChild.textContent);

check('organic numbering continues from start=20', nums('organic'), [
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
]);
check('ads counted on their own scale', nums('ad'), ['1', '2']);
check('three local rows counted, "More places" excluded', nums('local'), ['1', '2', '3']);

check(
  'organic badges carry a page/position tag, not a type tag',
  [...doc.querySelectorAll('.gil-serp-badge--organic .gil-serp-tag')].map((t) => t.textContent),
  ['p3.1', 'p3.2', 'p3.3', 'p3.4', 'p3.5', 'p3.6', 'p3.7', 'p3.8', 'p3.9', 'p3.10']
);
check(
  'non-organic badges are tagged',
  [...doc.querySelectorAll('.gil-serp-badge--ad .gil-serp-tag')].map((t) => t.textContent),
  ['Ad', 'Ad']
);

const hits = [...doc.querySelectorAll('.gil-serp-hit')];
check('three hits marked (organic + ad + local)', hits.length, 3);

check(
  'tracked domain sits at true rank 24',
  [...doc.querySelectorAll('#rso .gil-serp-hit .gil-serp-badge')].map((b) => b.firstChild.textContent),
  ['24']
);

const row2 = doc.querySelectorAll('.VkpGBb')[0];
check('business name matched in the local pack', row2.classList.contains('gil-serp-hit'), true);

const panel = doc.getElementById('gil-serp-panel');
check('panel rendered', !!panel, true);
check('panel reports the page range', panel.querySelector('.gil-serp-range').textContent, '21-30');
check(
  'panel labels the local hit as Map 2',
  [...panel.querySelectorAll('.gil-serp-pos')].map((p) => p.textContent).includes('Map 2'),
  true
);

// Page 1 has no start param, so it must begin at 1.
const w1 = boot('https://www.google.com/search?q=windows+installer');
check(
  'page 1 starts at 1',
  w1.document.querySelector('#rso .gil-serp-badge--organic').firstChild.textContent,
  '1'
);

check('diagnostic hatch is exposed', typeof window.__gilSerpDiag, 'function');

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
