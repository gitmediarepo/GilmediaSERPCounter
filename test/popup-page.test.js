/* Smoke test for the popup. It runs the real popup.html against a stubbed
 * chrome.storage, which is what catches an id in the markup drifting away from
 * the id the script asks for.
 *
 * Run: node test/popup-page.test.js      (needs jsdom on NODE_PATH)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const HTML = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8');
const PARSE = fs.readFileSync(path.join(SRC, 'parse.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(SRC, 'popup.js'), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok)
    console.log(`      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
}

function boot(stored) {
  const dom = new JSDOM(HTML.replace(/<script src="[^"]*"><\/script>/g, ''), {
    url: 'chrome-extension://test/src/popup.html',
    runScripts: 'outside-only',
  });
  const win = dom.window;
  const saved = {};
  let optionsOpened = 0;

  win.chrome = {
    storage: {
      sync: {
        get: (defaults, cb) => cb({ ...defaults, ...stored }),
        set: (obj, cb) => {
          Object.assign(saved, obj);
          if (cb) cb();
        },
        remove: () => {},
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      openOptionsPage: () => optionsOpened++,
      getURL: (p) => p,
    },
  };

  win.eval(PARSE);
  win.eval(POPUP);
  return { win, doc: win.document, saved, opened: () => optionsOpened };
}

// -------------------------------------------------- an existing 1.8 list

const a = boot({ domainsText: 'walmart.com | Walmart\nstarbucks.com | Starbucks' });
check('the list lands in the textarea', a.doc.getElementById('domains').value.split('\n').length, 2);
check('the header counts domains, not clients', a.doc.getElementById('count').textContent, '2 domains');

a.doc.getElementById('save').dispatchEvent(new a.win.Event('click'));
check('save writes the parsed targets', a.saved.targets.length, 2);
check('and writes under the new key', typeof a.saved.domainsText, 'string');

check('one entry reads as singular', boot({ domainsText: 'walmart.com' }).doc.getElementById('count').textContent, '1 domain');

// ------------------------------------------------ a list from before 1.8

const b = boot({ clientsText: 'homedepot.com | Home Depot', targets: [{ domain: 'homedepot.com', name: 'Home Depot' }] });
check('a pre-1.8 list still loads', b.doc.getElementById('domains').value, 'homedepot.com | Home Depot');
check('and is migrated to the new key', b.saved.domainsText, 'homedepot.com | Home Depot');

// ------------------------------------------------------------- manager

const c = boot({ domainsText: '' });
c.doc.getElementById('manage').dispatchEvent(new c.win.Event('click'));
check('Manage opens the options page', c.opened(), 1);
check('an empty list shows no count', c.doc.getElementById('count').textContent, '');

// -------------------------------------------------------- master switch

const on = boot({ domainsText: 'walmart.com' });
check('the switch defaults to on', on.doc.getElementById('enabled').checked, true);
check('and says so', on.doc.getElementById('enabledState').textContent, 'on');

const sw = on.doc.getElementById('enabled');
sw.checked = false;
sw.dispatchEvent(new on.win.Event('change'));
check('switching off is written to storage', on.saved.enabled, false);
check('the label follows', on.doc.getElementById('enabledState').textContent, 'off');
check('and the popup dims', on.doc.body.classList.contains('off'), true);

sw.checked = true;
sw.dispatchEvent(new on.win.Event('change'));
check('switching back on is written too', on.saved.enabled, true);
check('and the dimming lifts', on.doc.body.classList.contains('off'), false);

const stored = boot({ domainsText: 'walmart.com', enabled: false });
check('a stored off state is restored', stored.doc.getElementById('enabled').checked, false);
check('and shown', stored.doc.getElementById('master').classList.contains('off'), true);

check(
  'mentions default to on',
  boot({ domainsText: 'x.com' }).doc.getElementById('showMentions').checked,
  true
);

// -------------------------------------------------------------- markup

check(
  'the credit links to gilmedia.com',
  /gilmedia\.com/.test(c.doc.querySelector('footer .credit').innerHTML),
  true
);
check(
  'the credit opens in a new tab safely',
  c.doc.querySelector('footer .credit a').getAttribute('rel'),
  'noopener noreferrer'
);
check('no stale "client" wording is left in the popup', /client/i.test(HTML), false);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
