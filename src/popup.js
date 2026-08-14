/* Popup: the whole domain list lives in one textarea.
 *
 * The raw text is stored alongside the parsed list so formatting, comments and
 * column alignment survive a round trip. For anything bigger than a quick edit
 * there is the manager, a full page with search, inline rows and a duplicate
 * check. This stays the fast path.
 *
 * Parsing lives in parse.js, shared with the manager.
 */

const DEFAULTS = {
  targets: [],
  domainsText: '',
  enabled: true,
  showMentions: true,
  clientsText: '', // pre-1.8 key, read once and migrated
  showOrganic: true,
  showAds: true,
  showLocal: true,
  showLsa: true,
  showPanel: true,
  debug: false,
};

const TOGGLES = ['showOrganic', 'showAds', 'showLocal', 'showLsa', 'showMentions', 'showPanel'];

/* Well-known public brands, never anyone's real list. */
const EXAMPLE = `walmart.com | Walmart
starbucks.com | Starbucks
timhortons.com | Tim Hortons

# The business name is optional.
# A domain on its own matches organic results and Ads:
yelp.com

# A name on its own matches the local pack, LSA and Maps:
Home Depot`;

const $ = (id) => document.getElementById(id);

const plural = (n) => `${n} domain${n === 1 ? '' : 's'}`;

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status${kind ? ' ' + kind : ''}`;
}

function save() {
  const text = $('domains').value;
  const { targets, skipped } = parseDomains(text);

  chrome.storage.sync.set({ targets, domainsText: text }, () => {
    if (chrome.runtime.lastError) {
      // sync storage caps at ~100KB total and 8KB per item.
      setStatus('too long for sync storage, trim the list', 'bad');
      return;
    }
    $('count').textContent = plural(targets.length);
    setStatus(
      skipped.length ? `saved, ${skipped.length} line(s) skipped` : 'saved',
      skipped.length ? 'bad' : 'ok'
    );
    setTimeout(() => setStatus(''), 2600);
  });
}

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  // Fall back through the old key, then the parsed list, so nobody's list
  // disappears on update.
  const text =
    cfg.domainsText ||
    cfg.clientsText ||
    (cfg.targets || [])
      .map((t) => (t.name ? `${t.domain} | ${t.name}` : t.domain))
      .join('\n');

  $('domains').value = text;
  // Count what is actually in the box. Deriving it from cfg.targets would show
  // a stale number if the two ever drifted apart.
  const n = parseDomains(text).targets.length;
  $('count').textContent = n ? plural(n) : '';

  // Write the list back under the new key once, and retire the old one.
  if (!cfg.domainsText && text) {
    chrome.storage.sync.set({ domainsText: text }, () => chrome.storage.sync.remove('clientsText'));
  }

  for (const key of TOGGLES) {
    const el = $(key);
    el.checked = cfg[key] !== false;
    el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.checked }));
  }
  const dbg = $('debug');
  dbg.checked = cfg.debug === true;
  dbg.addEventListener('change', () => chrome.storage.sync.set({ debug: dbg.checked }));

  /* Master switch. Off means the content script leaves Google's page alone
   * entirely, which is the point: one click when someone is looking over your
   * shoulder, not a settings hunt. */
  const master = $('enabled');
  const paintMaster = () => {
    $('master').classList.toggle('off', !master.checked);
    document.body.classList.toggle('off', !master.checked);
    $('enabledState').textContent = master.checked ? 'on' : 'off';
  };
  master.checked = cfg.enabled !== false;
  paintMaster();
  master.addEventListener('change', () => {
    paintMaster();
    chrome.storage.sync.set({ enabled: master.checked });
  });
});

/* The manager writes to the same keys. Pick its changes up rather than showing
 * a stale textarea over the top of them. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.domainsText && document.activeElement !== $('domains')) {
    $('domains').value = changes.domainsText.newValue || '';
  }
  if (changes.targets) {
    const n = (changes.targets.newValue || []).length;
    $('count').textContent = n ? plural(n) : '';
  }
});

$('save').addEventListener('click', save);

$('manage').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL('src/options.html'));
});

// ------------------------------------------------------------ export

$('export').addEventListener('click', () => {
  const text = $('domains').value.trim();
  if (!text) {
    setStatus('nothing to export', 'bad');
    return;
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `serp-counter-domains-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the blob is torn down.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  setStatus('exported', 'ok');
  setTimeout(() => setStatus(''), 2600);
});

// ------------------------------------------------------------ import

function ingest(text, source) {
  const { text: merged, added } = mergeText($('domains').value, text);
  if (!added) {
    setStatus(`${source}: nothing new`, 'bad');
    setTimeout(() => setStatus(''), 2600);
    return;
  }
  $('domains').value = merged;
  save();
  setStatus(`${source}: ${added} added`, 'ok');
  setTimeout(() => setStatus(''), 3000);
}

function readFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => ingest(String(reader.result || ''), 'imported');
  reader.onerror = () => setStatus('could not read that file', 'bad');
  reader.readAsText(file);
}

$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => {
  readFile(e.target.files && e.target.files[0]);
  e.target.value = ''; // let the same file be picked again
});

/* Drag and drop straight onto the box. This is the reliable import path: on
 * some Chrome builds the file picker closes the popup before the change event
 * fires, and a drop never does. */
const box = $('domains');
['dragenter', 'dragover'].forEach((ev) =>
  box.addEventListener(ev, (e) => {
    e.preventDefault();
    box.classList.add('drop');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  box.addEventListener(ev, (e) => {
    e.preventDefault();
    box.classList.remove('drop');
  })
);
box.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  if (dt.files && dt.files.length) readFile(dt.files[0]);
  else {
    const text = dt.getData('text');
    if (text) ingest(text, 'dropped');
  }
});

/* Clear needs two clicks. Wiping a sixty-domain list on a stray click, with
 * nothing to undo it, is not a thing that should be one click away. */
let armed = null;
$('clear').addEventListener('click', () => {
  const btn = $('clear');
  if (!armed) {
    btn.classList.add('armed');
    btn.textContent = 'Clear? click again';
    setStatus('this wipes the whole list', 'bad');
    armed = setTimeout(() => {
      armed = null;
      btn.classList.remove('armed');
      btn.textContent = 'Clear';
      setStatus('');
    }, 4000);
    return;
  }

  clearTimeout(armed);
  armed = null;
  btn.classList.remove('armed');
  btn.textContent = 'Clear';

  chrome.storage.sync.set({ targets: [], domainsText: '' }, () => {
    $('domains').value = '';
    $('count').textContent = '';
    setStatus('list cleared', 'ok');
    setTimeout(() => setStatus(''), 2600);
  });
});

$('example').addEventListener('click', () => {
  const cur = $('domains').value.trim();
  $('domains').value = cur ? `${cur}\n${EXAMPLE}` : EXAMPLE;
  save();
});

// Ctrl+Enter saves without reaching for the mouse.
$('domains').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
});

// Leaving the field saves too, so an edit is never silently lost.
$('domains').addEventListener('blur', save);
