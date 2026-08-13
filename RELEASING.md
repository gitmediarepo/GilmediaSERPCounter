# Releasing

Every version ships from a git tag. Bump the manifest, tag it, push the tag. The
workflow in `.github/workflows/release.yml` runs the tests, builds both zips,
publishes the GitHub release, and submits to the Chrome Web Store.

## The two zips, and why

They are not interchangeable and mixing them up wastes a review cycle.

| Zip | Shape | For |
|---|---|---|
| `dist/serp-counter-store-v<version>.zip` | `manifest.json` at the archive root | Chrome Web Store upload |
| `dist/gilmedia-serp-counter-v<version>.zip` | everything nested in one folder | GitHub release, for Load unpacked |

The store rejects a nested archive with "manifest file is missing or unreadable".
Sideloading a flat one dumps eleven files into whatever folder you unzipped into.
Hence two builders.

## Shipping a version

```bash
# 1. bump the version in manifest.json, single source of truth
# 2. sanity check locally
npm install --no-save jsdom
for f in test/*.test.js; do node "$f"; done
node build/store-package.js

# 3. commit, tag, push
git commit -am "What changed"
git tag v1.8.0
git push origin main --tags
```

The workflow refuses to run if the tag and the manifest version disagree, which
is the mistake that actually happens.

## First submission is manual

The API can only update an item that already exists. The first one has to go
through the console at
[chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole),
because that is where the item id is minted and where the listing text, the
graphics and the privacy answers live. Every field is written out in
`STORE-LISTING.md`. After that, `git push --tags` handles it.

Listing text and screenshots are never touched by the API. Change those by hand
in the console.

## Wiring up automatic store submission

Four repo secrets, minted once. Until they exist the workflow simply skips the
store step and still publishes the GitHub release.

1. Create a Google Cloud project and enable the **Chrome Web Store API**.
2. Create an **OAuth client ID** of type **Desktop app**. Note the client id and
   secret.
3. Add yourself as a test user on the OAuth consent screen, then mint a refresh
   token once. Open this in a browser, signed in as the developer account:

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&scope=https://www.googleapis.com/auth/chromewebstore
   ```

   Approve it, then copy the `code` value out of the URL you get redirected to
   and exchange it:

   ```bash
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET \
     -d code=THE_CODE \
     -d grant_type=authorization_code \
     -d redirect_uri=http://localhost
   ```

   The `refresh_token` in the response is the one that matters. It does not
   expire on its own, but it dies if the account password changes or access is
   revoked.

4. Add four secrets under Settings, Secrets and variables, Actions:

   | Secret | Value |
   |---|---|
   | `CWS_CLIENT_ID` | from step 2 |
   | `CWS_CLIENT_SECRET` | from step 2 |
   | `CWS_REFRESH_TOKEN` | from step 3 |
   | `CWS_ITEM_ID` | the 32 characters in the item's console URL |

To publish from your own machine instead, set the same four as environment
variables and run `node build/publish-store.js`. Add `--draft` to upload without
submitting, so you can look at it in the console first.

## After submission

Review takes days, not hours, and anything that runs on Google's own search
pages gets a closer human read. That is a timing problem, not a policy one.
Google emails the verdict either way.
