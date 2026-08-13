/* Gilmedia SERP Counter - content script
 *
 * Two jobs:
 *   1. Number every result by its TRUE rank. Google restarts visual counting on
 *      every page, so page 3 looks like 1-10 when it is really 21-30. We read
 *      the `start` offset out of the URL and number from there.
 *   2. Take a whole client list and mark whichever of them appear, across
 *      organic, Ads, the local pack, Local Services Ads and Maps. Only the
 *      clients that actually turn up get a line in the panel.
 *
 * Google's markup changes without warning, so nothing here leans on a single
 * class name. Detection is structural first (a heading inside a link inside the
 * results column) with class names only as hints. When a section cannot be
 * parsed the panel says so rather than quietly reporting a wrong number.
 */

(() => {
  'use strict';

  const NS = 'gil-serp';
  if (window[`__${NS}_loaded`]) return;
  window[`__${NS}_loaded`] = true;

  // ---------------------------------------------------------------- settings

  const DEFAULTS = {
    targets: [], // [{ domain: 'example.com', name: 'Example Co' }]
    showOrganic: true,
    showAds: true,
    showLocal: true,
    showLsa: true,
    showPanel: true,
    debug: false,
  };

  let cfg = { ...DEFAULTS };
  let lastHosts = []; // every domain seen in the last scan, for the "why?" link

  /* Running log for one search term.
   *
   * Paging from 1 to 2 to 3 is a fresh page load each time, so without this the
   * panel would forget page 1 the moment you clicked page 2. Findings accumulate
   * per query and reset only when the query changes.
   *
   * sessionStorage rather than chrome.storage: it is per tab, so two tabs
   * running different searches never overwrite each other, and it clears itself
   * when the tab closes. */
  const SKEY = `${NS}-run`;

  function queryKey() {
    const p = new URLSearchParams(location.search);
    return (p.get('q') || '').trim().toLowerCase();
  }

  /** 1-based page number, derived from the result offset. */
  function currentPage() {
    const per = parseInt(new URLSearchParams(location.search).get('num') || '10', 10) || 10;
    return Math.floor(pageOffset() / per) + 1;
  }

  function loadRun(q) {
    try {
      const s = JSON.parse(sessionStorage.getItem(SKEY) || 'null');
      if (s && s.q === q) return s;
    } catch {}
    return { q, pages: [], entries: [] };
  }

  function saveRun(s) {
    try {
      sessionStorage.setItem(SKEY, JSON.stringify(s));
    } catch {}
  }

  function clearRun() {
    try {
      sessionStorage.removeItem(SKEY);
    } catch {}
  }

  // ------------------------------------------------------------------ utils

  const isMaps = /\/maps(\/|$)/.test(location.pathname);

  /** Rank of the first result on this page. Page 3 with start=20 begins at 21. */
  function pageOffset() {
    const start = parseInt(new URLSearchParams(location.search).get('start') || '0', 10);
    return Number.isFinite(start) && start > 0 ? start : 0;
  }

  function cleanHost(value) {
    if (!value) return '';
    let h = String(value).trim().toLowerCase();
    h = h.replace(/^https?:\/\//, '');
    h = h.split('/')[0].split('?')[0].split('#')[0].split(' ')[0];
    // Google prints results under m., amp. and www. variants of the same site.
    h = h.replace(/^(www|m|amp|mobile)\./, '');
    return h;
  }

  function hostOf(url) {
    try {
      return cleanHost(new URL(url, location.href).hostname);
    } catch {
      return '';
    }
  }

  /** example.com matches example.com and shop.example.com, never notexample.com. */
  function hostMatches(host, domain) {
    if (!host || !domain) return false;
    return host === domain || host.endsWith(`.${domain}`);
  }

  function textOf(el) {
    return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function isHttpLink(a) {
    return a && /^https?:/i.test(a.href || '') && !/^https?:\/\/(www\.)?google\./i.test(a.href);
  }

  function inDomOrder(list) {
    return list.sort((a, b) =>
      a.block.compareDocumentPosition(b.block) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
  }

  const debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  // -------------------------------------------------------------- detection

  // Blocks that are never organic results. Ads and the local pack are counted
  // separately, the rest are Google's own widgets.
  const NOT_ORGANIC = [
    '#tads',
    '#tadsb',
    '#bottomads',
    '#taw',
    '[data-text-ad]',
    '[data-pla-container]',
    '[jsname="yEVEwb"]', // people also ask
    '[data-initq]',
    '.related-question-pair',
    '[data-async-context*="local"]',
    '[data-cid]',
    '.rllt__link',
    'g-scrolling-carousel',
  ].join(',');

  function resultsRoot() {
    return (
      document.querySelector('#rso') ||
      document.querySelector('#search') ||
      document.querySelector('#center_col') ||
      document.body
    );
  }

  /** Walk up from a link to the container that represents one whole result. */
  function blockFor(link) {
    const preferred = link.closest('div.MjjYud, div.g, div[data-sokoban-container]');
    if (preferred) return preferred;
    let n = link;
    for (let i = 0; i < 6 && n.parentElement; i++) {
      n = n.parentElement;
      if (n.matches && n.matches('div[data-hveid]')) return n;
    }
    return link.parentElement || link;
  }

  /* `claimedRows` holds the individual rows already numbered as LSA, local or
   * ad. Excluding by ROW rather than by module is deliberate: an over-broad
   * module used to swallow every organic result and leave the page bare. A row
   * can only ever remove itself. */
  function organicResults(claimedRows = []) {
    const root = resultsRoot();
    const seen = new Set();
    const out = [];
    for (const h of root.querySelectorAll('h3')) {
      const link = h.closest('a[href]');
      if (!isHttpLink(link)) continue;
      if (link.closest(NOT_ORGANIC)) continue;
      if (claimedRows.some((r) => r.contains(link))) continue;
      const block = blockFor(link);
      if (!block || seen.has(block)) continue;
      if (claimedRows.some((r) => r.contains(block) || block.contains(r))) continue;
      if (out.some((r) => r.block.contains(block))) continue;
      seen.add(block);
      out.push({
        block,
        host: hostOf(link.href),
        title: textOf(h),
        url: link.href,
        cite: textOf(block.querySelector('cite')),
      });
    }
    return out;
  }

  function adResults() {
    const seen = new Set();
    const out = [];
    const roots = ['#tads', '#tadsb', '#bottomads', '#taw']
      .map((s) => document.querySelector(s))
      .filter(Boolean);

    const candidates = [];
    for (const r of roots) candidates.push(...r.querySelectorAll('a[href] h3, a[href][data-rw]'));
    for (const el of document.querySelectorAll('[data-text-ad] a[href] h3')) candidates.push(el);

    for (const el of candidates) {
      const link = el.closest('a[href]') || el;
      if (!isHttpLink(link)) continue;
      const block =
        link.closest('div[data-text-ad], div.uEierd, div[data-hveid]') || link.parentElement;
      if (!block || seen.has(block)) continue;
      if (out.some((r) => r.block.contains(block))) continue;
      seen.add(block);
      out.push({ block, host: hostOf(link.href), title: textOf(el), url: link.href });
    }
    return inDomOrder(out);
  }

  /* MODULES FIRST.
   *
   * The earlier version hunted for local rows across the whole page, which meant
   * a Local Services card (it links to Maps) and an ordinary organic result
   * (it can carry a role=heading) both got claimed as local. The counts were
   * wrong in both directions.
   *
   * So: locate the LSA block and the "Businesses" block as whole modules, then
   * only take rows from inside them. Anything outside a module is not local,
   * full stop, and each module is excluded from every later pass. If a module
   * cannot be found, that section reports zero rather than scattering badges. */

  const LSA_LINK = 'a[href*="localservices.google.com"], a[href*="/localservices/"]';

  // Headings Google puts above the local pack, across the layouts it ships.
  const LOCAL_HEADING =
    /^(businesses|places|map results|local results|business results|entreprises|empresas|negocios|unternehmen|bedrijven)\b/i;

  const LOCAL_NAME_SEL = ['.dbg0pd', '.rllt__details', '.OSrXXb', '.qBF1Pd', '.rgnuSb'].join(',');

  const LOCAL_ROW_SEL = [
    '[data-cid]',
    '.VkpGBb',
    '.uMdZh',
    '.Nv2PK',
    '.rllt__link',
    'div[role="link"]',
  ].join(',');

  const FOOTER_TEXT = /^(more places|view all|more businesses|see more|show more|all filters)/i;

  function placeIdOf(el) {
    const cidHost = el.closest('[data-cid]') || (el.querySelector && el.querySelector('[data-cid]'));
    if (cidHost && cidHost.getAttribute) {
      const v = cidHost.getAttribute('data-cid');
      if (v) return v;
    }
    const a = el.matches && el.matches('a[href]') ? el : el.querySelector('a[href*="/maps/place/"]');
    if (a && a.href) {
      const m = a.href.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
      if (m) return m[0];
    }
    return '';
  }

  function lowestCommonAncestor(nodes) {
    if (!nodes.length) return null;
    let anc = nodes[0].parentElement;
    while (anc && anc.nodeType === 1 && !nodes.every((n) => anc.contains(n))) {
      anc = anc.parentElement;
    }
    return anc && anc.nodeType === 1 ? anc : null;
  }

  /* A module has to be a BLOCK on the page, not the page. Without this guard the
   * common-ancestor walk can climb to the results column, and then every organic
   * result sits "inside the local module" and the whole page goes unnumbered.
   * That is exactly what killed pages 2 and up. */
  function isSaneModule(mod) {
    if (!mod || mod.nodeType !== 1) return false;
    if (mod === document.body || mod === document.documentElement) return false;
    if (mod.id && /^(rso|search|center_col|rcnt|main|appbar)$/i.test(mod.id)) return false;
    if (mod.querySelector('#rso, #search, #center_col')) return false;
    const inside = mod.querySelectorAll('h3').length;
    const total = document.querySelectorAll('h3').length;
    if (total && inside / total > 0.5) return false;
    return true;
  }

  /** closest() that tolerates a non-Element, and refuses to return the world. */
  function tightenTo(el, selector) {
    if (!el || el.nodeType !== 1 || typeof el.closest !== 'function') return null;
    const up = el.closest(selector);
    return up && isSaneModule(up) ? up : isSaneModule(el) ? el : null;
  }

  /** The Local Services Ads block, or null. */
  function findLsaModule() {
    const links = [...document.querySelectorAll(LSA_LINK)].filter(
      (a) => !FOOTER_TEXT.test(textOf(a))
    );
    if (!links.length) return null;
    const base = links.length === 1 ? links[0].parentElement : lowestCommonAncestor(links);
    return tightenTo(base, '[data-hveid]');
  }

  /** The "Businesses" / local pack block, or null. */
  function findLocalModule(lsaMod) {
    const outside = (el) => el && !(lsaMod && lsaMod.contains(el));

    // 1. Heading-driven. This is what the user sees as the "Businesses" header.
    for (const h of document.querySelectorAll('h2, h3, [role="heading"]')) {
      if (!LOCAL_HEADING.test(textOf(h))) continue;
      const mod =
        h.closest('[data-hveid], div[jscontroller], section, div.MjjYud') || h.parentElement;
      if (!outside(mod) || !isSaneModule(mod)) continue;
      if (mod.querySelector(LOCAL_ROW_SEL + ',' + LOCAL_NAME_SEL)) return mod;
    }

    // 2. Two or more place ids sitting together is a local pack by definition.
    const cids = [...document.querySelectorAll('[data-cid]')].filter(outside);
    if (cids.length >= 2) {
      const mod = tightenTo(lowestCommonAncestor(cids), '[data-hveid]');
      if (mod) return mod;
    }

    // 3. The classic name nodes. A single one is NOT enough to declare a module
    //    on its own, because one stray node used to drag the whole column in.
    const names = [...document.querySelectorAll(LOCAL_NAME_SEL)].filter(outside);
    if (names.length >= 2) {
      const mod = tightenTo(lowestCommonAncestor(names), '[data-hveid]');
      if (mod) return mod;
    }
    if (names.length === 1) {
      const mod = tightenTo(names[0].parentElement, 'div[jsaction], div[data-hveid]');
      if (mod && mod.querySelectorAll('h3').length === 0) return mod;
    }

    return null;
  }

  /** Top-most matching rows inside a module, deduped and in DOM order. */
  function rowsIn(module, selector) {
    if (!module) return [];
    const found = [...module.querySelectorAll(selector)];
    const out = [];
    for (const el of found) {
      if (el === module) continue;
      if (FOOTER_TEXT.test(textOf(el))) continue;
      if (textOf(el).length < 3) continue;
      if (out.some((r) => r.contains(el) || el.contains(r))) continue;
      out.push(el);
    }
    return out;
  }

  function describeLocalRow(block) {
    const site = block.querySelector('a[href^="http"]:not([href*="google."])');
    const nameEl = block.querySelector(LOCAL_NAME_SEL);
    return {
      block,
      host: site ? hostOf(site.href) : '',
      title: textOf(nameEl) || textOf(block).slice(0, 70),
      url: site ? site.href : '',
      placeId: placeIdOf(block),
    };
  }

  function localPackResults(module) {
    let rows = rowsIn(module, LOCAL_ROW_SEL);
    // Some layouts have no row wrapper at all, only the name node, so climb to
    // whatever contains it.
    if (!rows.length && module) {
      rows = rowsIn(module, LOCAL_NAME_SEL).map(
        (n) => n.closest('[data-hveid], div[jsaction], div') || n
      );
      rows = rows.filter((r, i) => rows.indexOf(r) === i && r !== module);
    }
    return inDomOrder(rows.map(describeLocalRow));
  }

  function lsaResults(module) {
    if (!module) return [];
    let rows = rowsIn(module, '[data-cid], div[role="listitem"], div[jsname], div[data-hveid]');
    // Fall back to one row per Local Services link.
    if (!rows.length) {
      const seen = new Set();
      rows = [];
      for (const a of module.querySelectorAll(LSA_LINK)) {
        if (FOOTER_TEXT.test(textOf(a))) continue;
        const b = a.closest('div[data-hveid], div[jsname]') || a.parentElement;
        if (b && b !== module && !seen.has(b)) {
          seen.add(b);
          rows.push(b);
        }
      }
    }
    return inDomOrder(
      rows.map((block) => ({
        block,
        host: '',
        title: textOf(block.querySelector(LOCAL_NAME_SEL)) || textOf(block).slice(0, 70),
        url: '',
        placeId: placeIdOf(block),
      }))
    );
  }

  function mapsResults() {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return [];
    const seen = new Set();
    const out = [];
    for (const a of feed.querySelectorAll('a[href*="/maps/place/"]')) {
      const block = a.closest('div[jsaction]') || a.parentElement;
      if (!block || seen.has(block)) continue;
      seen.add(block);
      out.push({
        block,
        host: '',
        title: a.getAttribute('aria-label') || textOf(block).slice(0, 70),
        url: a.href,
        placeId: placeIdOf(a),
      });
    }
    return inDomOrder(out);
  }

  // --------------------------------------------------------------- matching

  /* Built once per scan from cfg.targets, so a hundred-client list costs one
   * pass rather than one pass per result. */
  function normalisedTargets() {
    return cfg.targets
      .map((t) => ({
        ref: t,
        domain: cleanHost(t.domain),
        name: (t.name || '').trim().toLowerCase(),
        label: t.domain || t.name || 'client',
      }))
      .filter((t) => t.domain || t.name);
  }

  /* Domains are the reliable signal for organic and ads. Business names are the
   * only signal in the local pack, LSA and Maps, where Google prints a name and
   * no URL. Matching a name inside an organic title is allowed but kept to
   * names of real length, because with a long client list short names throw
   * false positives all over the page. */
  function matchTarget(entry, targets, kind) {
    const isLocalish = kind === 'local' || kind === 'lsa' || kind === 'maps';
    let blockText = null;

    for (const t of targets) {
      if (t.domain) {
        if (hostMatches(entry.host, t.domain)) return t;
        // Some results render the site in a <cite> while the href is wrapped.
        if (entry.cite && hostMatches(cleanHost(entry.cite), t.domain)) return t;
        if (entry.url && entry.url.toLowerCase().includes(t.domain)) return t;
      }

      if (t.name && (isLocalish || t.name.length >= 5)) {
        if (entry.title && entry.title.toLowerCase().includes(t.name)) return t;
        if (isLocalish) {
          if (blockText === null) blockText = textOf(entry.block).toLowerCase();
          if (blockText.includes(t.name)) return t;
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- painting

  function clearMarks() {
    for (const el of document.querySelectorAll(`.${NS}-badge`)) el.remove();
    for (const el of document.querySelectorAll(`.${NS}-hit`)) el.classList.remove(`${NS}-hit`);
    for (const el of document.querySelectorAll(`.${NS}-block`)) el.classList.remove(`${NS}-block`);
  }

  const KIND_TAG = { ad: 'Ad', lsa: 'LSA', local: 'Map', maps: 'Map' };

  function paint(entries, { offset = 0, kind, targets = [] }) {
    const hits = [];
    entries.forEach((entry, i) => {
      const rank = offset + i + 1;
      const tag = KIND_TAG[kind] || '';
      const label = tag ? `${tag} ${rank}` : String(rank);
      const hit = matchTarget(entry, targets, kind);

      const badge = document.createElement('span');
      badge.className =
        `${NS}-badge ${NS}-badge--${kind}` +
        (hit ? ` ${NS}-badge--hit` : '') +
        (rank > 99 ? ` ${NS}-badge--wide` : '');
      badge.textContent = String(rank);
      badge.title = hit
        ? `${hit.label} found at ${label}`
        : `${tag ? tag + ' ' : 'Organic '}position ${rank}`;

      if (tag) {
        const t = document.createElement('span');
        t.className = `${NS}-tag`;
        t.textContent = tag;
        badge.appendChild(t);
      }

      entry.block.classList.add(`${NS}-block`);
      entry.block.insertBefore(badge, entry.block.firstChild);

      if (hit) {
        entry.block.classList.add(`${NS}-hit`);
        hits.push({ target: hit, rank, label, title: entry.title, kind });
      }
    });
    return hits;
  }

  // ------------------------------------------------------------------ panel

  function renderPanel(sections, hits, run) {
    let panel = document.getElementById(`${NS}-panel`);
    if (!cfg.showPanel) {
      if (panel) panel.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = `${NS}-panel`;
      panel.className = `${NS}-panel`;
      document.body.appendChild(panel);
    }

    const collapsed = localStorage.getItem(`${NS}-collapsed`) === '1';
    const lines = [];
    const loaded = cfg.targets.length;

    if (!loaded) {
      lines.push(
        `<div class="${NS}-empty">No clients loaded. Click the extension icon and paste your list.</div>`
      );
    } else {
      /* Every client that appears gets a row, with all of its positions across
       * every surface. Clients that did not appear are left out entirely: with
       * a full agency roster loaded, printing the misses would bury the hits. */
      /* Read from the running log, not just this page, so paging 1 -> 2 -> 3
       * builds one cumulative answer for the search term. Falls back to the
       * current page on Maps, where there is no paging to accumulate. */
      const entries = run
        ? run.entries
        : [...new Map(hits.map((h) => [h.target.label, h])).keys()].map((key) => ({
            key,
            name: '',
            hits: hits.filter((h) => h.target.label === key),
          }));

      if (!entries.length) {
        lines.push(
          `<div class="${NS}-row"><span class="${NS}-miss" data-act="why" title="Click to list every domain found on this page">none of your ${loaded} client${loaded === 1 ? '' : 's'} found yet &middot; why?</span></div>`
        );
      } else {
        // Best position first, so the client ranking highest is at the top.
        const rows = entries
          .slice()
          .sort((a, b) => Math.min(...a.hits.map((h) => h.rank)) - Math.min(...b.hits.map((h) => h.rank)));

        const pages = run && run.pages.length ? run.pages : [currentPage()];
        const scope =
          pages.length > 1
            ? `across pages ${pages.join(', ')}`
            : `on page ${pages[0]}`;
        lines.push(
          `<div class="${NS}-found">${rows.length} of ${loaded} client${loaded === 1 ? '' : 's'} ${scope}</div>`
        );

        for (const e of rows) {
          // Order a client's own positions organic, local, LSA, then ads.
          const order = { organic: 0, local: 1, maps: 1, lsa: 2, ad: 3 };
          const chips = e.hits
            .slice()
            .sort((a, b) => (order[a.kind] - order[b.kind]) || a.page - b.page || a.rank - b.rank)
            .map((h) => {
              /* An organic rank is absolute, so it already says which page it
               * came from. Ad, LSA and map positions restart every page, so
               * those need the page spelled out. */
              const needsPage = h.kind !== 'organic' && pages.length > 1 && h.page;
              const text = needsPage ? `${h.label} &middot;p${h.page}` : h.label;
              return `<span class="${NS}-pos ${NS}-pos--${esc(h.kind)}" title="page ${esc(h.page || '?')}">${text}</span>`;
            })
            .join('');
          const sub = e.name ? `<span class="${NS}-sub">${esc(e.name)}</span>` : '';
          lines.push(
            `<div class="${NS}-row"><span class="${NS}-dom">${esc(e.key)}</span>${sub}${chips}</div>`
          );
        }
      }
    }

    const counts = sections
      .filter((s) => s.count > 0)
      .map((s) => `${s.label} ${s.count}`)
      .join(' &middot; ');

    const term = run && run.q ? run.q : '';
    panel.innerHTML = `
      <div class="${NS}-head">
        <span class="${NS}-title">SERP Counter</span>
        <span class="${NS}-range">${esc(rangeLabel(sections))}</span>
        <button class="${NS}-btn" data-act="copy" title="Copy the running summary">copy</button>
        ${run ? `<button class="${NS}-btn" data-act="reset" title="Clear the running log for this search">reset</button>` : ''}
        <button class="${NS}-btn" data-act="toggle">${collapsed ? '+' : '&minus;'}</button>
      </div>
      <div class="${NS}-body" ${collapsed ? 'hidden' : ''}>
        ${term ? `<div class="${NS}-term">tracking &ldquo;${esc(term)}&rdquo;</div>` : ''}
        ${lines.join('')}
        <div class="${NS}-meta">this page: ${counts || 'nothing detected'}</div>
      </div>`;

    const resetBtn = panel.querySelector('[data-act="reset"]');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        clearRun();
        scan();
      });
    }

    for (const el of panel.querySelectorAll('[data-act="why"]')) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        console.log(
          `[${NS}] domains found on this page (${lastHosts.length}):`,
          lastHosts.join('\n')
        );
        el.textContent = `${lastHosts.length} domains logged to console`;
      });
    }

    panel.querySelector('[data-act="toggle"]').addEventListener('click', () => {
      localStorage.setItem(`${NS}-collapsed`, collapsed ? '0' : '1');
      renderPanel(sections, hits, run);
    });
    panel.querySelector('[data-act="copy"]').addEventListener('click', (e) => {
      const q = new URLSearchParams(location.search).get('q') || '';
      let summary;
      if (run && run.entries.length) {
        // Copy the whole run, not just whatever page happens to be open.
        summary = run.entries
          .map((en) => `${en.key}: ${en.hits.map((h) => h.label).join(', ')}`)
          .join(' | ');
      } else {
        const seen = new Map();
        for (const h of hits) {
          if (!seen.has(h.target)) seen.set(h.target, []);
          seen.get(h.target).push(h.label);
        }
        summary = seen.size
          ? [...seen].map(([t, labels]) => `${t.label}: ${labels.join(', ')}`).join(' | ')
          : 'no tracked client found';
      }
      const scope = run && run.pages.length > 1 ? ` (pages ${run.pages.join(', ')})` : '';
      navigator.clipboard.writeText(`"${q}"${scope} -> ${summary}`);
      e.target.textContent = 'copied';
      setTimeout(() => (e.target.textContent = 'copy'), 1200);
    });
  }

  function rangeLabel(sections) {
    const organic = sections.find((s) => s.key === 'organic');
    if (!organic || !organic.count) return isMaps ? 'Maps' : '';
    const from = organic.offset + 1;
    return `${from}-${organic.offset + organic.count}`;
  }

  function esc(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  // ------------------------------------------------------------------- scan

  function scan() {
    clearMarks();
    const hits = [];
    const sections = [];
    const hostsSeen = new Set();
    const targets = normalisedTargets();
    const noteHosts = (list) => list.forEach((e) => e.host && hostsSeen.add(e.host));

    if (isMaps) {
      const maps = mapsResults();
      hits.push(...paint(maps, { kind: 'maps', targets }));
      sections.push({ key: 'maps', label: 'Maps', count: maps.length, offset: 0 });
    } else {
      const offset = pageOffset();

      // Modules are used to FIND local and LSA rows. They are never used to
      // exclude organic results; only the claimed rows themselves do that.
      const lsaMod = findLsaModule();
      const localMod = findLocalModule(lsaMod);
      const claimedRows = [];

      if (cfg.showLsa) {
        const lsa = lsaResults(lsaMod);
        noteHosts(lsa);
        hits.push(...paint(lsa, { kind: 'lsa', targets }));
        claimedRows.push(...lsa.map((r) => r.block));
        sections.push({ key: 'lsa', label: 'LSA', count: lsa.length, offset: 0 });
      }
      if (cfg.showAds) {
        const ads = adResults().filter((a) => !claimedRows.some((r) => r.contains(a.block)));
        noteHosts(ads);
        hits.push(...paint(ads, { kind: 'ad', targets }));
        claimedRows.push(...ads.map((r) => r.block));
        sections.push({ key: 'ads', label: 'Ads', count: ads.length, offset: 0 });
      }
      if (cfg.showLocal) {
        const local = localPackResults(localMod).filter(
          (l) => !claimedRows.some((r) => r.contains(l.block))
        );
        noteHosts(local);
        hits.push(...paint(local, { kind: 'local', targets }));
        claimedRows.push(...local.map((r) => r.block));
        sections.push({ key: 'local', label: 'Local pack', count: local.length, offset: 0 });
      }
      if (cfg.showOrganic) {
        const organic = organicResults(claimedRows);
        noteHosts(organic);
        hits.push(...paint(organic, { offset, kind: 'organic', targets }));
        sections.push({ key: 'organic', label: 'Organic', count: organic.length, offset });
      }

      if (cfg.debug) {
        console.log(`[${NS}] modules`, { lsa: lsaMod, local: localMod });
      }
    }

    if (cfg.debug) {
      console.log(
        `[${NS}] ` + sections.map((s) => `${s.label}=${s.count}`).join(' '),
        `hits=${hits.length}`
      );
    }

    // Fold this page's findings into the running log for this search term.
    let run = null;
    if (!isMaps) {
      const q = queryKey();
      const page = currentPage();
      run = loadRun(q);
      if (!run.pages.includes(page)) {
        run.pages.push(page);
        run.pages.sort((a, b) => a - b);
      }
      for (const h of hits) {
        const key = h.target.label;
        let entry = run.entries.find((e) => e.key === key);
        if (!entry) {
          entry = { key, name: (h.target.ref && h.target.ref.name) || '', hits: [] };
          run.entries.push(entry);
        }
        const id = `${h.kind}|${h.rank}|${page}`;
        if (!entry.hits.some((x) => x.id === id)) {
          entry.hits.push({ id, kind: h.kind, rank: h.rank, page, label: h.label });
        }
      }
      saveRun(run);
    }

    lastHosts = [...hostsSeen].sort();

    renderPanel(sections, hits, run);
    document.dispatchEvent(new CustomEvent(`${NS}:painted`));
  }

  const rescan = debounce(scan, 350);

  /* Diagnostic hatch. Run __gilSerpDiag() in the console on a page where the
   * local pack is missed and send the output; it prints what each strategy
   * matched so the selectors can be fixed without guessing. */
  window.__gilSerpDiag = function () {
    const probe = (sel) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return 'bad selector';
      }
    };
    const lsaMod = findLsaModule();
    const localMod = findLocalModule(lsaMod);
    const desc = (el) =>
      el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(' ').slice(0, 3).join('.')}` : null;
    const report = {
      url: location.href,
      offset: pageOffset(),
      modules: { lsa: desc(lsaMod), local: desc(localMod) },
      localHeading: localMod
        ? textOf(localMod.querySelector('h2, h3, [role="heading"]')).slice(0, 60)
        : null,
      counts: {
        organic: organicResults([lsaMod, localMod].filter(Boolean)).length,
        ads: adResults().length,
        local: localPackResults(localMod).length,
        lsa: lsaResults(lsaMod).length,
        maps: mapsResults().length,
      },
      probes: {
        'data-cid': probe('[data-cid]'),
        'maps/place link': probe('a[href*="/maps/place/"]'),
        '.dbg0pd': probe('.dbg0pd'),
        '.rllt__details': probe('.rllt__details'),
        '.rllt__link': probe('.rllt__link'),
        '.VkpGBb': probe('.VkpGBb'),
        '.uMdZh': probe('.uMdZh'),
        'role=feed': probe('[role="feed"]'),
        'async local': probe('[data-async-context*="local"]'),
      },
      sampleLocalMarkup: [...document.querySelectorAll('a[href*="/maps/place/"]')]
        .slice(0, 2)
        .map((a) => (a.closest('div[data-hveid]') || a).outerHTML.slice(0, 700)),
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
  };

  // ------------------------------------------------------------------ boot

  function watch() {
    // Google appends results on scroll and rewrites the Maps feed as you pan,
    // so re-run on DOM change. Our own nodes are ignored to avoid a loop.
    // Observe body, not #center_col. Google can replace that container wholesale
    // when you page through results, which left the observer watching a detached
    // node and nothing ever re-numbered.
    const target = document.body;
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        if (t && t.closest && t.closest(`#${NS}-panel, .${NS}-badge, .${NS}-gbp`)) continue;
        rescan();
        return;
      }
    });
    obs.observe(target, { childList: true, subtree: true });

    // Maps is a single page app, so the URL can change with no reload.
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        rescan();
      }
    }, 800);
  }

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    cfg = { ...DEFAULTS, ...stored };
    scan();
    watch();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, v] of Object.entries(changes)) cfg[k] = v.newValue;
    scan();
  });
})();
