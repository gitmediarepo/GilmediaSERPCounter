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
  showAi: true,
  showPanel: true,
  showPaginationTop: true,
  debug: false,
  remoteUrl: '',
  remoteAuto: true,
  remoteUser: '',
  remotePass: '',
};

const TOGGLES = [
  'showOrganic',
  'showAds',
  'showLocal',
  'showLsa',
  'showAi',
  'showMentions',
  'showPaginationTop',
  'showPanel',
];

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

/* The version badge follows the manifest, so a release bump cannot leave a
 * stale number in the header (it already happened once). */
if (chrome.runtime && chrome.runtime.getManifest) {
  const verEl = document.querySelector('.ver');
  if (verEl) verEl.textContent = 'v' + chrome.runtime.getManifest().version;
}

function setStatus(msg, kind) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.className = `status${kind ? ' ' + kind : ''}`;
}

function save() {
  const domainsEl = $('domains');
  if (!domainsEl) return;
  const text = domainsEl.value;
  const { targets, skipped } = parseDomains(text);

  chrome.storage.sync.set({ targets, domainsText: text }, () => {
    if (chrome.runtime.lastError) {
      // sync storage caps at ~100KB total and 8KB per item.
      setStatus('too long for sync storage, trim the list', 'bad');
      return;
    }
    const countEl = $('count');
    if (countEl) countEl.textContent = plural(targets.length);
    setStatus(
      skipped.length ? `saved, ${skipped.length} line(s) skipped` : 'saved',
      skipped.length ? 'bad' : 'ok'
    );
    setTimeout(() => setStatus(''), 2600);
  });
}

const master = $('enabled');
const paintMaster = () => {
  if (!master) return;
  const masterEl = $('master');
  if (masterEl) masterEl.classList.toggle('off', !master.checked);
  document.body.classList.toggle('off', !master.checked);
  const stateEl = $('enabledState');
  if (stateEl) stateEl.textContent = master.checked ? 'on' : 'off';
};

/* Attach all event listeners immediately so buttons work right away. */
for (const key of TOGGLES) {
  const el = $(key);
  if (el) el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.checked }));
}
const dbg = $('debug');
if (dbg) dbg.addEventListener('change', () => chrome.storage.sync.set({ debug: dbg.checked }));

if (master) {
  master.addEventListener('change', () => {
    paintMaster();
    chrome.storage.sync.set({ enabled: master.checked });
  });
}

const saveBtn = $('save');
if (saveBtn) saveBtn.addEventListener('click', save);

const manageBtn = $('manage');
if (manageBtn) {
  manageBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL('src/options.html'));
  });
}

/* Listen for manager page edits without waiting for storage load. */
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

/* Load and populate UI with data. Popup shows immediately, fills in as data loads.
 * The spinner is a courtesy, not a gate: if storage is ever unusually slow or
 * errors out, stop showing it rather than spin forever over an empty list. */
const loadingTimeout = setTimeout(() => {
  const el = $('loading');
  if (el) el.hidden = true;
}, 4000);

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  clearTimeout(loadingTimeout);
  // Fall back through the old key, then the parsed list, so nobody's list
  // disappears on update.
  const text =
    cfg.domainsText ||
    cfg.clientsText ||
    (cfg.targets || [])
      .map((t) => (t.name ? `${t.domain} | ${t.name}` : t.domain))
      .join('\n');

  const domainsEl = $('domains');
  if (domainsEl) {
    domainsEl.value = text;
    domainsEl.placeholder = 'Add domains and business names here...';
    // Count what is actually in the box.
    const n = parseDomains(text).targets.length;
    const countEl = $('count');
    if (countEl) countEl.textContent = n ? plural(n) : '';
  }

  // Write the list back under the new key once, and retire the old one.
  if (!cfg.domainsText && text) {
    chrome.storage.sync.set({ domainsText: text }, () => chrome.storage.sync.remove('clientsText'));
  }

  // Set all toggles to their saved state.
  for (const key of TOGGLES) {
    const el = $(key);
    if (el) el.checked = cfg[key] !== false;
  }
  if (dbg) dbg.checked = cfg.debug === true;
  if (master) master.checked = cfg.enabled !== false;
  paintMaster();

  const loadingEl = $('loading');
  if (loadingEl) loadingEl.hidden = true;

  /* Remote list: if a shared file URL is set (options page) with auto-refresh
   * on, quietly re-pull it when the local copy is over 12 hours old. The
   * pipeline (fetch, validate, back up, replace) is applyRemoteList in
   * parse.js, the same code the manager's Sync now runs. The storage.onChanged
   * listener above repaints the textarea when the new list lands. */
  if (cfg.remoteUrl && cfg.remoteAuto !== false) {
    remoteLocalStore().get({ remoteLastFetch: 0 }, (l) => {
      if (Date.now() - (l.remoteLastFetch || 0) <= REMOTE_STALE_MS) return;
      const auth = cfg.remoteUser ? { user: cfg.remoteUser, pass: cfg.remotePass || '' } : null;
      applyRemoteList(cfg.remoteUrl, auth)
        .then(() => {
          setStatus('list refreshed from shared file', 'ok');
          setTimeout(() => setStatus(''), 3000);
        })
        .catch(() => {
          /* Quiet by design: a laptop that is offline should not nag on every
           * popup open. Manual Sync now in the manager reports errors fully. */
        });
    });
  }
});

