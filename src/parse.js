/* Shared list parsing, used by both the popup and the options page.
 *
 * A classic script on purpose: top level declarations become globals for the
 * two pages that include it, and the test harness can eval the same file.
 *
 * The stored text is the source of truth. The options table edits it in place
 * through parseLines/serializeLines so comment lines and ordering survive an
 * edit made in the table rather than the textarea.
 */

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

function looksLikeDomain(s) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(cleanDomain(s));
}

/** Split one list line into { domain, name }. Returns null for nothing usable. */
function parseLine(line) {
  // Pipe, comma or tab, so a spreadsheet paste works untouched.
  const parts = String(line)
    .split(/\s*[|,\t]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!parts.length) return null;

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
  if (!domain && !name) return null;
  return { domain, name };
}

function entryKey(e) {
  return `${e.domain}|${(e.name || '').toLowerCase()}`;
}

/** One line in, one entry out. Returns { targets, skipped }. */
function parseDomains(text) {
  const targets = [];
  const skipped = [];
  const seen = new Set();

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const entry = parseLine(line);
    if (!entry) {
      skipped.push(line);
      continue;
    }

    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(entry);
  }

  return { targets, skipped };
}

/* Merge without clobbering. Only lines whose entry is not already in the list
 * get appended, so importing the same file twice is a no-op and importing a
 * partial list never destroys what is already there. */
function mergeText(existing, incoming) {
  const have = new Set(parseDomains(existing).targets.map(entryKey));
  const fresh = [];

  for (const raw of String(incoming || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const key = entryKey(parsed);
    if (have.has(key)) continue;
    have.add(key);
    fresh.push(line);
  }

  if (!fresh.length) return { text: existing, added: 0 };
  const base = String(existing || '').trim();
  return { text: (base ? base + '\n' : '') + fresh.join('\n') + '\n', added: fresh.length };
}

/* ------------------------------------------------------------------ lines
 *
 * The table view needs to edit individual entries without flattening the file.
 * parseLines keeps every comment and blank line as a `raw` node so serializeLines
 * can put the file back together with the untouched parts exactly where they were.
 */

function parseLines(text) {
  const out = [];
  let id = 0;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      out.push({ type: 'raw', raw });
      continue;
    }
    const entry = parseLine(line);
    if (!entry) {
      out.push({ type: 'raw', raw });
      continue;
    }
    out.push({ type: 'entry', id: ++id, domain: entry.domain, name: entry.name });
  }

  // A trailing newline shows up as one empty raw node. Drop it so the count of
  // blank lines does not creep upward on every round trip.
  while (out.length && out[out.length - 1].type === 'raw' && !out[out.length - 1].raw.trim()) {
    out.pop();
  }

  return out;
}

function formatEntry(e) {
  return e.name ? `${e.domain} | ${e.name}` : e.domain || e.name;
}

function serializeLines(lines) {
  const body = lines
    .map((n) => (n.type === 'raw' ? n.raw : formatEntry(n)))
    .join('\n')
    .replace(/\s+$/, '');
  return body ? body + '\n' : '';
}

/* Duplicates the user can act on. Same domain twice is a duplicate even when the
 * business names differ, because two rows for one domain is almost always a
 * paste accident rather than intent. Name-only entries dedupe on the name. */
function duplicateKeys(entries) {
  const counts = new Map();
  for (const e of entries) {
    const key = e.domain ? 'd:' + e.domain : 'n:' + (e.name || '').toLowerCase();
    if (!key || key === 'd:' || key === 'n:') continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const dupes = new Set();
  for (const [key, n] of counts) if (n > 1) dupes.add(key);
  return dupes;
}

function dupeKeyFor(e) {
  return e.domain ? 'd:' + e.domain : 'n:' + (e.name || '').toLowerCase();
}

