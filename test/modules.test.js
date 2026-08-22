/* Regression test for the reported bug: Local Services cards were being counted
 * as map results, and some organic results were being counted as map results
 * too. The fixture below is the shape that broke it - an LSA block whose cards
 * link to Maps, a "Businesses" block, and organic results carrying role=heading.
 *
 * The rule this locks in: Map is everything under the Businesses heading and
 * nothing else. LSA is its own count. Organic is neither.
 *
 * Run: node test/modules.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

// LSA cards carry Maps links and place ids, which is exactly why the old
// selector-first approach mistook them for local pack rows.
const LSA = `
<div id="lsa-block" data-hveid="lsa">
  <div role="heading">Local Services Ads</div>
  <div role="listitem" data-cid="900"><div class="dbg0pd">Alpha Services</div>
    Google Guaranteed &middot; 4.9 (312)
    <a href="https://localservices.google.com/prov/alpha">Alpha</a>
    <a href="https://www.google.com/maps/place/Alpha/@0,0,17z/data=0x9:0xa">map</a></div>
  <div role="listitem" data-cid="901"><div class="dbg0pd">Beta Services</div>
    Google Guaranteed &middot; 4.7 (88)
    <a href="https://localservices.google.com/prov/beta">Beta</a></div>
  <a href="https://localservices.google.com/search">More places</a>
</div>`;

const BUSINESSES = `
<div id="biz-block" data-hveid="biz">
  <h2>Businesses</h2>
  <div data-cid="1"><div class="dbg0pd">Northside Windows and Doors</div>
    4.8 (214) &middot; Window installation service &middot; 400 Queen Rd
    <a href="https://northside-windows.example/">website</a></div>
  <div data-cid="2"><div class="dbg0pd">Second Local Co</div>
    4.2 (31) &middot; Contractor &middot; 9 Main St
    <a href="https://second.example/">website</a></div>
  <div data-cid="3"><div class="dbg0pd">Third Local Co</div>
    4.0 (12) &middot; Contractor &middot; 3 Bay St
    <a href="https://third.example/">website</a></div>
  <div><a href="https://www.google.com/maps/search/windows">More places</a></div>
</div>`;

// Ordinary organic results. The role=heading here is what used to get them
// misfiled as local rows.
const ORGANIC = `
<div id="rso">
  ${Array.from({ length: 5 }, (_, i) => {
    const host = i === 1 ? 'northside-windows.example' : `site${i}.com`;
    return `<div class="MjjYud"><div class="g">
        <a href="https://www.${host}/page"><h3 role="heading" aria-level="3">Organic ${i + 1}</h3></a>
        <span>A snippet that mentions a shop and a service, 4.5 stars even.</span>
      </div></div>`;
  }).join('')}
</div>`;

function boot(url) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="center_col">${LSA}${BUSINESSES}${ORGANIC}</div></body></html>`,
    { url, pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  dom.window.chrome = {
    storage: {
      sync: {
        get: (d, cb) =>
          cb({ ...d, targets: [{ domain: 'northside-windows.example', name: 'Northside' }] }),
      },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(SRC);
  return dom.window;
}

const window = boot('https://www.google.com/search?q=window+installer+toronto');
const doc = window.document;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

const badgesIn = (sel, kind) =>
  [...doc.querySelectorAll(`${sel} .gil-serp-badge--${kind}`)].map((b) => b.firstChild.textContent);
const countAll = (kind) => doc.querySelectorAll(`.gil-serp-badge--${kind}`).length;

// --- the two reported bugs ---------------------------------------------------
check('LSA cards are counted as LSA, not Map', badgesIn('#lsa-block', 'lsa'), ['1', '2']);
check('no Map badge anywhere inside the LSA block', countAll('local') - badgesIn('#biz-block', 'local').length, 0);
check('no Map badge on any organic result', badgesIn('#rso', 'local'), []);

// --- Map is exactly the Businesses block -------------------------------------
check('Businesses rows are Map 1-3', badgesIn('#biz-block', 'local'), ['1', '2', '3']);
check('"More places" footer takes no number', countAll('local'), 3);

// --- organic stays clean -----------------------------------------------------
check('organic counted separately', badgesIn('#rso', 'organic'), ['1', '2', '3', '4', '5']);
check('no organic badge inside either module', badgesIn('#biz-block', 'organic').concat(badgesIn('#lsa-block', 'organic')), []);
check('no LSA badge outside the LSA block', countAll('lsa'), 2);

// --- the tracked business is found in both places it appears -----------------
const bizHit = doc.querySelector('#biz-block [data-cid="1"]');
check('tracked business marked in the Businesses block', bizHit.classList.contains('gil-serp-hit'), true);
check('tracked domain marked in organic too', doc.querySelectorAll('#rso .gil-serp-hit').length, 1);

const panel = doc.getElementById('gil-serp-panel');
const labels = [...panel.querySelectorAll('.gil-serp-pos')].map((p) => p.textContent);
check('panel labels the local hit Map 1', labels.includes('Map 1'), true);
check('panel labels the organic hit 2 (p1.2)', labels.includes('2 (p1.2)'), true);

/* --- the page 2-3-4 blanking bug -------------------------------------------
 * A later results page has no Businesses block, but often carries a stray place
 * id or local name node inside some widget. The module walk used to climb from
 * that stray node up to a container holding the whole results column, and since
 * everything inside a module was excluded from organic, the entire page went
 * unnumbered. A module must never be allowed to swallow the results. */
const strayPage = new JSDOM(
  `<!doctype html><body><div id="center_col">
     <div data-hveid="wide">
       <div class="dbg0pd">Stray local name in a widget</div>
       ${ORGANIC}
     </div>
   </div></body>`,
  { url: 'https://www.google.com/search?q=windows&start=20', runScripts: 'outside-only' }
);
strayPage.window.chrome = window.chrome;
strayPage.window.eval(SRC);
const strayDoc = strayPage.window.document;

check(
  'a stray local node on page 3 does not blank the organic results',
  [...strayDoc.querySelectorAll('.gil-serp-badge--organic')].map((b) => b.firstChild.textContent),
  ['21', '22', '23', '24', '25']
);
check(
  'and the stray node does not become a five-row local pack',
  strayDoc.querySelectorAll('.gil-serp-badge--local').length < 2,
  true
);

// --- a page with no local pack must produce no Map badges --------------------
const plain = new JSDOM(`<!doctype html><body><div id="center_col">${ORGANIC}</div></body>`, {
  url: 'https://www.google.com/search?q=plain',
  runScripts: 'outside-only',
});
plain.window.chrome = window.chrome;
plain.window.eval(SRC);
check(
  'no local module means no Map badges at all',
  plain.window.document.querySelectorAll('.gil-serp-badge--local').length,
  0
);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