// ------------------------------------------------------------ export

const exportBtn = $('export');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const domainsEl = $('domains');
    if (!domainsEl) return;
    const text = domainsEl.value.trim();
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
}

// ------------------------------------------------------------ import

function ingest(text, source) {
  const domainsEl = $('domains');
  if (!domainsEl) return;
  const { text: merged, added } = mergeText(domainsEl.value, text);
  if (!added) {
    setStatus(`${source}: nothing new`, 'bad');
    setTimeout(() => setStatus(''), 2600);
    return;
  }
  domainsEl.value = merged;
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

const importBtn = $('import');
const fileInput = $('file');
if (importBtn) {
  importBtn.addEventListener('click', () => {
    if (fileInput) fileInput.click();
  });
}
if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    readFile(e.target.files && e.target.files[0]);
    e.target.value = ''; // let the same file be picked again
  });
}

/* Drag and drop straight onto the box. This is the reliable import path: on
 * some Chrome builds the file picker closes the popup before the change event
 * fires, and a drop never does. */
const box = $('domains');
if (box) {
  ['dragenter', 'dragover'].forEach((ev) => {
    box.addEventListener(ev, (e) => {
      e.preventDefault();
      box.classList.add('drop');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    box.addEventListener(ev, (e) => {
      e.preventDefault();
      box.classList.remove('drop');
    });
  });
  box.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) readFile(dt.files[0]);
    else {
      const text = dt.getData('text');
      if (text) ingest(text, 'dropped');
    }
  });
}

/* Clear needs two clicks. Wiping a sixty-domain list on a stray click, with
 * nothing to undo it, is not a thing that should be one click away. */
let armed = null;
const clearBtn = $('clear');
/* The label lives in its own span so rewording it never wipes the icon. */
const setClearLabel = (text) => {
  const lbl = $('clearLabel');
  if (lbl) lbl.textContent = text;
  else if (clearBtn) clearBtn.textContent = text;
};
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (!armed) {
      clearBtn.classList.add('armed');
      setClearLabel('Clear? click again');
      setStatus('this wipes the whole list', 'bad');
      armed = setTimeout(() => {
        armed = null;
        clearBtn.classList.remove('armed');
        setClearLabel('Clear');
        setStatus('');
      }, 4000);
      return;
    }

    clearTimeout(armed);
    armed = null;
    clearBtn.classList.remove('armed');
    setClearLabel('Clear');

    chrome.storage.sync.set({ targets: [], domainsText: '' }, () => {
      const domainsEl = $('domains');
      if (domainsEl) domainsEl.value = '';
      const countEl = $('count');
      if (countEl) countEl.textContent = '';
      setStatus('list cleared', 'ok');
      setTimeout(() => setStatus(''), 2600);
    });
  });
}

const exampleBtn = $('example');
if (exampleBtn) {
  exampleBtn.addEventListener('click', () => {
    const domainsEl = $('domains');
    if (!domainsEl) return;
    const cur = domainsEl.value.trim();
    domainsEl.value = cur ? `${cur}\n${EXAMPLE}` : EXAMPLE;
    save();
  });
}

// Ctrl+Enter saves without reaching for the mouse.
const domainsForKeydown = $('domains');
if (domainsForKeydown) {
  domainsForKeydown.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
  });
  // Leaving the field saves too, so an edit is never silently lost.
  domainsForKeydown.addEventListener('blur', save);
}
