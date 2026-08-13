# Chrome Web Store listing - copy and paste

Everything the developer console asks for, written out. Not published to the repo site; this is a working document.

---

## Store listing tab

**Extension name** (45 max)
```
Gilmedia SERP Counter
```

**Short description** (132 max, this is the manifest description and cannot differ)
```
Numbers Google results by true rank across pages and highlights your whole client list in organic, Ads, local pack and Maps.
```

**Category:** Workflow & Planning
**Language:** English (United Kingdom)

**Detailed description**
```
Google restarts result numbering on every page. Page 3 shows you 1 through 10 when those are really positions 21 through 30, and counting down the screen with a finger is how mistakes get into client reports.

SERP Counter numbers every result by its true rank, and highlights the sites you care about wherever they turn up.

WHAT IT NUMBERS

- Organic results, continuing across pages: 21, 22, 23 rather than starting over
- Google Ads, on their own scale, so a paid block never shifts your organic count
- The local pack, on its own scale
- Local Services Ads, on their own scale
- Google Maps results

Paid, local and organic are counted separately and colour-coded, so nothing contaminates anything else.

LOAD YOUR WHOLE LIST AT ONCE

Paste in every domain you track, one per line:

    example.com | Example Company
    anotherexample.com | Another Company

The business name is optional. A domain on its own matches organic results and Ads. A name on its own matches the local pack, Local Services Ads and Maps, where Google prints a business name instead of a URL.

Only the sites that actually appear show up in the summary panel. Sixty domains loaded and one on the page gives you one line, not sixty.

THE LOG KEEPS RUNNING

Click through to page 2, then page 3, and findings accumulate into one cumulative answer for that search term rather than resetting each time. It clears itself when you change the search.

One click copies the whole run to your clipboard, ready to drop into an email or a report.

IMPORT AND EXPORT

Export your list as a file to share with colleagues. Import merges rather than overwriting, so re-importing the same file changes nothing.

HONEST ABOUT WHAT IT IS NOT

This is not a rank tracker. Google personalises and localises results, so it reports what your browser sees, from your location, signed into your account. Use it for spot checks, client calls and quick competitive looks. For trend data over time you still want a proper rank tracking tool.

PRIVACY

No data collection. No analytics. No network requests of any kind. There is no server to send anything to. The only permission requested is storage, used to remember your own list. The full source code is public.

Built by Gilmedia. https://www.gilmedia.com/
```

**Homepage URL**
```
https://gitmediarepo.github.io/GilmediaSERPCounter/
```

**Support URL**
```
https://github.com/gitmediarepo/GilmediaSERPCounter/issues
```

---

## Privacy tab

**Single purpose description**
```
The extension has one purpose: to annotate Google search results pages with each result's true rank position and to highlight results belonging to a user-supplied list of domains and business names.
```

**Permission justifications**

`storage`
```
Used to save the user's own list of domains and business names, plus their display preferences, so these persist between browsing sessions. Nothing else is stored and nothing is transmitted.
```

Content script host access (Google search and Maps only)
```
The extension declares no host_permissions at all. It uses a statically declared content script whose match patterns cover only Google search and Google Maps result pages. It needs to read the results page in order to count results and identify which of them belong to the user's own list. It runs on no other website, makes no network requests, and nothing read from the page ever leaves the browser.
```

**Remote code:** No, I am not using remote code.
Justification if asked:
```
All JavaScript is contained in the package. No code is fetched, evaluated or executed from any remote source.
```

**Data usage declarations** - tick nothing except:
- Website content: the extension reads the page in order to function, but does not collect, transmit or store it.

Then tick all three certification boxes:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
```
https://gitmediarepo.github.io/GilmediaSERPCounter/privacy.html
```

---

## Distribution tab

- **Visibility:** Public
- **Distribution:** All regions (or restrict to Canada, US, UK if you would rather keep the audience narrow)
- **Pricing:** Free

---

## Graphic assets required

| Asset | Size | Required |
|---|---|---|
| Store icon | 128x128 PNG | Yes, already in the package |
| Screenshot | 1280x800 PNG | Yes, at least 1, up to 5 |
| Small promo tile | 440x280 PNG | Yes |
| Marquee promo tile | 1400x560 PNG | Optional, needed for featuring |

---

## Before you upload

1. Complete the trader declaration in the developer console.
2. Set the publisher display name to Gilmedia and the website to https://www.gilmedia.com/.
3. Upload `dist/serp-counter-store-v<version>.zip`, built by `node build/store-package.js`. Note this is a DIFFERENT zip from the GitHub release: the store requires manifest.json at the root of the archive, and a nested folder is rejected.
4. Review typically takes a few days. Broad host permissions get a closer look, which is why the justification above spells out that the extension runs only on Google search pages.
