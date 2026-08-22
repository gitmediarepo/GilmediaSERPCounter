/* The running log: paging 1 -> 2 -> 3 on the same search term has to accumulate
 * into one answer, and a new search term has to wipe it.
 *
 * Each page is a real page load, so the test drives several JSDOM windows that
 * share one sessionStorage, which is what a single browser tab actually does.
 *
 * Run: node test/running-log.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

const ROSTER = [
  { domain: 'walmart.com', name: 'Walmart' },
  { domain: 'starbucks.com', name: 'Starbucks' },
  { domain: 'timhortons.com', name: 'Tim Hortons' },
];

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

/* One shared store standing in for the tab's sessionStorage across navigations. */
const tabStore = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
})();

/** Load one results page in the same "tab". */
function visit(query, start, hostAtSlot2, opts = {}) {
  const ads = opts.ad
    ? `<div id="tads"><div class="uEierd"><a href="https://${opts.ad}/x"><h3>Ad</h3></a></div></div>`
    : '';
  const organic = Array.from({ length: 5 }, (_, i) => {
    const host = i === 2 ? hostAtSlot2 : `filler${start}${i}.com`;
    return `<div class="MjjYud"><div class="g"><a href="https://www.${host}/x"><h3>R${i}</h3></a></div></div>`;
  }).join('');

  const url =
    `https://www.google.com/search?q=${encodeURIComponent(query)}` +
    (start ? `&start=${start}` : '');
  const dom = new JSDOM(
    `<!doctype html><body><div id="center_col">${ads}<div id="rso">${organic}</div></div></body>`,
    { url, runScripts: 'outside-only' }
  );
  Object.defineProperty(dom.window, 'sessionStorage', { value: tabStore, configurable: true });
  dom.window.chrome = {
    storage: {
      sync: { get: (d, cb) => cb({ ...d, targets: ROSTER }) },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(SRC);
  return dom.window.document;
}

const panelText = (doc) => doc.querySelector('#gil-serp-panel').textContent.replace(/\s+/g, ' ');
const rowDomains = (doc) =>
  [...doc.querySelectorAll('#gil-serp-panel .gil-serp-dom')].map((d) => d.textContent);
const chips = (doc, domain) => {
  const row = [...doc.querySelectorAll('#gil-serp-panel .gil-serp-row')].find(
    (r) => r.querySelector('.gil-serp-dom') && r.querySelector('.gil-serp-dom').textContent === domain
  );
  return row ? [...row.querySelectorAll('.gil-serp-pos')].map((c) => c.textContent) : [];
};

// --- page 1 ------------------------------------------------------------------
let doc = visit('coffee toronto', 0, 'walmart.com');
check('page 1 finds the one client on it', rowDomains(doc), ['walmart.com']);
check('page 1 reports its own scope', /on page 1/.test(panelText(doc)), true);
check('the search term is shown', /tracking .coffee toronto./.test(panelText(doc)), true);

// --- page 2, same term -------------------------------------------------------
doc = visit('coffee toronto', 10, 'starbucks.com');
check(
  'page 2 keeps page 1 and adds its own',
  rowDomains(doc).slice().sort(),
  ['starbucks.com', 'walmart.com']
);
check('scope now names both pages', /across pages 1, 2/.test(panelText(doc)), true);
check('the page 1 position survived', chips(doc, 'walmart.com'), ['3 (p1.3)']);
check('the page 2 position is a true rank', chips(doc, 'starbucks.com'), ['13 (p2.3)']);

// --- page 3, same term, plus an ad ------------------------------------------
doc = visit('coffee toronto', 20, 'timhortons.com', { ad: 'walmart.com' });
check(
  'page 3 accumulates all three',
  rowDomains(doc).slice().sort(),
  ['starbucks.com', 'timhortons.com', 'walmart.com']
);
check('scope names all three pages', /across pages 1, 2, 3/.test(panelText(doc)), true);
check('the count is cumulative', /3 of 3 domains/.test(panelText(doc)), true);
check(
  'a domain found on two pages keeps both, and the ad chip names its page',
  chips(doc, 'walmart.com'),
  ['3 (p1.3)', 'Ad 1 ·p3']
);

// --- revisiting a page must not duplicate ------------------------------------
doc = visit('coffee toronto', 10, 'starbucks.com');
check('revisiting page 2 adds no duplicate row', rowDomains(doc).length, 3);
check('and no duplicate chip', chips(doc, 'starbucks.com'), ['13 (p2.3)']);

// --- a new search term resets ------------------------------------------------
doc = visit('windows installer', 0, 'timhortons.com');
check('a new search term starts fresh', rowDomains(doc), ['timhortons.com']);
check('and forgets the old pages', /on page 1/.test(panelText(doc)), true);
check('and names the new term', /tracking .windows installer./.test(panelText(doc)), true);

// --- the same term again after switching away --------------------------------
doc = visit('coffee toronto', 0, 'walmart.com');
check(
  'going back to the first term does not resurrect its old log',
  rowDomains(doc),
  ['walmart.com']
);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
