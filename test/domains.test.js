/* The client list parser, and the panel behaviour when a whole agency roster is
 * loaded: only the domains that actually appear get a line.
 *
 * Run: node test/clients.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PARSE = fs.readFileSync(path.join(__dirname, '..', 'src', 'parse.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

// ------------------------------------------------------------ parser

/* parse.js is a plain script shared by the popup and the manager, so it can be
 * evaluated on its own and reached into directly. */
function loadParser() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://example.org',
    runScripts: 'outside-only',
  });
  // Top-level function declarations land on the window.
  dom.window.eval(
    PARSE +
      '\n;window.__parseDomains = parseDomains;' +
      'window.__mergeText = mergeText;' +
      'window.__parseLines = parseLines;' +
      'window.__serializeLines = serializeLines;' +
      'window.__duplicateKeys = duplicateKeys;' +
      'window.__dupeKeyFor = dupeKeyFor;'
  );
  return dom.window;
}

const popupWin = loadParser();
const parse = popupWin.__parseDomains;
const merge = popupWin.__mergeText;
const parseLines = popupWin.__parseLines;
const serializeLines = popupWin.__serializeLines;
const duplicateKeys = popupWin.__duplicateKeys;
const dupeKeyFor = popupWin.__dupeKeyFor;

check(
  'domain | name, the documented format',
  parse('walmart.com | Walmart').targets,
  [{ domain: 'walmart.com', name: 'Walmart' }]
);

check(
  'padded columns from an aligned list',
  parse('timhortons.com      |    Tim Hortons').targets,
  [{ domain: 'timhortons.com', name: 'Tim Hortons' }]
);

check('comma separated, as pasted from a sheet', parse('homedepot.com, Home Depot').targets, [
  { domain: 'homedepot.com', name: 'Home Depot' },
]);

check('tab separated, as pasted from a sheet', parse('lowes.com\tLowes').targets, [
  { domain: 'lowes.com', name: 'Lowes' },
]);

check('columns the other way round still work', parse('Starbucks | starbucks.com').targets, [
  { domain: 'starbucks.com', name: 'Starbucks' },
]);

check('a domain on its own', parse('costco.com').targets, [
  { domain: 'costco.com', name: '' },
]);

check('a business name on its own', parse('Best Buy').targets, [
  { domain: '', name: 'Best Buy' },
]);

check(
  'protocol and www are stripped',
  parse('https://www.yelp.com/ | Yelp').targets,
  [{ domain: 'yelp.com', name: 'Yelp' }]
);

check(
  'comments and blank lines are ignored',
  parse('# my clients\n\nhomedepot.com | Home Depot\n\n# end').targets.length,
  1
);

check(
  'duplicates collapse',
  parse('homedepot.com | Home Depot\nhomedepot.com | Home Depot').targets.length,
  1
);

check(
  'a realistic roster parses whole',
  parse(`walmart.com | Walmart
starbucks.com | Starbucks
timhortons.com | Tim Hortons
yelp.com | Yelp
homedepot.com | Home Depot`).targets.length,
  5
);

// ------------------------------------------------------------ import merge

/* Import must add without destroying. Re-importing the same file has to be a
 * no-op, otherwise a roster doubles every time someone hits the button twice. */
const BASE = 'walmart.com | Walmart\nstarbucks.com | Starbucks';

check('import adds only the new lines', merge(BASE, 'timhortons.com | Tim Hortons').added, 1);
check(
  'existing entries survive the merge',
  merge(BASE, 'timhortons.com | Tim Hortons').text.includes('walmart.com | Walmart'),
  true
);
check('re-importing the same file adds nothing', merge(BASE, BASE).added, 0);
check('and leaves the text untouched', merge(BASE, BASE).text, BASE);
check(
  'a partial overlap adds only what is missing',
  merge(BASE, 'walmart.com | Walmart\nyelp.com | Yelp').added,
  1
);
check(
  'comments in the imported file are not carried over',
  merge(BASE, '# a comment\nyelp.com | Yelp').text.includes('# a comment'),
  false
);
check(
  'importing into an empty list works',
  merge('', 'walmart.com | Walmart').text.trim(),
  'walmart.com | Walmart'
);
check(
  'a csv export re-imports cleanly',
  merge(BASE, 'yelp.com,Yelp').added,
  1
);
check(
  'the same client with a different name is treated as new',
  merge(BASE, 'walmart.com | Walmart Canada').added,
  1
);

// ------------------------------------------------- panel with a full roster

const ROSTER = [
  { domain: 'walmart.com', name: 'Walmart' },
  { domain: 'starbucks.com', name: 'Starbucks' },
  { domain: 'timhortons.com', name: 'Tim Hortons' },
  { domain: 'yelp.com', name: 'Yelp' },
  { domain: 'homedepot.com', name: 'Home Depot' },
];

