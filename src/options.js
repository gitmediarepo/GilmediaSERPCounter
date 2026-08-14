/* The manager: one row per domain, searchable, with a duplicate check.
 *
 * The stored text stays the source of truth. Rows are a view over it, built by
 * parseLines and written back by serializeLines, so comment lines and ordering
 * survive an edit made here rather than in the textarea.
 *
 * Everything autosaves. There is no Save button because there is no state worth
 * losing to a closed tab.
 */

const $ = (id) => document.getElementById(id);

let lines = []; // parseLines model, the whole file
let filter = '';
let sortBy = 'file';
let dupesOnly = false;
let saveTimer = null;

const entriesOf = () => lines.filter((n) => n.type === 'entry');

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status${kind ? ' ' + kind : ''}`;
  if (msg) setTimeout(() => (el.textContent === msg ? setStatus('') : null), 2400);
}

// ---------------------------------------------------------------- storage

function commit(msg) {
  const text = serializeLines(lines);
  const { targets } = parseDomains(text);

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.sync.set({ targets, domainsText: text }, () => {
      if (chrome.runtime.lastError) {
        setStatus('too long for sync storage', 'bad');
        return;
      }
      setStatus(msg || 'saved', 'ok');
    });
  }, 250);

  $('total').textContent = String(targets.length);
  $('text').value = text;
}

function load() {
  chrome.storage.sync.get({ targets: [], domainsText: '', clientsText: '' }, (cfg) => {
    const text =
      cfg.domainsText ||
      cfg.clientsText ||
      (cfg.targets || []).map((t) => (t.name ? `${t.domain} | ${t.name}` : t.domain)).join('\n');

    lines = parseLines(text);
    $('text').value = text;
    render();
  });
}

/* The popup edits the same keys. Take its changes unless a field here has focus,
 * which would yank the cursor mid-edit. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.domainsText) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  lines = parseLines(changes.domainsText.newValue || '');
  $('text').value = changes.domainsText.newValue || '';
  render();
});

// ------------------------------------------------------------------ render

function visibleEntries() {
  let list = entriesOf();
  const dupes = duplicateKeys(list);

  if (dupesOnly) list = list.filter((e) => dupes.has(dupeKeyFor(e)));

  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(
      (e) => e.domain.toLowerCase().includes(q) || (e.name || '').toLowerCase().includes(q)
    );
  }

  if (sortBy === 'domain') {
    list = list.slice().sort((a, b) => a.domain.localeCompare(b.domain));
  } else if (sortBy === 'name') {
    list = list
      .slice()
      .sort((a, b) => (a.name || '~').localeCompare(b.name || '~') || a.domain.localeCompare(b.domain));
  }

  return { list, dupes };
}

function render() {
  const all = entriesOf();
  const { list, dupes } = visibleEntries();
  const host = $('rows');

  $('total').textContent = String(all.length);

  const dupeCount = all.filter((e) => dupes.has(dupeKeyFor(e))).length;
  const stat = $('dupeStat');
  stat.hidden = dupeCount === 0;
  stat.textContent = `${dupeCount} duplicate row${dupeCount === 1 ? '' : 's'}`;

  $('shown').textContent =
    list.length === all.length ? '' : `showing ${list.length} of ${all.length}`;

  host.textContent = '';

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = all.length
      ? 'Nothing matches that filter.'
      : 'No domains yet. Click Add domain, or Import a list.';
    host.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  list.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    if (dupes.has(dupeKeyFor(entry))) row.classList.add('dupe');
    if (entry.domain && !looksLikeDomain(entry.domain)) row.classList.add('bad');

    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(i + 1);

    const dom = document.createElement('input');
    dom.type = 'text';
    dom.className = 'dom';
    dom.value = entry.domain;
    dom.placeholder = 'example.com';
    dom.spellcheck = false;
    dom.addEventListener('change', () => {
      entry.domain = cleanDomain(dom.value);
      dom.value = entry.domain;
      commit();
      render();
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.value = entry.name || '';
    name.placeholder = 'Business name (optional)';
    name.addEventListener('change', () => {
      entry.name = name.value.trim();
      commit();
    });

    const acts = document.createElement('div');
    acts.className = 'acts';

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Remove';
    del.title = 'Remove this row';
    del.addEventListener('click', () => {
      lines = lines.filter((node) => node !== entry);
      commit('removed');
      render();
    });

    acts.appendChild(del);
    row.append(n, dom, name, acts);
    frag.appendChild(row);
  });

  host.appendChild(frag);
}

// ------------------------------------------------------------------ actions

$('search').addEventListener('input', (e) => {
  filter = e.target.value.trim();
  render();
});

$('sort').addEventListener('change', (e) => {
  sortBy = e.target.value;
  render();
});

$('dupeOnly').addEventListener('click', () => {
  dupesOnly = !dupesOnly;
  $('dupeOnly').classList.toggle('on', dupesOnly);
  render();
});

$('add').addEventListener('click', () => {
  const entry = { type: 'entry', id: Date.now(), domain: '', name: '' };
  lines.push(entry);
  // A new blank row can only be found in file order with no filter on.
  filter = '';
  dupesOnly = false;
  sortBy = 'file';
  $('search').value = '';
  $('sort').value = 'file';
  $('dupeOnly').classList.remove('on');
  render();
  const inputs = $('rows').querySelectorAll('input.dom');
  const last = inputs[inputs.length - 1];
  if (last) {
    last.focus();
    if (last.scrollIntoView) last.scrollIntoView({ block: 'center' });
  }
});

// ------------------------------------------------------------------ bulk

let bulkOpen = false;
$('bulkToggle').addEventListener('click', () => {
  bulkOpen = !bulkOpen;
  $('bulk').style.display = bulkOpen ? 'block' : 'none';
  $('table').style.display = bulkOpen ? 'none' : 'block';
  $('bulkToggle').classList.toggle('on', bulkOpen);
  if (bulkOpen) {
    $('text').value = serializeLines(lines);
    $('text').focus();
  } else {
    lines = parseLines($('text').value);
    commit();
    render();
  }
});

$('text').addEventListener('change', () => {
  lines = parseLines($('text').value);
  commit();
});

// ------------------------------------------------------------------ io

$('export').addEventListener('click', () => {
  const text = serializeLines(lines).trim();
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
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  setStatus('exported', 'ok');
});

function ingest(text) {
  const { text: merged, added } = mergeText(serializeLines(lines), text);
  if (!added) {
    setStatus('nothing new', 'bad');
    return;
  }
  lines = parseLines(merged);
  commit(`${added} added`);
  render();
}

$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => ingest(String(reader.result || ''));
  reader.onerror = () => setStatus('could not read that file', 'bad');
  reader.readAsText(file);
});

// Drop a file anywhere on the page.
['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
document.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  if (dt.files && dt.files.length) {
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result || ''));
    reader.readAsText(dt.files[0]);
  } else {
    const text = dt.getData('text');
    if (text) ingest(text);
  }
});

/* Clear needs two clicks. There is no undo. */
let armed = null;
$('clear').addEventListener('click', () => {
  const btn = $('clear');
  if (!armed) {
    btn.classList.add('armed');
    btn.textContent = 'Clear all? click again';
    setStatus('this wipes the whole list', 'bad');
    armed = setTimeout(() => {
      armed = null;
      btn.classList.remove('armed');
      btn.textContent = 'Clear all';
    }, 4000);
    return;
  }
  clearTimeout(armed);
  armed = null;
  btn.classList.remove('armed');
  btn.textContent = 'Clear all';
  lines = [];
  commit('cleared');
  render();
});

load();
