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

## The item

Item id `npcppehliipnbkhejhioiigakkbjfbfg`, first submitted 13 August 2026 at
version 1.7.0. Console:
`https://chrome.google.com/webstore/devconsole/`

Do not push a new tag while a submission is still pending review. Uploading a
new package replaces the one in the queue, which sends you to the back of it.
Wait for the verdict email first.

## First submission is manual

The API can only update an item that already exists. The first one has to go
through the console at
[chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole),
because that is where the item id is minted and where the listing text, the
graphics and the privacy answers live. Every field is written out in
`STORE-LISTING.md`. After that, `git push --tags` handles it.

Listing text and screenshots are never touched by the API. Change those by hand
in the console.

## Publishing from this machine

Already wired. Credentials were minted on 14 August 2026 and live outside the
repo at `Z:\Claude\projects\gilmedia\SERP-Counter\store\cws-oauth.json`.

```
node Z:\Claude\projects\gilmedia\SERP-Counter\scripts\publish-to-store.js
node Z:\Claude\projects\gilmedia\SERP-Counter\scripts\publish-to-store.js --draft
```

It rebuilds the store zip from the current manifest version, then uploads and
submits. `--draft` uploads without submitting.

If the refresh token ever dies (password change, revoked access), remint it:

```
node Z:\Claude\projects\gilmedia\SERP-Counter\scripts\mint-cws-token.js
```

It reuses the existing Gilmedia OAuth client rather than making a new one:
client `296984968971-fhi1duif...` on GCP project `claudecode-491119`, which
already has `http://localhost:8765/callback` as a registered redirect and has
the Chrome Web Store API enabled. Do not create a second client.

## Wiring up automatic store submission from CI

Four repo secrets. Until they exist the workflow simply skips the store step and
still publishes the GitHub release. The values are all in `cws-oauth.json`
already, so this is a copy-paste job, not a minting job. Neither Gilmedia PAT
carries the Actions Secrets permission, so they go in by hand at
[the repo secrets page](https://github.com/gitmediarepo/GilmediaSERPCounter/settings/secrets/actions).

The from-scratch route, only needed if the shared client is ever lost:

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
   | `CWS_ITEM_ID` | `npcppehliipnbkhejhioiigakkbjfbfg` |

To publish from your own machine instead, set the same four as environment
variables and run `node build/publish-store.js`. Add `--draft` to upload without
submitting, so you can look at it in the console first.

## After submission

Review takes days, not hours, and anything that runs on Google's own search
pages gets a closer human read. That is a timing problem, not a policy one.
Google emails the verdict either way.
