/* Smoke test for the manager page. It drives the real options.html against a
 * stubbed chrome.storage, so a typo in a getElementById shows up here rather
 * than in someone's browser.
 *
 * Run: node test/options-page.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const HTML = fs.readFileSync(path.join(SRC, 'options.html'), 'utf8');
const PARSE = fs.readFileSync(path.join(SRC, 'parse.js'), 'utf8');
const OPTIONS = fs.readFileSync(path.join(SRC, 'options.js'), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

const SEED = `# Active
walmart.com | Walmart
starbucks.com | Starbucks
walmart.com | Walmart Canada
homedepot.com | Home Depot
`;

const stored = { targets: [], domainsText: SEED, clientsText: '' };

// Strip the <script src> tags; the sources are evaluated by hand below.
const dom = new JSDOM(HTML.replace(/<script src="[^"]*"><\/script>/g, ''), {
  url: 'chrome-extension://test/src/options.html',
  runScripts: 'outside-only',
});
const win = dom.window;
const doc = win.document;

win.chrome = {
  storage: {
    sync: {
      get: (defaults, cb) => cb({ ...defaults, ...stored }),
      set: (obj, cb) => {
        Object.assign(stored, obj);
        if (cb) cb();
      },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: {},
};

win.eval(PARSE);
win.eval(OPTIONS);

const $ = (id) => doc.getElementById(id);
const rows = () => [...doc.querySelectorAll('#rows .row')];
const domainInputs = () => rows().map((r) => r.querySelector('input.dom').value);

// ---------------------------------------------------------------- render

check('every entry gets a row', rows().length, 4);
check('the header counts them', $('total').textContent, '4');
check('comments are not rendered as rows', domainInputs().includes(''), false);

// ---------------------------------------------------------------- dupes

check('duplicate rows are flagged', doc.querySelectorAll('#rows .row.dupe').length, 2);
check('and the count is surfaced', $('dupeStat').textContent, '2 duplicate rows');
check('the badge is visible when there are duplicates', $('dupeStat').hidden, false);

$('dupeOnly').dispatchEvent(new win.Event('click'));
check('the duplicates filter narrows to just those rows', rows().length, 2);
check('and every remaining row is a duplicate', doc.querySelectorAll('#rows .row.dupe').length, 2);
$('dupeOnly').dispatchEvent(new win.Event('click'));
check('toggling it back restores the full list', rows().length, 4);

// --------------------------------------------------------------- search

$('search').value = 'star';
$('search').dispatchEvent(new win.Event('input'));
check('search filters by domain', domainInputs(), ['starbucks.com']);
check('and reports what is hidden', $('shown').textContent, 'showing 1 of 4');

$('search').value = 'Home Depot';
$('search').dispatchEvent(new win.Event('input'));
check('search also matches the business name', domainInputs(), ['homedepot.com']);

$('search').value = 'nothing here';
$('search').dispatchEvent(new win.Event('input'));
check('no matches shows the empty state', doc.querySelectorAll('#rows .empty').length, 1);

$('search').value = '';
$('search').dispatchEvent(new win.Event('input'));
check('clearing search brings them all back', rows().length, 4);

// ----------------------------------------------------------------- sort

$('sort').value = 'domain';
$('sort').dispatchEvent(new win.Event('change'));
check('sorting by domain reorders the view', domainInputs(), [
  'homedepot.com',
  'starbucks.com',
  'walmart.com',
  'walmart.com',
]);
$('sort').value = 'file';
$('sort').dispatchEvent(new win.Event('change'));
check('file order is the original order', domainInputs(), [
  'walmart.com',
  'starbucks.com',
  'walmart.com',
  'homedepot.com',
]);

// ----------------------------------------------------------- editing

const nameInput = rows()[1].querySelector('input:not(.dom)');
nameInput.value = 'Starbucks Canada';
nameInput.dispatchEvent(new win.Event('change'));
check('an edit reaches the textarea', $('text').value.includes('starbucks.com | Starbucks Canada'), true);
check('and the comment line is still there', $('text').value.includes('# Active'), true);

rows()[0].querySelector('button.danger').dispatchEvent(new win.Event('click'));
check('remove drops one row', rows().length, 3);
check('the removed domain is gone from the text', $('text').value.includes('walmart.com | Walmart\n'), false);
check('the other walmart row survived', $('text').value.includes('walmart.com | Walmart Canada'), true);
check('and the comment survived the removal', $('text').value.includes('# Active'), true);

$('add').dispatchEvent(new win.Event('click'));
check('add appends a blank row', rows().length, 4);
check('the new row is empty and focused last', domainInputs()[3], '');

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
