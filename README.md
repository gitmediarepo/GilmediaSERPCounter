<div align="center">

# Gilmedia SERP Counter

**Google restarts result numbering on every page. This fixes that.**

Page 3 looks like 1-10 when it is really 21-30. This extension numbers every result by its true rank, and marks your clients in green wherever they appear: organic, Ads, the local pack, Local Services Ads and Maps.

### [→ Install guide](https://gitmediarepo.github.io/GilmediaSERPCounter/)

[Download](https://github.com/gitmediarepo/GilmediaSERPCounter/releases/latest) · [Install](#install) · [Setup](#setup) · [How it works](#how-it-works) · [Limits](#known-limits)

</div>

---

## What it does

| Surface | Numbering | Matched by |
|---|---|---|
| Organic results | True rank, continuing across pages (21, 22, 23...) | Domain |
| Google Ads | Its own scale (Ad 1, Ad 2) | Domain |
| Local pack | Its own scale (Map 1, Map 2) | Business name, or domain via the website link |
| Local Services Ads | Its own scale (LSA 1, LSA 2) | Business name |
| Google Maps | Position in the results feed | Business name |

Paid, local and organic each count on their own scale, so an ad block at the top never shifts your organic numbers. Badges are circular, colour-coded by surface, and non-organic ones carry a small type tag so a violet 2 is never mistaken for an organic 2.

## Load your whole client list

Paste every client you manage into the popup, one per line, and each search tells you which of them showed up. Nothing to select, nothing to switch between.

```
walmart.com | Walmart
starbucks.com | Starbucks
timhortons.com | Tim Hortons

# The business name is OPTIONAL.
# A domain on its own matches organic results and Ads:
yelp.com

# A name on its own matches the local pack, LSA and Maps:
Home Depot

# Lines starting with # are ignored
```

The separator can be a pipe, a comma or a tab, so a paste straight out of a spreadsheet works untouched. Padding spaces are ignored and the two columns can be in either order.

**The business name is optional.** Give one or both, depending on what you need to catch:

- The **domain** alone matches organic results and Ads. Subdomains match automatically, so `example.com` also catches `shop.example.com`.
- The **name** alone matches the local pack, Local Services Ads and Maps, where Google prints a business name instead of a URL.
- **Both** covers every surface, which is what you want for most clients.

### What the panel shows

Every client that appears gets its own row, listing **all** of its positions across every surface at once:

```
4 of 60 clients on this page

walmart.com
Walmart              [12] [Map 1]

timhortons.com
Tim Hortons          [14]

starbucks.com
Starbucks            [16] [Ad 2]

yelp.com             [Map 3]
```

Best position sorts to the top. Position chips are colour-coded by surface, matching the badge on the result itself. The list scrolls inside the panel, so a busy search with a dozen matches never runs off the bottom of the screen.

Clients that did not appear are left out entirely, because with a full roster loaded the misses would bury the hits. When none of them appear you get a single line saying so, with a **why?** link that prints every domain on the page to the console.

Use **Clear list** in the popup to wipe the roster. It asks for a second click first, since there is no undo.

The **copy** button puts a one-line summary on the clipboard:

```
"windows toronto" -> example.com: organic 24, ad 2, local 2
```

That drops straight into an email, a report or a ticket.

## Install

Not on the Chrome Web Store. Load it directly, which takes about 30 seconds.

There is a [walkthrough with screenshots](https://gitmediarepo.github.io/GilmediaSERPCounter/) if you prefer it visual.

1. **Download** the latest [release zip](https://github.com/gitmediarepo/GilmediaSERPCounter/releases/latest) (or clone this repo) and unzip it.
2. Put the folder somewhere permanent on a **local** drive. Chrome re-reads extension files constantly, so a network drive or a synced cloud folder will make it crawl.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode** with the toggle in the top right.
5. Click **Load unpacked** and select the unzipped folder, the one containing `manifest.json`.
6. Pin the orange G icon to your toolbar.

To update later, replace the folder contents and click the refresh arrow on the extension's card.

Works in any Chromium browser: Chrome, Edge, Brave, Opera, Arc.

## Setup

Click the icon, paste your list into the box and hit **Save list**. The counter in the header confirms how many clients it parsed.

Your list syncs through your own Chrome profile, so it follows you to any machine you sign into. Add competitors alongside clients and one search shows you both.

## How it works

Google puts the result offset in the URL as `start`, so `&start=20` means the first result on screen is really number 21. The extension reads that offset and numbers from there instead of from 1.

Detection is **structural** rather than based on Google's class names: it looks for a heading inside a link inside the results column, then walks up to the containing result block. Google rewrites its markup regularly and anything keyed to class names breaks within months. This approach survives most redesigns.

Each surface is found as a **whole module first**, then rows are read from inside it. The Local Services block and the "Businesses" block are located as units, and every later pass excludes them. Without that, an LSA card gets counted as a map result because it happens to link to Maps, and an ordinary organic result gets counted as one because it happens to carry a heading role. Map means everything under the Businesses heading and nothing else.

When a module genuinely cannot be found, that section reports zero rather than scattering badges over whatever loosely matched.

Nothing leaves your browser. There is no backend, no analytics, no network request of any kind. The only permission requested is `storage`, used to save your tracked domains locally.

## Known limits

- **This is not a rank tracker.** Google personalises and localises results, so this reports what *your* browser sees from *your* location while signed into *your* account. Use it for spot checks, client calls and quick competitive looks, not for trend reporting.
- **Google changes its HTML without notice.** Structural detection survives most of it, but if numbering ever looks wrong, the fix lives in `src/content.js` under the detection section.
- **LSA detection** keys off links to `localservices.google.com`. Some layouts render Local Services Ads without those links and will be missed.
- **Continuous scroll** appends results to the same page. Numbering follows along, but the `start` offset only exists on classic paginated results, so the count stays relative to whichever page you began on.

## Development

```bash
node build/make-icons.js     # regenerate the PNG icons, no image editor needed
node test/numbering.test.js  # numbering and detection (needs jsdom)
node test/modules.test.js    # LSA vs Businesses vs organic separation
node test/clients.test.js    # client list parsing and panel behaviour
```

If the local pack is ever missed, tick **Log detection to the console** in the popup, reload the search, and run `__gilSerpDiag()` in DevTools. It prints what every detection strategy matched plus sample markup, which turns a selector fix into a five-minute job instead of guesswork. 

The test builds a fake results page using the shapes Google actually ships, then asserts that `start=20` produces ranks 21-30, that Ads and the local pack count on their own scales, and that a tracked domain is marked at the right position. Run it after touching any selector.

```
manifest.json           MV3 manifest, host permissions per Google ccTLD
src/content.js          detection, numbering, highlighting, summary panel
src/serp.css            badge and panel styles
src/popup.html/.js      client list, display toggles
build/make-icons.js     generates icons/*.png from code
test/numbering.test.js  jsdom assertions on numbering and detection
test/modules.test.js    locks LSA, Businesses and organic apart
test/clients.test.js    jsdom assertions on list parsing and the panel
docs/index.html         the install guide page
```

## Privacy

No data collection. No telemetry. No external requests. Your tracked domains are stored in Chrome's own sync storage and never sent anywhere.

## License

MIT. See [LICENSE](LICENSE).

Built by [Gilmedia](https://www.gilmedia.com).
