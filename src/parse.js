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


// ------------------------------------------------------------- remote list
//
// One shared .txt file at a URL keeps every computer's list identical: the URL
// syncs through chrome.storage.sync, each machine fetches the file itself.
// This lives here so the popup and the manager run the SAME pipeline - two
// copies had already started to drift the day they were written.

/* Staleness window for the quiet auto-refresh. Per machine. */
const REMOTE_STALE_MS = 12 * 3600 * 1000;

/* chrome.storage.local, with a no-op stand-in for test harnesses that only
 * stub .sync. */
function remoteLocalStore() {
  return (
    (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || {
      get: (d, cb) => cb(d),
      set: () => {},
    }
  );
}

/* Fetch and validate the file. Resolves { text, targets, skipped }; rejects
 * with an Error whose message is fit to show the user. auth is optional
 * { user, pass } for a file behind HTTP Basic Auth - sent as an Authorization
 * header rather than embedded in the URL, so it never ends up in browser
 * history or server access logs. */
function fetchRemoteList(url, auth) {
  const headers = {};
  if (auth && auth.user) headers.Authorization = 'Basic ' + btoa(`${auth.user}:${auth.pass || ''}`);
  return fetch(url, { cache: 'no-store', headers })
    .then((res) => {
      if (res.status === 401 || res.status === 403) {
        throw new Error(auth && auth.user ? 'wrong username or password' : 'this file needs a username and password');
      }
      if (!res.ok) throw new Error(`the server said ${res.status}`);
      return res.text();
    })
    .then((text) => {
      // A share page instead of the raw file is the classic mistake.
      if (/^\s*(<!doctype|<html)/i.test(text)) {
        throw new Error('that link returns a web page, not the file - use a raw/direct link');
      }
      const { targets, skipped } = parseDomains(text);
      if (!targets.length) throw new Error('no domains found in that file');
      return { text, targets, skipped };
    })
    .catch((err) => {
      /* A CORS block reports as a bare TypeError with no useful message. */
      throw err instanceof TypeError
        ? new Error('could not reach that URL (the host must allow cross-site fetches, or use a GitHub raw link)')
        : err;
    });
}

/* Replace the whole list with the remote file. The list it overwrites is
 * backed up to chrome.storage.local first, so one wrong URL is not a
 * permanent loss - restoreRemoteBackup() brings it back. auth is optional,
 * see fetchRemoteList. */
function applyRemoteList(url, auth) {
  return fetchRemoteList(url, auth).then(
    ({ text, targets, skipped }) =>
      new Promise((resolve, reject) => {
        chrome.storage.sync.get({ domainsText: '', targets: [] }, (prev) => {
          remoteLocalStore().set({
            remoteBackup: prev.domainsText || '',
            remoteLastFetch: Date.now(),
          });
          chrome.storage.sync.set({ targets, domainsText: text }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error('file too long for sync storage'));
              return;
            }
            resolve({ text, targets, skipped });
          });
        });
      })
  );
}

/* Put back whatever the last remote sync overwrote. */
function restoreRemoteBackup() {
  return new Promise((resolve, reject) => {
    remoteLocalStore().get({ remoteBackup: '' }, (l) => {
      if (!l.remoteBackup) {
        reject(new Error('no backup to restore'));
        return;
      }
      const { targets } = parseDomains(l.remoteBackup);
      chrome.storage.sync.set({ targets, domainsText: l.remoteBackup }, () => {
        if (chrome.runtime.lastError) reject(new Error('could not restore'));
        else resolve({ targets });
      });
    });
  });
}
