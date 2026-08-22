/* AI Overview and AI Mode citations, plus the summary panel's auto-collapse.
 *
 * Google has published no markup for either AI surface and both change more
 * often than the rest of the page, so detection is best-effort with three
 * fallbacks. These fixtures pin the shapes that have actually bitten:
 *
 *   - several citations inside ONE prose paragraph with no per-link wrapper,
 *     which used to collapse into a single numbered row
 *   - a dedicated AI Mode page (?udm=50), where the results root IS the module
 *   - the same source cited twice in one answer, which is one citation
 *
 * Run: node test/ai-surface.test.js      (needs jsdom on NODE_PATH)
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

const TARGETS = [{ domain: 'target.com', name: 'Target' }];

function boot(html, url, extra = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  dom.window.chrome = {
    storage: {
      sync: { get: (d, cb) => cb({ ...d, targets: TARGETS, ...extra }) },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = dom.window;
  dom.window.eval(SRC);
  return dom.window.document;
}

const nums = (doc, kind) =>
  [...doc.querySelectorAll(`.gil-serp-badge--${kind}`)].map((b) => b.firstChild.textContent);
const bodyHidden = (doc) =>
  doc.querySelector('#gil-serp-panel .gil-serp-body').hasAttribute('hidden');

// ------------------------------------------------ panel auto-collapse

/* A search that turns up none of your domains should not sit there open. The
 * moment one does turn up, it opens itself again. */
const noMatch = boot(
  `<!doctype html><body><div id="center_col"><div id="rso">
     <div class="MjjYud"><div class="g"><a href="https://unrelated.com/x"><h3>U</h3></a></div></div>
   </div></div></body>`,
  'https://www.google.com/search?q=nothing+of+ours'
);
check('a search with no match collapses the panel', bodyHidden(noMatch), true);

const withMatch = boot(
  `<!doctype html><body><div id="center_col"><div id="rso">
     <div class="MjjYud"><div class="g"><a href="https://target.com/x"><h3>T</h3></a></div></div>
   </div></div></body>`,
  'https://www.google.com/search?q=ours'
);
check('a search with a match leaves it open', bodyHidden(withMatch), false);

// --------------------------------------------------- AI Overview block

/* Both citations live in one paragraph with no wrapper of their own. closest()
 * walks up to the module for both, which is exactly what used to number only
 * the first and drop the second. */
const ai = boot(
  `<!doctype html><body><div id="center_col">
     <div data-hveid="ai1"><h2>AI Overview</h2>
       <div>Summary text <a href="https://target.com/cited">source one</a>
         and <a href="https://other.com/">source two</a></div>
     </div>
     <div id="rso">
       <div class="MjjYud"><div class="g"><a href="https://s1.com/x"><h3>R1</h3></a></div></div>
     </div>
   </div></body>`,
  'https://www.google.com/search?q=ai+overview'
);
check('every AI citation is numbered, not just the first', nums(ai, 'ai'), ['1', '2']);
check(
  'AI badges carry the AI tag',
  [...ai.querySelectorAll('.gil-serp-badge--ai .gil-serp-tag')].map((t) => t.textContent),
  ['AI', 'AI']
);
check('the tracked domain is marked as a hit', ai.querySelectorAll('.gil-serp-badge--ai.gil-serp-badge--hit').length, 1);
check('the panel chip carries the AI colour', ai.querySelectorAll('#gil-serp-panel .gil-serp-pos--ai').length, 1);
check('organic below the AI block still numbers', nums(ai, 'organic'), ['1']);

/* One source cited twice in the same answer is one citation. */
const dupe = boot(
  `<!doctype html><body><div id="center_col">
     <div data-hveid="ai1"><h2>AI Overview</h2>
       <div>a <a href="https://target.com/p">x</a> b <a href="https://target.com/p#again">x</a></div>
     </div><div id="rso"></div></div></body>`,
  'https://www.google.com/search?q=dupe'
);
check('the same source cited twice counts once', dupe.querySelectorAll('.gil-serp-badge--ai').length, 1);

// ------------------------------------------------------- AI Mode page

/* ?udm=50 is AI top to bottom, so the results root is the module. isSaneModule
 * rejects #rso by name - a guard meant for the local pack walk - so this path
 * deliberately skips it. */
const aiMode = boot(
  `<!doctype html><body><div id="center_col"><div id="rso">
     <div><a href="https://target.com/z">cite</a></div>
     <div><a href="https://other.com/z">cite two</a></div>
   </div></div></body>`,
  'https://www.google.com/search?q=x&udm=50'
);
check('a dedicated AI Mode page numbers its citations', nums(aiMode, 'ai'), ['1', '2']);
check('and finds the tracked domain there', aiMode.querySelectorAll('.gil-serp-badge--ai.gil-serp-badge--hit').length, 1);

// ------------------------------------------------------------ off / absent

const off = boot(
  `<!doctype html><body><div id="center_col">
     <div data-hveid="ai1"><h2>AI Overview</h2><div><a href="https://target.com/c">s</a></div></div>
     <div id="rso"></div></div></body>`,
  'https://www.google.com/search?q=off',
  { showAi: false }
);
check('with the AI toggle off nothing is numbered as AI', off.querySelectorAll('.gil-serp-badge--ai').length, 0);

/* No AI block on the page must mean no AI rows, not a guess. */
const plain = boot(
  `<!doctype html><body><div id="center_col"><div id="rso">
     <div class="MjjYud"><div class="g"><a href="https://target.com/x"><h3>T</h3></a></div></div>
   </div></div></body>`,
  'https://www.google.com/search?q=plain'
);
check('an ordinary SERP invents no AI rows', plain.querySelectorAll('.gil-serp-badge--ai').length, 0);
check('and its organic result is untouched', nums(plain, 'organic'), ['1']);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
