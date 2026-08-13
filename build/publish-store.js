#!/usr/bin/env node
/* Uploads the store zip to the Chrome Web Store and submits it for review.
 *
 * Only ever touches an item that already exists. The very first submission has
 * to be done by hand in the developer console, because that is where the item
 * id is minted and where the listing text, graphics and privacy answers are
 * entered. After that, every version can ship from here.
 *
 * Credentials, all four required, from the environment:
 *   CWS_CLIENT_ID        OAuth client id (Desktop app type)
 *   CWS_CLIENT_SECRET    OAuth client secret
 *   CWS_REFRESH_TOKEN    refresh token minted once, see RELEASING.md
 *   CWS_ITEM_ID          32-char item id from the item's console URL
 *
 * Run: node build/publish-store.js [--draft]
 *   --draft uploads the new package but leaves it unpublished, so you can eyeball
 *   it in the console before submitting.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRAFT = process.argv.includes('--draft');

const env = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_ITEM_ID'];
const missing = env.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing credentials: ' + missing.join(', '));
  console.error('See RELEASING.md for how to mint them once.');
  process.exit(1);
}

const ITEM_ID = process.env.CWS_ITEM_ID;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const ZIP = path.join(ROOT, 'dist', `serp-counter-store-v${manifest.version}.zip`);

if (!fs.existsSync(ZIP)) {
  console.error(`No package at ${ZIP}. Run: node build/store-package.js`);
  process.exit(1);
}

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CWS_CLIENT_ID,
      client_secret: process.env.CWS_CLIENT_SECRET,
      refresh_token: process.env.CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function upload(token) {
  const res = await fetch(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${ITEM_ID}?uploadType=media`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
      body: fs.readFileSync(ZIP),
    }
  );
  const body = await res.json();
  /* The API answers 200 with uploadState FAILURE for things like a version that
   * is not higher than the published one, so status alone proves nothing. */
  if (body.uploadState !== 'SUCCESS') {
    throw new Error(`Upload rejected: ${JSON.stringify(body.itemError || body)}`);
  }
  return body;
}

async function publish(token) {
  const res = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${ITEM_ID}/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-api-version': '2',
      'Content-Length': '0',
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Publish failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

(async () => {
  console.log(`item ${ITEM_ID}, version ${manifest.version}`);
  const token = await accessToken();

  console.log(`uploading ${path.basename(ZIP)} (${(fs.statSync(ZIP).size / 1024).toFixed(1)} KB)`);
  await upload(token);
  console.log('upload accepted');

  if (DRAFT) {
    console.log('draft mode: left unpublished, submit it in the console when ready');
    return;
  }

  const result = await publish(token);
  console.log(`submitted: ${(result.status || []).join(', ') || 'ok'}`);
  for (const detail of result.statusDetail || []) console.log('  ' + detail);
  console.log('Review usually takes days, not hours. Google emails the verdict.');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
