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
