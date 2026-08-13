/* Popup: the whole client list lives in one textarea.
 *
 * The raw text is stored alongside the parsed list so formatting, comments and
 * column alignment survive a round trip. Editing a hundred clients as text beats
 * clicking through a hundred rows.
 */

const DEFAULTS = {
  targets: [],
  clientsText: '',
  showOrganic: true,
  showAds: true,
  showLocal: true,
  showLsa: true,
  showPanel: true,
  debug: false,
};

const TOGGLES = ['showOrganic', 'showAds', 'showLocal', 'showLsa', 'showPanel'];

/* Well-known public brands, never a real client list. */
const EXAMPLE = `walmart.com | Walmart
starbucks.com | Starbucks
timhortons.com | Tim Hortons

# The business name is optional.
# A domain on its own matches organic results and Ads:
yelp.com

# A name on its own matches the local pack, LSA and Maps:
Home Depot`;

const $ = (id) => document.getElementById(id);

function cleanDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www|m|amp|mobile)\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0];
}

const looksLikeDomain = (s) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(cleanDomain(s));

/** One line in, one client out. Returns { targets, skipped }. */
function parseClients(text) {
  const targets = [];
  const skipped = [];
  const seen = new Set();

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // Pipe, comma or tab, so a spreadsheet paste works untouched.
    const parts = line
      .split(/\s*[|,\t]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    let domain = '';
    let name = '';

    if (parts.length >= 2) {
      // Accept the columns in either order rather than being fussy about it.
      if (looksLikeDomain(parts[0])) {
        domain = parts[0];
        name = parts.slice(1).join(' ');
      } else if (looksLikeDomain(parts[1])) {
        domain = parts[1];
        name = parts[0];
      } else {
        name = parts.join(' ');
      }
    } else if (looksLikeDomain(parts[0])) {
      domain = parts[0];
    } else {
      name = parts[0];
    }

    domain = domain ? cleanDomain(domain) : '';
    name = (name || '').trim();
    if (!domain && !name) {
      skipped.push(line);
      continue;
    }

    const key = `${domain}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ domain, name });
  }

  return { targets, skipped };
}

/* Merge without clobbering. Only lines whose client is not already in the list
 * get appended, so importing the same file twice is a no-op and importing a
 * partial list never destroys what is already there. */
function mergeText(existing, incoming) {
  const have = new Set(parseClients(existing).targets.map((t) => `${t.domain}|${t.name.toLowerCase()}`));
  const fresh = [];

  for (const raw of String(incoming || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = parseClients(line).targets[0];
    if (!parsed) continue;
    const key = `${parsed.domain}|${parsed.name.toLowerCase()}`;
    if (have.has(key)) continue;
    have.add(key);
    fresh.push(line);
  }

  if (!fresh.length) return { text: existing, added: 0 };
  const base = existing.trim();
  return { text: (base ? base + '\n' : '') + fresh.join('\n') + '\n', added: fresh.length };
}

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status${kind ? ' ' + kind : ''}`;
}

function save() {
  const text = $('clients').value;
  const { targets, skipped } = parseClients(text);

  chrome.storage.sync.set({ targets, clientsText: text }, () => {
    if (chrome.runtime.lastError) {
      // sync storage caps at ~100KB total and 8KB per item.
      setStatus('too long for sync storage, trim the list', 'bad');
      return;
    }
    $('count').textContent = `${targets.length} client${targets.length === 1 ? '' : 's'}`;
    setStatus(
      skipped.length ? `saved, ${skipped.length} line(s) skipped` : 'saved',
      skipped.length ? 'bad' : 'ok'
    );
    setTimeout(() => setStatus(''), 2600);
  });
}

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  // Rebuild the text from the parsed list if this profile predates clientsText.
  const text =
    cfg.clientsText ||
    (cfg.targets || [])
      .map((t) => (t.name ? `${t.domain} | ${t.name}` : t.domain))
      .join('\n');

  $('clients').value = text;
  const n = (cfg.targets || []).length;
  $('count').textContent = n ? `${n} client${n === 1 ? '' : 's'}` : '';

  for (const key of TOGGLES) {
    const el = $(key);
    el.checked = cfg[key] !== false;
    el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.checked }));
  }
  const dbg = $('debug');
  dbg.checked = cfg.debug === true;
  dbg.addEventListener('change', () => chrome.storage.sync.set({ debug: dbg.checked }));
});

$('save').addEventListener('click', save);

// ------------------------------------------------------------ export

$('export').addEventListener('click', () => {
  const text = $('clients').value.trim();
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
  a.download = `serp-counter-clients-${stamp}.txt`;
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
  const { text: merged, added } = mergeText($('clients').value, text);
  if (!added) {
    setStatus(`${source}: nothing new`, 'bad');
    setTimeout(() => setStatus(''), 2600);
    return;
  }
  $('clients').value = merged;
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
const box = $('clients');
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

/* Clear needs two clicks. Wiping a sixty-client roster on a stray click, with
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
      btn.textContent = 'Clear list';
      setStatus('');
    }, 4000);
    return;
  }

  clearTimeout(armed);
  armed = null;
  btn.classList.remove('armed');
  btn.textContent = 'Clear list';

  chrome.storage.sync.set({ targets: [], clientsText: '' }, () => {
    $('clients').value = '';
    $('count').textContent = '';
    setStatus('list cleared', 'ok');
    setTimeout(() => setStatus(''), 2600);
  });
});

$('example').addEventListener('click', () => {
  const cur = $('clients').value.trim();
  $('clients').value = cur ? `${cur}\n${EXAMPLE}` : EXAMPLE;
  save();
});

// Ctrl+Enter saves without reaching for the mouse.
$('clients').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
});

// Leaving the field saves too, so an edit is never silently lost.
$('clients').addEventListener('blur', save);
