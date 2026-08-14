/* The manager's line model. The thing worth protecting here is that editing a
 * row in the table does not flatten the comments out of someone's file.
 *
 * Run: node test/manager.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PARSE = fs.readFileSync(path.join(__dirname, '..', 'src', 'parse.js'), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'https://example.org',
  runScripts: 'outside-only',
});
dom.window.eval(
  PARSE +
    '\n;window.__parseLines = parseLines;' +
    'window.__serializeLines = serializeLines;' +
    'window.__duplicateKeys = duplicateKeys;' +
    'window.__dupeKeyFor = dupeKeyFor;' +
    'window.__parseDomains = parseDomains;'
);
const parseLines = dom.window.__parseLines;
const serializeLines = dom.window.__serializeLines;
const duplicateKeys = dom.window.__duplicateKeys;
const dupeKeyFor = dom.window.__dupeKeyFor;
const parseDomains = dom.window.__parseDomains;

// ------------------------------------------------------------ line model

const FILE = `# Active
walmart.com | Walmart
starbucks.com | Starbucks

# Parked, do not delete
# yelp.com | Yelp
homedepot.com | Home Depot
`;

const lines = parseLines(FILE);

check('entries and raw lines are both kept', lines.length, 7);
check(
  'three real entries',
  lines.filter((n) => n.type === 'entry').length,
  3
);
check(
  'comments stay raw rather than becoming entries',
  lines.filter((n) => n.type === 'raw' && n.raw.startsWith('#')).length,
  3
);

check('a round trip changes nothing', serializeLines(parseLines(FILE)), FILE);

check(
  'a second round trip is still stable',
  serializeLines(parseLines(serializeLines(parseLines(FILE)))),
  FILE
);

// ------------------------------------------------- editing through the table

const edited = parseLines(FILE);
edited.find((n) => n.type === 'entry' && n.domain === 'starbucks.com').name = 'Starbucks Canada';
const afterEdit = serializeLines(edited);

check(
  'editing a name keeps every comment',
  afterEdit.includes('# Parked, do not delete') && afterEdit.includes('# yelp.com | Yelp'),
  true
);
check('the edit landed', afterEdit.includes('starbucks.com | Starbucks Canada'), true);
check(
  'and the row stayed where it was',
  afterEdit.split('\n')[2],
  'starbucks.com | Starbucks Canada'
);

const removed = parseLines(FILE).filter(
  (n) => !(n.type === 'entry' && n.domain === 'walmart.com')
);
const afterRemove = serializeLines(removed);
check('removing a row drops only that row', parseDomains(afterRemove).targets.length, 2);
check('comments survive a removal too', afterRemove.includes('# Active'), true);

const added = parseLines(FILE);
added.push({ type: 'entry', id: 99, domain: 'costco.com', name: '' });
check(
  'a domain with no name serialises bare',
  serializeLines(added).trim().endsWith('costco.com'),
  true
);

check('an empty list serialises to an empty string', serializeLines([]), '');
check('parsing an empty string gives no lines', parseLines('').length, 0);

// ------------------------------------------------------------- duplicates

const dupes = duplicateKeys([
  { domain: 'walmart.com', name: 'Walmart' },
  { domain: 'walmart.com', name: 'Walmart Canada' },
  { domain: 'starbucks.com', name: 'Starbucks' },
  { domain: '', name: 'Home Depot' },
  { domain: '', name: 'home depot' },
]);

check('two rows for one domain count as duplicates', dupes.has('d:walmart.com'), true);
check('even when the business names differ', dupes.size, 2);
check('a single row is not flagged', dupes.has('d:starbucks.com'), false);
check('name-only rows dedupe case-insensitively', dupes.has('n:home depot'), true);
check(
  'the row key matches what duplicateKeys emits',
  dupeKeyFor({ domain: 'walmart.com', name: 'x' }),
  'd:walmart.com'
);
check('a blank row is never a duplicate', duplicateKeys([{ domain: '', name: '' }]).size, 0);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
