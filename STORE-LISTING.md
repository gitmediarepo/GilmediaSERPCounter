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
You know the drill. You search for the thing you sell, you don't see yourself on page one, so you click through to page two and start counting down the screen with your finger. One, two, three. Hang on, was that 14 or 15?

Google restarts the numbering on every page. Page three shows you 1 through 10. Those are really 21 through 30. Finger-counting is how the wrong number ends up in a report.

This fixes that. Every result gets its actual position, and anything on your list turns green.

WHO IT IS FOR

Checking your own site
Add your domain once and stop squinting. You get your real position instead of a guess. If you are on page four, you will know you are on page four, which is useful even when it stings.

Running a business
Add your domain and your business name. The name matters, because the map results show a business name and not a website. So you can see where you actually turn up when someone searches for what you do, in the local pack, in the ads, and in the ordinary results.

Running an agency
Paste in the whole client roster. Sixty lines is fine. Search once and the panel tells you which of your clients showed up and where, so you are not switching between profiles or keeping a spreadsheet open on the second monitor. Only the ones that actually appeared get listed, so you get a short answer rather than sixty rows of "nope".

HOW THE LIST WORKS

One client per line:

    example.com | Example Company
    anotherexample.com | Another Company

The business name is optional. A domain on its own matches the ordinary results and the ads. A name on its own matches the local pack, Local Services Ads and Maps, where the listing shows a business name instead of a web address. Give both and you are covered everywhere.

WHAT IT COUNTS

Organic results, numbered straight through. 21, 22, 23, not back to 1.
Ads, counted separately, so a stack of them at the top does not shove your organic numbers around.
The local pack, on its own count.
Local Services Ads, on their own count.
Google Maps results.

Each type gets its own colour, so a paid position never gets mistaken for an organic one. That particular mix-up has made it into a client report before. Possibly yours.

THE LOG KEEPS RUNNING

Click to page two, then page three, and it remembers. You get one running answer for that search instead of fresh amnesia every time you click next. Change the search term and it clears itself.

One click copies the whole run to your clipboard when you want to paste it into an email.

LISTS GO IN AND OUT

Export your list to a file, hand it to a colleague, import theirs. Importing merges instead of overwriting, so nobody's list gets flattened by accident.

THE HONEST BIT

This is not a rank tracker, and it would be a bit rich to pretend otherwise. Search results are personalised by location and by whoever is signed in, so what you see is what your browser sees, from where you happen to be sitting. Ideal for a quick check or a client call. If you need clean trend data over months, get a proper rank tracker.

It also will not change your rankings. It counts them. That is the entire job.

PRIVACY, BRIEFLY

No account. No analytics. No tracking of any kind. It makes no network requests at all, largely because there is nothing on the other end to talk to. Your list is saved in your own browser, and the only permission it asks for is storage, so it can remember that list between sessions. The source code is public if you would rather check than take our word for it.

Not affiliated with, endorsed by, or sponsored by Google.

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

All built and sitting in `assets/`. Sizes and colour depth already match what the
upload panel demands, so nothing needs converting.

| Asset | Spec | File |
|---|---|---|
| Store icon | 128x128 canvas, 96x96 artwork, 16px transparent padding | `store-icon-128.png` |
| Screenshot | 1280x800, 24-bit PNG, no alpha | `store-screenshot-1.png`, `store-screenshot-2.png` |
| Small promo tile | 440x280, 24-bit PNG, no alpha | `store-tile-440x280.png` |
| Marquee promo tile | 1400x560, 24-bit PNG, no alpha | `store-marquee-1400x560.png` |

The store icon is NOT the one in `icons/`. Those are full-bleed because a
16-pixel toolbar button cannot afford to throw away a quarter of itself to
padding. The store wants the opposite. `node build/make-store-icon.js` builds
the store version; `node build/make-icons.js` builds the toolbar set. Same mark
from the same source, two canvases.

Do not upload `bg-wide.png` or `bg-marquee.png`. Those are the raw generated
backgrounds the finished graphics were composited on top of.

---

## Before you upload

1. Complete the trader declaration in the developer console.
2. Set the publisher display name to Gilmedia and the website to https://www.gilmedia.com/.
3. Upload `dist/serp-counter-store-v<version>.zip`, built by `node build/store-package.js`. Note this is a DIFFERENT zip from the GitHub release: the store requires manifest.json at the root of the archive, and a nested folder is rejected.
4. Expect manual review and allow longer than a few days. Anything that runs on Google's own search pages gets closer human scrutiny as a matter of practice, even with zero host_permissions declared. That is not a policy problem, just a timing one.
5. Keep "Google" mentions in the description at or below 5. The listing policy treats unnatural repetition beyond that as keyword spam. It currently sits at 3.