function runSerp(hostForResult3) {
  const organic = Array.from({ length: 5 }, (_, i) => {
    const host = i === 2 ? hostForResult3 : `unrelated${i}.com`;
    return `<div class="MjjYud"><div class="g"><a href="https://www.${host}/x"><h3>Result ${i + 1}</h3></a></div></div>`;
  }).join('');
  const dom = new JSDOM(
    `<!doctype html><body><div id="center_col"><div id="rso">${organic}</div></div></body>`,
    { url: 'https://www.google.com/search?q=appliance+repair', runScripts: 'outside-only' }
  );
  dom.window.chrome = {
    storage: {
      sync: { get: (d, cb) => cb({ ...d, targets: ROSTER }) },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(CONTENT);
  return dom.window.document;
}

const withHit = runSerp('starbucks.com');
const rows = [...withHit.querySelectorAll('#gil-serp-panel .gil-serp-row')];

check('only the matching client gets a panel row', rows.length, 1);
check(
  'and it is the right one',
  withHit.querySelector('#gil-serp-panel .gil-serp-dom').textContent,
  'starbucks.com'
);
check(
  'at its true position',
  withHit.querySelector('#gil-serp-panel .gil-serp-pos').textContent,
  '3'
);
check(
  'the result itself is marked',
  withHit.querySelectorAll('.gil-serp-hit').length,
  1
);

const noHit = runSerp('somebodyelse.com');
check(
  'with no match the panel says so once, not five times',
  noHit.querySelectorAll('#gil-serp-panel .gil-serp-row').length,
  1
);
check(
  'and names how many domains were checked',
  /none of your 5 domains found yet/.test(
    noHit.querySelector('#gil-serp-panel .gil-serp-miss').textContent
  ),
  true
);
check('nothing is highlighted', noHit.querySelectorAll('.gil-serp-hit').length, 0);
check(
  'but every result is still numbered',
  noHit.querySelectorAll('.gil-serp-badge--organic').length,
  5
);

// ------------------------------------- many domains matching at once

/* The panel has to carry a full result: several domains, each with every
 * position it holds across organic, Ads and the local pack. */
function runBusySerp() {
  const ads = `<div id="tads">
      <div class="uEierd"><a href="https://someoneelse.com/"><h3>Ad one</h3></a></div>
      <div class="uEierd"><a href="https://www.homedepot.com/quote"><h3>Home Depot</h3></a></div>
    </div>`;

  const biz = `<div id="biz-block" data-hveid="biz"><h2>Businesses</h2>
      <div data-cid="1"><div class="dbg0pd">Starbucks</div>
        <a href="https://starbucks.com/">website</a></div>
      <div data-cid="2"><div class="dbg0pd">Some Other Firm</div>
        <a href="https://other.example/">website</a></div>
      <div data-cid="3"><div class="dbg0pd">Walmart</div>
        <a href="https://walmart.com/">website</a></div>
    </div>`;

  const hosts = [
    'filler0.com',
    'starbucks.com',
    'filler1.com',
    'timhortons.com',
    'filler2.com',
    'homedepot.com',
  ];
  const organic = `<div id="rso">${hosts
    .map(
      (h, i) =>
        `<div class="MjjYud"><div class="g"><a href="https://www.${h}/x"><h3>Result ${i + 1}</h3></a></div></div>`
    )
    .join('')}</div>`;

  const dom = new JSDOM(
    `<!doctype html><body><div id="center_col">${ads}${biz}${organic}</div></body>`,
    { url: 'https://www.google.com/search?q=toronto&start=10', runScripts: 'outside-only' }
  );
  dom.window.chrome = {
    storage: {
      sync: { get: (d, cb) => cb({ ...d, targets: ROSTER }) },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(CONTENT);
  return dom.window.document;
}

const busy = runBusySerp();
const panelRows = [...busy.querySelectorAll('#gil-serp-panel .gil-serp-row')];
const names = panelRows.map((r) => r.querySelector('.gil-serp-dom').textContent);

check('every matching domain gets its own row', panelRows.length, 4);
check(
  'and they are all there',
  names.slice().sort(),
  ['homedepot.com', 'starbucks.com', 'timhortons.com', 'walmart.com']
);
check(
  'the header counts matches against the roster and names the page',
  busy.querySelector('#gil-serp-panel .gil-serp-found').textContent,
  '4 of 5 domains on page 2'
);

const chipsFor = (dom) =>
  panelRows
    .find((r) => r.querySelector('.gil-serp-dom').textContent === dom)
    .querySelectorAll('.gil-serp-pos');

check(
  'a domain appearing twice shows both positions',
  [...chipsFor('starbucks.com')].map((c) => c.textContent),
  ['12', 'Map 1']
);
check(
  'organic rank respects the page offset',
  [...chipsFor('timhortons.com')].map((c) => c.textContent),
  ['14']
);
check(
  'an ad-only entry still shows, tagged as an ad',
  [...chipsFor('homedepot.com')].map((c) => c.textContent),
  ['16', 'Ad 2']
);
check(
  'a local-only entry shows its map position',
  [...chipsFor('walmart.com')].map((c) => c.textContent),
  ['Map 3']
);
check(
  'chips carry the surface colour class',
  chipsFor('homedepot.com')[1].className.includes('gil-serp-pos--ad'),
  true
);
check(
  'best position sorts to the top',
  names[0],
  'starbucks.com'
);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
