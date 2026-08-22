/* Whose result is this, really?
 *
 * The bug this pins: matchTarget used to accept a result as YOURS if your
 * domain appeared anywhere in the result's URL as a plain substring. A
 * Trustpilot review at ca.trustpilot.com/review/yoursite.com therefore
 * reported as your own organic ranking - reported live for
 * "appliance repair city", where a Trustpilot page at position 11 was
 * counted as the client's own result.
 *
 * The rule now: a result is YOURS when the HOSTNAME is yours, including via a
 * redirect wrapper or Google's AMP viewer. Your domain sitting in somebody
 * else's path is a reference to you, which lands in the mentions block.
 *
 * Run: node test/url-matching.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

const DOMAIN = 'appliancepro.example';

/** One organic result, and how the extension classified it. */
function classify(href, title, targets, cite) {
  const html = `<!doctype html><body><div id="center_col"><div id="rso">
      <div class="MjjYud"><div class="g"><a href="${href}"><h3>${title}</h3></a>
      ${cite ? `<cite>${cite}</cite>` : ''}</div></div>
    </div></div></body>`;
  const dom = new JSDOM(html, {
    url: 'https://www.google.com/search?q=appliance+repair+city&start=10',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  dom.window.chrome = {
    storage: {
      sync: { get: (d, cb) => cb({ ...d, targets }) },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(SRC);
  const doc = dom.window.document;
  if (doc.querySelector('.gil-serp-badge--hit')) return 'hit';
  if (doc.querySelector('.gil-serp-badge--mention')) return 'mention';
  return 'none';
}

const BOTH = [{ domain: DOMAIN, name: 'Appliance Pro' }];
const DOMAIN_ONLY = [{ domain: DOMAIN, name: '' }];

// --------------------------------------------- the reported bug

check(
  'a Trustpilot review carrying your domain in its path is NOT your ranking',
  classify(
    `https://ca.trustpilot.com/review/${DOMAIN}`,
    'Appliance Pro in Halifax Reviews',
    BOTH,
    'https://ca.trustpilot.com &rsaquo; review &rsaquo; applianceproh...'
  ),
  'mention'
);
check(
  'and it is still a mention when no business name is configured',
  classify(`https://ca.trustpilot.com/review/${DOMAIN}`, 'Reviews', DOMAIN_ONLY),
  'mention'
);
check(
  'a Yelp profile with your domain in the query string is a mention',
  classify(`https://www.yelp.ca/biz/x?utm_source=${DOMAIN}`, 'Yelp listing', DOMAIN_ONLY),
  'mention'
);
check(
  'a whois lookup on your domain is a mention',
  classify(`https://who.is/whois/${DOMAIN}`, 'Whois record', DOMAIN_ONLY),
  'mention'
);

// ------------------------------------------ what must still be YOURS

check('your own site is your ranking', classify(`https://${DOMAIN}/services`, 'Services', BOTH), 'hit');
check(
  'a subdomain of yours is still yours',
  classify(`https://booking.${DOMAIN}/x`, 'Book now', BOTH),
  'hit'
);
check(
  'www is stripped, still yours',
  classify(`https://www.${DOMAIN}/`, 'Home', BOTH),
  'hit'
);
check(
  'a redirect wrapper pointing at your host is yours',
  classify(`https://l.example.net/redir?url=https%3A%2F%2F${DOMAIN}%2Fpage`, 'Redirected', DOMAIN_ONLY),
  'hit'
);
check(
  "Google's AMP viewer serving your page is yours",
  classify(
    `https://appliancepro-example.cdn.ampproject.org/c/s/${DOMAIN}/amp/page`,
    'AMP page',
    DOMAIN_ONLY
  ),
  'hit'
);
check(
  'a cite naming your host wins even when the href is wrapped',
  classify('https://redirect.example/aHR0cHM6Ly94', 'Wrapped', DOMAIN_ONLY, `https://${DOMAIN} &rsaquo; page`),
  'hit'
);

// ----------------------------------------------- and what is neither

check(
  'an unrelated competitor is neither',
  classify('https://someoneelse.example/appliance-repair', 'Another repair shop', BOTH),
  'none'
);
check(
  'a lookalike domain is not yours',
  classify('https://notappliancepro.example.evil.example/x', 'Lookalike', DOMAIN_ONLY),
  'mention'
);

/* The name still carries the local pack, where Google prints no URL at all. */
check(
  'a name match in organic remains a mention, not a ranking',
  classify('https://linkedin.com/company/x', 'Appliance Pro | LinkedIn', BOTH),
  'mention'
);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
