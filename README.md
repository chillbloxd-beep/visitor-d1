# Cloudflare D1 Visitor Analytics — Fresh Build

A standalone visitor analytics system built from scratch with Cloudflare Workers and D1.

This package does **not** connect to, inspect, import from, replace, or modify Supabase or any other existing database. The D1 database begins empty and receives only new analytics events after deployment.

## Included

- Anonymous returning-visitor detection
- Sessions and live presence
- Page views and SPA route tracking
- Landing and exit pages
- Page duration and active time
- Scroll depth and milestone events
- UTM campaign and referrer attribution
- Browser, OS, device and viewport details
- Cloudflare country, region, city, ASN, colo, HTTP and TLS metadata
- Custom events, outbound-link clicks and downloads
- Optional percentage-based click heatmap events
- Web performance metrics such as TTFB, LCP, CLS and INP
- JavaScript error and unhandled-rejection reporting
- Optional internal application user IDs
- Optional precise geolocation only after explicit browser permission
- Protected admin dashboard
- Conversion funnel endpoint
- Automatic retention cleanup

The system intentionally does not collect raw IP addresses, passwords, form contents, cookies, authorization headers, keystrokes, clipboard contents, payment information, full session recordings or cross-site fingerprints.

## One-command GitHub Codespaces setup

### Option A — API-token authentication

Add these GitHub Codespaces secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Create or rebuild the Codespace and run:

```bash
npm run setup
```

### Option B — Cloudflare OAuth login

Leave the token secrets unset and run:

```bash
npm run setup
```

The setup script checks `wrangler whoami` and launches:

```bash
npx wrangler login
```

when OAuth login is required.

## What setup does

`npm run setup`:

1. Authenticates with Cloudflare.
2. Creates or reuses an empty D1 database named `visitor-analytics-fresh`.
3. Writes the D1 binding into `wrangler.jsonc`.
4. Applies the analytics schema.
5. Generates an admin dashboard key and IP-hashing salt.
6. Deploys the Worker and static assets.

It never checks for external databases and never imports old analytics data.

To force a different blank database name:

```bash
D1_DATABASE_NAME="my-new-analytics-db" npm run setup
```

Use a name that does not already exist when you want a completely separate empty D1 database.

## Dashboard

After deployment, open:

```text
https://YOUR-WORKER.workers.dev/dashboard.html
```

The generated dashboard key is saved locally in:

```text
.generated-secrets.json
```

That file is ignored by Git and must not be committed.

## Install the tracker

Add the tracker once in the root HTML or application shell:

```html
<script
  src="https://YOUR-WORKER.workers.dev/tracker.js"
  data-endpoint="https://YOUR-WORKER.workers.dev/api">
</script>
```

Optional settings:

```html
data-auto-track="true"
data-clicks="true"
data-heatmap="false"
data-performance="true"
data-errors="true"
data-heartbeat-ms="25000"
data-idle-ms="60000"
```

### Custom event

```js
visitorAnalytics.track(
  "signup_completed",
  { plan: "free" },
  "conversion"
);
```

### Identify a logged-in user

Use an internal application ID, not an email address:

```js
visitorAnalytics.identify("user_8f4c1d");
```

### Optional precise location

Call this only after a clear user action:

```js
document.querySelector("#share-location").addEventListener("click", async () => {
  const result = await visitorAnalytics.requestPreciseLocation();
  console.log(result);
});
```

The website must continue working when location is refused.

## Restrict collection to your website

Change `ALLOWED_ORIGINS` in `wrangler.jsonc`:

```json
"vars": {
  "ALLOWED_ORIGINS": "https://example.com,https://www.example.com",
  "RETENTION_DAYS": "180"
}
```

Then deploy again:

```bash
npm run deploy
```

## Verify

```bash
npm run check
npm run dev
```
