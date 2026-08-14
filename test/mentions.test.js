/* Domain matches versus name mentions, and the master switch.
 *
 * Searching a company name pulls up LinkedIn, Indeed, ZoomInfo and the rest,
 * all carrying the name and none of them the company's own site. Marking those
 * green says "you rank here", which is false. They get amber and their own
 * block, keyed by the site doing the mentioning.
 *
 * Run: node test/mentions.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONTENT = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

const TARGETS = [{ domain: 'gilmedia.com', name: 'Gilmedia' }];

/* Result 1 is the company's own site. Results 2 and 3 carry the name on other
 * people's domains, which is exactly the LinkedIn / ZoomInfo case. Result 4 is
 * unrelated. */
const RESULTS = [
  { host: 'gilmedia.com', title: 'Gilmedia - Digital Marketing Agency' },
  { host: 'linkedin.com', title: 'Gilmedia | LinkedIn' },
  { host: 'zoominfo.com', title: 'Gilmedia Company Profile' },
  { host: 'unrelated.com', title: 'Something else entirely' },
];

function run(cfgOverrides = {}) {
  const organic = RESULTS.map(
    (r) =>
      `<div class="MjjYud"><div class="g"><a href="https://www.${r.host}/x"><h3>${r.title}</h3></a></div></div>`
  ).join('');

  const dom = new JSDOM(
    `<!doctype html><body><div id="center_col"><div id="rso">${organic}</div></div></body>`,
    { url: 'https://www.google.com/search?q=gilmedia', runScripts: 'outside-only' }
  );
  dom.window.chrome = {
    storage: {
      sync: { get: (d, cb) => cb({ ...d, targets: TARGETS, ...cfgOverrides }) },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(CONTENT);
  return dom.window.document;
}

const panelText = (doc) => {
  const p = doc.getElementById('gil-serp-panel');
  return p ? p.textContent.replace(/\s+/g, ' ').trim() : '';
};

// ------------------------------------------------------- the default view

const doc = run();

check('the company site is a green hit', doc.querySelectorAll('.gil-serp-hit').length, 1);
check(
  'and it is the right result',
  doc.querySelector('.gil-serp-hit a').getAttribute('href').includes('gilmedia.com'),
  true
);
check('the two name matches are amber, not green', doc.querySelectorAll('.gil-serp-mention').length, 2);
check(
  'the green badge is the hit badge',
  doc.querySelectorAll('.gil-serp-badge--hit').length,
  1
);
check(
  'the amber badges are mention badges',
  doc.querySelectorAll('.gil-serp-badge--mention').length,
  2
);
check('the unrelated result is untouched', doc.querySelectorAll('.gil-serp-mention, .gil-serp-hit').length, 3);
check('every result is still numbered', doc.querySelectorAll('.gil-serp-badge--organic').length, 4);

// -------------------------------------------------------- the panel split

check('the panel counts one real domain, not three', /1 of 1 domain on page 1/.test(panelText(doc)), true);
check('mentions get their own header', /2 mentions on other sites/.test(panelText(doc)), true);
check(
  'and are keyed by the site doing the mentioning',
  /linkedin\.com/.test(panelText(doc)) && /zoominfo\.com/.test(panelText(doc)),
  true
);
check(
  'the mention block is styled apart from the hits',
  doc.querySelectorAll('.gil-serp-found--mention').length,
  1
);
check(
  'mention chips carry the mention colour',
  doc.querySelectorAll('.gil-serp-pos--mention').length,
  2
);

// ------------------------------------------------------- mentions turned off

const noMentions = run({ showMentions: false });
check('with mentions off nothing is amber', noMentions.querySelectorAll('.gil-serp-mention').length, 0);
check('the real hit is untouched', noMentions.querySelectorAll('.gil-serp-hit').length, 1);
check(
  'and the panel drops the mention block',
  /mentions on other sites/.test(panelText(noMentions)),
  false
);
check(
  'numbering carries on regardless',
  noMentions.querySelectorAll('.gil-serp-badge--organic').length,
  4
);

// ---------------------------------------------------------- master switch

const off = run({ enabled: false });
check('switched off, no badges at all', off.querySelectorAll('.gil-serp-badge').length, 0);
check('no highlights', off.querySelectorAll('.gil-serp-hit, .gil-serp-mention').length, 0);
check('no block outlines', off.querySelectorAll('.gil-serp-block').length, 0);
check('and no panel', off.getElementById('gil-serp-panel'), null);
check(
  'the results themselves are left alone',
  off.querySelectorAll('#rso .MjjYud').length,
  4
);

// ------------------------------------------- a domain match beats a name match

/* If another entry's name appears in the title of a result that sits on your
 * own domain, the domain has to win. Otherwise your own page gets filed as
 * somebody else's mention. */
const doc2 = (() => {
  const html =
    '<div class="MjjYud"><div class="g"><a href="https://www.gilmedia.com/about"><h3>Gilmedia and Acme Corp partnership</h3></a></div></div>';
  const dom = new JSDOM(
    `<!doctype html><body><div id="center_col"><div id="rso">${html}</div></div></body>`,
    { url: 'https://www.google.com/search?q=x', runScripts: 'outside-only' }
  );
  dom.window.chrome = {
    storage: {
      sync: {
        get: (d, cb) =>
          cb({
            ...d,
            targets: [
              { domain: '', name: 'Acme Corp' },
              { domain: 'gilmedia.com', name: 'Gilmedia' },
            ],
          }),
      },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(CONTENT);
  return dom.window.document;
})();

check('a result on your own domain stays a hit', doc2.querySelectorAll('.gil-serp-hit').length, 1);
check('and is never demoted to a mention', doc2.querySelectorAll('.gil-serp-mention').length, 0);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
