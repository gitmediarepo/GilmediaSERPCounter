/* Gilmedia SERP Counter - content script
 *
 * Two jobs:
 *   1. Number every result by its TRUE rank. Google restarts visual counting on
 *      every page, so page 3 looks like 1-10 when it is really 21-30. We read
 *      the `start` offset out of the URL and number from there.
 *   2. Take a whole domain list and mark whichever of them appear, across
 *      organic, Ads, the local pack, Local Services Ads and Maps. Only the
 *      domains that actually turn up get a line in the panel.
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

  /* Base colour per surface, plus bubble shape and type. Overridable from the
   * settings page (gear icon in the popup); shipped as sane Gilmedia-brand
   * defaults so a machine that never opens settings looks exactly as before. */
  const DEFAULT_STYLE = {
    colors: {
      organic: '#f37333',
      ad: '#7a5cff',
      lsa: '#4a86e8',
      local: '#2b7fd4',
      ai: '#9457f0',
      hit: '#627d47',
      mention: '#d4832b',
    },
    bubble: 'circle', // circle | rounded | square | pill
    fontSize: 12,
    fontFamily: 'Mulish, -apple-system, Segoe UI, Arial, sans-serif',
  };

  const DEFAULTS = {
    targets: [], // [{ domain: 'example.com', name: 'Example Co' }]
    enabled: true, // master switch, off means touch nothing at all
    showMentions: true, // name matches on other people's domains
    showOrganic: true,
    showAds: true,
    showLocal: true,
    showLsa: true,
    showAi: true, // AI Overview / AI Mode citations
    showPanel: true,
    showPaginationTop: true, // clone the page-number nav above the first result
    debug: false,
    style: DEFAULT_STYLE,
  };

  let cfg = { ...DEFAULTS };
  let lastHosts = []; // every domain seen in the last scan, for the "why?" link
  let lastMatchState = null; // did the previous render have anything to show?

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

  /* Validate the shape on the way in. sessionStorage is shared with the page's
   * own origin, so this data is not fully ours to trust. Anything malformed is
   * dropped rather than rendered. */
  function loadRun(q) {
    /* Entries and mentions share one shape, so they share one scrubber. */
    const scrubList = (list) =>
      (Array.isArray(list) ? list : [])
        .filter((e) => e && typeof e.key === 'string' && Array.isArray(e.hits))
        .map((e) => ({
          key: String(e.key).slice(0, 120),
          name: typeof e.name === 'string' ? e.name.slice(0, 120) : '',
          hits: e.hits
            .filter((h) => h && Number.isFinite(h.rank))
            .map((h) => ({
              id: String(h.id || '').slice(0, 60),
              kind: /^(organic|ad|lsa|local|maps|ai)$/.test(h.kind) ? h.kind : 'organic',
              rank: h.rank,
              page: Number.isFinite(h.page) ? h.page : 1,
              label: String(h.label || '').slice(0, 40),
            })),
        }));

    try {
      const s = JSON.parse(sessionStorage.getItem(SKEY) || 'null');
      if (!s || s.q !== q || !Array.isArray(s.pages) || !Array.isArray(s.entries)) throw 0;
      return {
        q,
        pages: s.pages.filter((p) => Number.isFinite(p)),
        entries: scrubList(s.entries),
        // Mentions accumulate across pages exactly like entries. Dropping them
        // here silently forgot page 1's mentions the moment page 2 loaded.
        mentions: scrubList(s.mentions),
      };
    } catch {}
    return { q, pages: [], entries: [], mentions: [] };
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

  /* Maps and some local pack cards render the business name only as an
   * aria-label or an image's alt text, never as visible text, so a plain
   * textContent scan can miss it entirely. This folds in every aria-label,
   * alt and title on the card and its descendants so name matching sees it. */
  function richTextOf(el) {
    if (!el) return '';
    const parts = [textOf(el)];
    if (el.getAttribute) {
      const own = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title');
      if (own) parts.push(own);
    }
    if (el.querySelectorAll) {
      for (const node of el.querySelectorAll('[aria-label], [alt], [title]')) {
        const v = node.getAttribute('aria-label') || node.getAttribute('alt') || node.getAttribute('title');
        if (v) parts.push(v);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
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

  /* Google sometimes renders the same local pack, LSA or Maps listing twice in
   * the DOM (a compact view plus a hidden expanded one). Without this, the same
   * business shows up at two ranks instead of one. Same placeId, or same
   * host + title when there is no placeId, counts as the same listing. */
  function dedupeByPlace(list) {
    const seen = new Set();
    return list.filter((entry) => {
      /* Only a real identity may collapse two rows: a place id, or a website
       * plus name. A bare name is NOT identity - two locations of the same
       * franchise share it, and dropping one shifts every rank after it. */
      const key = entry.placeId || (entry.host ? `${entry.host}|${entry.title}`.toLowerCase() : '');
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /* The business's own site, when the card exposes one. Local pack (GBP) cards
   * often carry a "Website" link; Local Services Ads mostly route everything
   * through localservices.google.com and don't, but some layouts do surface one,
   * so both local and LSA try the same extraction rather than LSA giving up on
   * domain matching outright. */
  function siteLinkOf(block) {
    return block.querySelector(
      'a[href^="http"]:not([href*="google."]):not([href*="localservices.google."])'
    );
  }

  function describeLocalRow(block) {
    const site = siteLinkOf(block);
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
    return dedupeByPlace(inDomOrder(rows.map(describeLocalRow)));
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
    return dedupeByPlace(
      inDomOrder(
        rows.map((block) => {
          const site = siteLinkOf(block);
          return {
            block,
            host: site ? hostOf(site.href) : '',
            title: textOf(block.querySelector(LOCAL_NAME_SEL)) || textOf(block).slice(0, 70),
            url: site ? site.href : '',
            placeId: placeIdOf(block),
          };
        })
      )
    );
  }

  /* AI Overview (the answer box on a normal SERP) and AI Mode (the dedicated
   * chat-style tab/page, ?udm=50) both cite real pages with real links, so
   * they are matched the same way organic results are: by domain in the href.
   * Google has not published markup for either, and both are newer and less
   * stable than the rest of this file, so detection is best-effort with three
   * fallbacks - a handful of known attribute hints, a heading match, and
   * "the whole page is AI Mode" - and reports zero rather than guessing wrong
   * when none of them land. Re-check with __gilSerpDiag() if a page turns up
   * an AI panel that this misses. */
  const AI_HEADING = /^(ai overview|generative ai overview|ai-powered overview|ai mode)\b/i;

  const AI_HINT_SEL = [
    '#m-x-content',
    'div[data-attrid*="AIOverview" i]',
    'div[data-attrid*="GenerativeContent" i]',
    '[data-subtree="aif"]',
  ].join(',');

  function isAiModePage() {
    const params = new URLSearchParams(location.search);
    if (params.get('udm') === '50') return true;
    if (/\/search\/ai(\/|$)/.test(location.pathname)) return true;
    return !!document.querySelector('[data-udm="50"], a[href*="udm=50"][aria-current]');
  }

  function findAiModule() {
    const hinted = document.querySelector(AI_HINT_SEL);
    if (hinted && isSaneModule(hinted)) return hinted;

    for (const h of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
      if (!AI_HEADING.test(textOf(h))) continue;
      const mod = h.closest('div[data-hveid], div[jscontroller], section, div.MjjYud') || h.parentElement;
      if (mod && isSaneModule(mod)) return mod;
    }

    /* A dedicated AI Mode page (?udm=50) is AI top to bottom, so the results
     * root IS the module. isSaneModule is deliberately NOT applied here: it
     * rejects #rso/#search/#center_col by name, a guard that exists to stop
     * the LOCAL pack walk from climbing up and swallowing the organic results.
     * On this page there are no organic results to protect, so that guard
     * would only ever produce a false negative. */
    if (isAiModePage()) {
      const root = resultsRoot();
      if (root && root !== document.body) return root;
    }

    return null;
  }

  /* Every outbound link inside the module counts as one citation, one row per
   * nearest block so two links into the same card do not double count. */
  function aiResults(module) {
    if (!module) return [];
    const seenBlocks = new Set();
    const seenUrls = new Set();
    const out = [];
    for (const a of module.querySelectorAll('a[href]')) {
      if (!isHttpLink(a)) continue;

      /* The same source cited twice in one answer is one citation, not two. */
      const urlKey = (a.href || '').split('#')[0];
      if (seenUrls.has(urlKey)) continue;

      /* Nearest citation card, but it MUST be strictly inside the module. An
       * AI answer often puts several links in one prose paragraph with no
       * per-link wrapper, and closest() then walks all the way up to the
       * module itself - which collapsed every citation into a single row and
       * numbered only the first. When there is no card of its own, the link
       * IS the row. */
      let block = a.closest('div[data-hveid], div[jsname], div[role="listitem"], li');
      if (!block || block === module || !module.contains(block) || seenBlocks.has(block)) {
        block = a;
      }
      if (seenBlocks.has(block)) continue;

      seenBlocks.add(block);
      seenUrls.add(urlKey);
      out.push({
        block,
        host: hostOf(a.href),
        title: textOf(a) || textOf(block).slice(0, 70),
        url: a.href,
        cite: textOf(block.querySelector ? block.querySelector('cite') : null),
      });
    }
    return inDomOrder(out);
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
      const site = siteLinkOf(block);
      out.push({
        block,
        host: site ? hostOf(site.href) : '',
        title: a.getAttribute('aria-label') || textOf(block).slice(0, 70),
        url: a.href,
        placeId: placeIdOf(a),
      });
    }
    return dedupeByPlace(inDomOrder(out));
  }

  // --------------------------------------------------------------- matching

  /* Built once per scan from cfg.targets, so a hundred-domain list costs one
   * pass rather than one pass per result. */
  function normalisedTargets() {
    return cfg.targets
      .map((t) => ({
        ref: t,
        domain: cleanHost(t.domain),
        name: (t.name || '').trim().toLowerCase(),
        label: t.domain || t.name || 'domain',
      }))
      .filter((t) => t.domain || t.name);
  }

  const isLocalish = (kind) => kind === 'local' || kind === 'lsa' || kind === 'maps';

  /* Domains are the reliable signal for organic and ads. Business names are the
   * only signal in the local pack, LSA and Maps, where Google prints a name and
   * no URL. Matching a name inside an organic title is allowed but kept to
   * names of real length, because with a long domain list short names throw
   * false positives all over the page.
   *
   * Returns { target, via } where via is 'domain' or 'name'. The caller needs
   * that distinction: searching a company name turns up LinkedIn, Indeed,
   * ZoomInfo and a dozen other profiles carrying the name, and calling those
   * your result is wrong. A domain match is you. A name match on somebody
   * else's domain is a mention of you, which is a different fact. */
  function matchTarget(entry, targets, kind) {
    const localish = isLocalish(kind);
    let blockText = null;
    let nameHit = null;

    for (const t of targets) {
      if (t.domain) {
        if (hostMatches(entry.host, t.domain)) return { target: t, via: 'domain' };
        // Some results render the site in a <cite> while the href is wrapped.
        if (entry.cite && hostMatches(cleanHost(entry.cite), t.domain))
          return { target: t, via: 'domain' };
        if (entry.url && entry.url.toLowerCase().includes(t.domain))
          return { target: t, via: 'domain' };
      }

      if (!nameHit && t.name && (localish || t.name.length >= 5)) {
        if (entry.title && entry.title.toLowerCase().includes(t.name)) {
          nameHit = { target: t, via: 'name' };
          continue;
        }
        if (localish) {
          if (blockText === null) blockText = richTextOf(entry.block).toLowerCase();
          if (blockText.includes(t.name)) nameHit = { target: t, via: 'name' };
        }
      }
    }

    /* A domain match anywhere in the list beats a name match, so the whole list
     * is walked before falling back. Otherwise a result on your own site would
     * be filed as a mention just because some other entry's name appeared in
     * the title first. */
    return nameHit;
  }

  /* In the local pack, LSA and Maps a name match is the only signal there is,
   * and it is your own listing, so it counts as the real thing. In organic and
   * ads it means your name showed up on a page that is not yours. */
  const isMention = (via, kind) => via === 'name' && !isLocalish(kind);

  // ---------------------------------------------------------------- painting

  function clearMarks() {
    for (const el of document.querySelectorAll(`.${NS}-badge`)) el.remove();
    for (const el of document.querySelectorAll(`.${NS}-hit`)) el.classList.remove(`${NS}-hit`);
    for (const el of document.querySelectorAll(`.${NS}-mention`)) el.classList.remove(`${NS}-mention`);
    for (const el of document.querySelectorAll(`.${NS}-block`)) el.classList.remove(`${NS}-block`);
  }

  const KIND_TAG = { ad: 'Ad', lsa: 'LSA', local: 'Map', maps: 'Map', ai: 'AI' };

  /* Results per page, from the URL's own num= param. Google restarts numbering
   * every page, so this is how a true rank like 31 gets decomposed back into
   * "page 4, position 1" - the page-relative number searchers actually see. */
  function perPage() {
    return parseInt(new URLSearchParams(location.search).get('num') || '10', 10) || 10;
  }

  function pagePositionOf(rank) {
    const per = perPage();
    return { page: Math.floor((rank - 1) / per) + 1, pos: ((rank - 1) % per) + 1 };
  }

  function paint(entries, { offset = 0, kind, targets = [] }) {
    const hits = [];
    entries.forEach((entry, i) => {
      const rank = offset + i + 1;
      const kindTag = KIND_TAG[kind] || '';

      /* Organic is the one surface where the badge number is a TRUE rank that
       * spans pages (31, not "1 on page 4"), so it is the one surface where
       * spelling out the page and page-relative position is actually new
       * information rather than a restatement of the number already shown. */
      let label, cornerTag, posText;
      if (kind === 'organic') {
        const { page, pos } = pagePositionOf(rank);
        cornerTag = `p${page}.${pos}`;
        label = `${rank} (${cornerTag})`;
        posText = label;
      } else {
        cornerTag = kindTag;
        label = kindTag ? `${kindTag} ${rank}` : String(rank);
        posText = String(rank);
      }

      const match = matchTarget(entry, targets, kind);
      const hit = match && match.target;
      const mention = match ? isMention(match.via, kind) : false;
      // A mention is still a hit, just a different colour. Dropping it entirely
      // when mentions are off would also drop it from the running log.
      const show = hit && (!mention || cfg.showMentions);

      const badge = document.createElement('span');
      badge.className =
        `${NS}-badge ${NS}-badge--${kind}` +
        (show ? (mention ? ` ${NS}-badge--mention` : ` ${NS}-badge--hit`) : '') +
        (rank > 99 ? ` ${NS}-badge--wide` : '');
      badge.textContent = String(rank);
      badge.title = !show
        ? `${kindTag ? kindTag + ' ' : 'Organic '}position ${posText}`
        : mention
          ? `${hit.label} mentioned on ${entry.host || 'this result'} at ${label}`
          : `${hit.label} found at ${label}`;

      if (cornerTag) {
        const t = document.createElement('span');
        t.className = `${NS}-tag`;
        t.textContent = cornerTag;
        badge.appendChild(t);
      }

      entry.block.classList.add(`${NS}-block`);
      entry.block.insertBefore(badge, entry.block.firstChild);

      if (show) {
        entry.block.classList.add(mention ? `${NS}-mention` : `${NS}-hit`);
      }
      if (hit) {
        hits.push({
          target: hit,
          rank,
          label,
          title: entry.title,
          kind,
          mention,
          host: entry.host || '',
        });
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

    const lines = [];
    const loaded = cfg.targets.length;
    let hasMatches = false;

    if (!loaded) {
      lines.push(
        `<div class="${NS}-empty">No domains loaded. Click the extension icon and paste your list.</div>`
      );
    } else {
      /* Every domain that appears gets a row, with all of its positions across
       * every surface. Entries that did not appear are left out entirely: with
       * a long list loaded, printing the misses would bury the hits. */
      /* Read from the running log, not just this page, so paging 1 -> 2 -> 3
       * builds one cumulative answer for the search term. Falls back to the
       * current page on Maps, where there is no paging to accumulate. */
      const groupNow = (list, keyOf) =>
        [...new Set(list.map(keyOf))].map((key) => ({
          key,
          name: '',
          hits: list.filter((h) => keyOf(h) === key),
        }));

      const entries = run
        ? run.entries
        : groupNow(
            hits.filter((h) => !h.mention),
            (h) => h.target.label
          );

      const mentions = cfg.showMentions
        ? run
          ? run.mentions || []
          : groupNow(
              hits.filter((h) => h.mention),
              (h) => h.host || 'elsewhere'
            )
        : [];

      hasMatches = entries.length > 0 || mentions.length > 0;

      const pages = run && run.pages.length ? run.pages : [currentPage()];
      const scope = pages.length > 1 ? `across pages ${pages.join(', ')}` : `on page ${pages[0]}`;

      // Best position first, so whatever ranks highest is at the top.
      const byBest = (list) =>
        list
          .slice()
          .sort(
            (a, b) => Math.min(...a.hits.map((h) => h.rank)) - Math.min(...b.hits.map((h) => h.rank))
          );

      function rowFor(e, kindClass) {
        // Order one entry's own positions organic, local, LSA, then ads.
        const order = { organic: 0, ai: 1, local: 2, maps: 2, lsa: 3, ad: 4 };
        const chips = e.hits
          .slice()
          .sort((a, b) => order[a.kind] - order[b.kind] || a.page - b.page || a.rank - b.rank)
          .map((h) => {
            /* An organic rank is absolute, so it already says which page it
             * came from. Ad, LSA and map positions restart every page, so
             * those need the page spelled out. */
            const needsPage = h.kind !== 'organic' && pages.length > 1 && h.page;
            /* Escaped even though we wrote these labels ourselves. The running
             * log lives in sessionStorage, which a content script shares with
             * the page's own origin, so anything on the page could in theory
             * rewrite it. Never interpolate stored data raw into innerHTML. */
            const text = needsPage ? `${esc(h.label)} &middot;p${esc(h.page)}` : esc(h.label);
            const cls = kindClass ? ` ${NS}-pos--${kindClass}` : ` ${NS}-pos--${esc(h.kind)}`;
            return `<span class="${NS}-pos${cls}" title="page ${esc(h.page || '?')}">${text}</span>`;
          })
          .join('');
        const sub = e.name ? `<span class="${NS}-sub">${esc(e.name)}</span>` : '';
        return `<div class="${NS}-row"><span class="${NS}-dom">${esc(e.key)}</span>${sub}${chips}</div>`;
      }

      if (!entries.length && !mentions.length) {
        lines.push(
          `<div class="${NS}-row"><span class="${NS}-miss" data-act="why" title="Click to list every domain found on this page">none of your ${loaded} domain${loaded === 1 ? '' : 's'} found yet &middot; why?</span></div>`
        );
      } else {
        if (entries.length) {
          lines.push(
            `<div class="${NS}-found">${entries.length} of ${loaded} domain${loaded === 1 ? '' : 's'} ${scope}</div>`
          );
          for (const e of byBest(entries)) lines.push(rowFor(e));
        } else {
          lines.push(
            `<div class="${NS}-found">no domain of yours ${scope}</div>`
          );
        }

        /* Mentions get their own block. Searching a company name pulls up
         * LinkedIn, Indeed, ZoomInfo and the rest, all carrying the name and
         * none of them yours. Worth seeing, wrong to count as a ranking. */
        if (mentions.length) {
          lines.push(
            `<div class="${NS}-found ${NS}-found--mention">${mentions.length} mention${mentions.length === 1 ? '' : 's'} on other sites</div>`
          );
          for (const e of byBest(mentions)) lines.push(rowFor(e, 'mention'));
        }
      }
    }

    /* Auto-collapse when a search turns up none of your domains, auto-expand
     * the moment one does, so the panel is quiet on searches that don't matter
     * and visible on the ones that do. Only re-decided when the match state
     * actually flips: within one state, a manual click on the +/- button still
     * sticks (it re-renders through here too, but with lastMatchState already
     * equal to hasMatches, so this block leaves its choice alone). */
    let collapsed = localStorage.getItem(`${NS}-collapsed`) === '1';
    if (loaded && hasMatches !== lastMatchState) {
      collapsed = !hasMatches;
      localStorage.setItem(`${NS}-collapsed`, collapsed ? '1' : '0');
    }
    if (loaded) lastMatchState = hasMatches;

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
          : 'no tracked domain found';
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

    /* Master switch. Off means the page is left exactly as Google served it:
     * no badges, no outlines, no panel, and nothing written to the running log.
     * One click in the popup, for when someone is looking over your shoulder. */
    if (!cfg.enabled) {
      const panel = document.getElementById(`${NS}-panel`);
      if (panel) panel.remove();
      const pagetop = document.getElementById(`${NS}-pagination-top`);
      if (pagetop) pagetop.remove();
      document.dispatchEvent(new CustomEvent(`${NS}:painted`));
      return;
    }

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
      const aiMod = cfg.showAi ? findAiModule() : null;
      const claimedRows = [];

      if (cfg.showAi) {
        const ai = aiResults(aiMod);
        noteHosts(ai);
        hits.push(...paint(ai, { kind: 'ai', targets }));
        claimedRows.push(...ai.map((r) => r.block));
        sections.push({ key: 'ai', label: 'AI Overview', count: ai.length, offset: 0 });
      }
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
        console.log(`[${NS}] modules`, { lsa: lsaMod, local: localMod, ai: aiMod });
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
      if (!Array.isArray(run.mentions)) run.mentions = [];

      for (const h of hits) {
        /* Mentions are keyed by the site doing the mentioning, not by the target.
         * "linkedin.com mentions you at 7" is the useful fact; "you at 7" would
         * be a lie about whose page it is. */
        const list = h.mention ? run.mentions : run.entries;
        const key = h.mention ? h.host || 'elsewhere' : h.target.label;
        let entry = list.find((e) => e.key === key);
        if (!entry) {
          entry = { key, name: (h.target.ref && h.target.ref.name) || '', hits: [] };
          list.push(entry);
        }
        const id = `${h.kind}|${h.rank}|${page}`;
        if (!entry.hits.some((x) => x.id === id)) {
          entry.hits.push({ id, kind: h.kind, rank: h.rank, page, label: h.label });
        }
      }
      saveRun(run);
    }

    lastHosts = [...hostsSeen].sort();

    paintTopPagination();
    renderPanel(sections, hits, run);
    document.dispatchEvent(new CustomEvent(`${NS}:painted`));
  }

  /* Top pagination, built from scratch rather than cloned.
   *
   * Earlier versions tried to find Google's bottom pagination bar and clone it
   * up top. That broke constantly: the bar is a div[role="navigation"], not a
   * <nav>; its classes shuffle between layouts; and on some result types it is
   * absent outright. None of that fragility is necessary, because the one thing
   * about Google search that has not changed in a decade is the URL scheme:
   * page N of a query is the same URL with start=(N-1)*num. So the bar here is
   * ours - plain <a href> links we generate ourselves, no dependency on
   * Google's DOM beyond an insertion point above the first result. */
  function paintTopPagination() {
    const existing = document.querySelector(`#${NS}-pagination-top`);
    if (!cfg.showPaginationTop || isMaps) {
      if (existing) existing.remove();
      return;
    }

    /* Only meaningful on an actual query page. */
    if (!queryKey()) {
      if (existing) existing.remove();
      return;
    }

    const per = parseInt(new URLSearchParams(location.search).get('num') || '10', 10) || 10;
    const page = currentPage();

    if (existing) {
      /* Right bar for this page already in place, and still attached above a
       * result. Google rerenders parts of the page after load, which can strand
       * the bar in a detached subtree - rebuild if so. */
      if (existing.isConnected && existing.dataset.page === String(page)) return;
      existing.remove();
    }

    /* Insertion point: directly above the first organic result, wherever the
     * results actually live on this layout. No first result, no bar - an
     * empty or non-web results page has nothing to paginate over. */
    const root = resultsRoot();
    if (!root) return;
    const h3 = root.querySelector('h3');
    const firstResult =
      (h3 && h3.closest('div.MjjYud, div.g, div[data-sokoban-container]')) ||
      root.querySelector('div.g, [data-sokoban-container]');
    if (!firstResult || !firstResult.parentElement) return;

    const urlFor = (p) => {
      const u = new URL(location.href);
      if (p <= 1) u.searchParams.delete('start');
      else u.searchParams.set('start', String((p - 1) * per));
      return u.toString();
    };

    const bar = document.createElement('div');
    bar.id = `${NS}-pagination-top`;
    bar.className = `${NS}-pagetop`;
    bar.dataset.page = String(page);
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Page navigation (SERP Counter)');

    const addLink = (label, p, extraClass) => {
      const a = document.createElement('a');
      a.textContent = label;
      a.href = urlFor(p);
      a.className = `${NS}-pagetop-link${extraClass ? ' ' + extraClass : ''}`;
      bar.appendChild(a);
    };

    if (page > 1) addLink('‹ Prev', page - 1, `${NS}-pagetop-nav`);

    /* Seven page links in a window that slides with the current page: two
     * behind, four ahead. Deep in the results the early pages drop away
     * rather than pinning the bar to 1-7. */
    const first = Math.max(1, page - 2);
    for (let p = first; p < first + 7; p++) {
      if (p === page) {
        const s = document.createElement('span');
        s.textContent = String(p);
        s.className = `${NS}-pagetop-link ${NS}-pagetop-current`;
        s.setAttribute('aria-current', 'page');
        bar.appendChild(s);
      } else {
        addLink(String(p), p);
      }
    }

    addLink('Next ›', page + 1, `${NS}-pagetop-nav`);

    firstResult.parentElement.insertBefore(bar, firstResult);
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
    const aiMod = findAiModule();
    const desc = (el) =>
      el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(' ').slice(0, 3).join('.')}` : null;
    const report = {
      url: location.href,
      offset: pageOffset(),
      modules: { lsa: desc(lsaMod), local: desc(localMod), ai: desc(aiMod) },
      localHeading: localMod
        ? textOf(localMod.querySelector('h2, h3, [role="heading"]')).slice(0, 60)
        : null,
      isAiModePage: isAiModePage(),
      counts: {
        organic: organicResults([lsaMod, localMod].filter(Boolean)).length,
        ads: adResults().length,
        local: localPackResults(localMod).length,
        lsa: lsaResults(lsaMod).length,
        maps: mapsResults().length,
        ai: aiResults(aiMod).length,
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
        if (t && t.closest && t.closest(`#${NS}-panel, .${NS}-badge, .${NS}-gbp, #${NS}-pagination-top`))
          continue;
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

  // --------------------------------------------------------------- styling

  function clamp255(n) {
    return Math.max(0, Math.min(255, n));
  }

  /* Lighten (positive) or darken (negative) a #rrggbb by a 0-1 fraction toward
   * white or black. Used to turn the one colour someone picks in settings into
   * the same three-stop gradient look every badge already has, rather than
   * flattening the badges to a single flat fill. */
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255,
      g = (n >> 8) & 255,
      b = n & 255;
    const toward = amount < 0 ? 0 : 255;
    const p = Math.abs(amount);
    r = clamp255(Math.round((toward - r) * p) + r);
    g = clamp255(Math.round((toward - g) * p) + g);
    b = clamp255(Math.round((toward - b) * p) + b);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  const HEX_RE = /^#[0-9a-f]{6}$/i;

  /* Push the user's chosen colours, bubble shape and font onto :root as CSS
   * custom properties. serp.css reads these with the Gilmedia defaults as the
   * fallback, so a page that never touched settings renders identically to
   * before this existed. */
  function applyStyle(style) {
    const s = { ...DEFAULT_STYLE, ...(style || {}) };
    const colors = { ...DEFAULT_STYLE.colors, ...(s.colors || {}) };
    const root = document.documentElement;

    for (const key of Object.keys(DEFAULT_STYLE.colors)) {
      const hex = HEX_RE.test(colors[key]) ? colors[key] : DEFAULT_STYLE.colors[key];
      root.style.setProperty(`--gil-c-${key}-1`, shade(hex, 0.28));
      root.style.setProperty(`--gil-c-${key}-2`, hex);
      root.style.setProperty(`--gil-c-${key}-3`, shade(hex, -0.22));
    }

    const fontSize = Number(s.fontSize);
    root.style.setProperty('--gil-font-size', `${Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_STYLE.fontSize}px`);
    root.style.setProperty('--gil-font-family', s.fontFamily || DEFAULT_STYLE.fontFamily);

    for (const v of ['circle', 'rounded', 'square', 'pill']) {
      root.classList.remove(`${NS}-variant-${v}`);
    }
    root.classList.add(`${NS}-variant-${['circle', 'rounded', 'square', 'pill'].includes(s.bubble) ? s.bubble : 'circle'}`);
  }

  // ------------------------------------------------------------------ boot

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    cfg = { ...DEFAULTS, ...stored };
    applyStyle(cfg.style);
    scan();
    watch();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, v] of Object.entries(changes)) cfg[k] = v.newValue;
    if (changes.style) applyStyle(cfg.style);
    scan();
  });
})();
