# Faulter

A professional, production-ready news website built with Next.js 15, TypeScript, and Tailwind CSS.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Pages

| Route | Description |
|-------|-------------|
| `/` | Homepage with hero, latest, trending, category sections |
| `/news/[category]/[slug]` | Full article page |
| `/category/[slug]` | Category listing with sort & pagination |
| `/search?q=...` | Full-text search |
| `/archive` | All articles grouped by month |
| `/bookmarks` | Saved articles (localStorage) |
| `/author/[slug]` | Author profile & articles |
| `/about` | Editorial mission, standards, team |
| `/contact` | Contact form |
| `/subscribe` | Newsletter signup |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/sitemap.xml` | XML sitemap |
| `/rss.xml` | RSS feed |

## Tech Stack

- **Next.js 15.3.2** — App Router, SSG, dynamic routes
- **TypeScript** — Full type safety
- **Tailwind CSS** — Utility-first styling
- **clsx** — Conditional classNames

## Features

- Dark / light mode with localStorage persistence
- Breaking news ticker
- Article bookmarks (localStorage)
- Reading progress bar
- Text size controls
- Newsletter signup
- Social share buttons
- Article JSON-LD schema
- Open Graph & Twitter card metadata
- XML Sitemap & RSS feed
- Fully responsive (mobile, tablet, desktop)
- Keyboard accessible navigation
- Semantic HTML throughout

## Project Structure

```
faulter/
├── app/                        # Next.js App Router pages
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Homepage
│   ├── news/[category]/[slug]/ # Article page
│   ├── category/[slug]/        # Category page
│   ├── search/                 # Search page
│   ├── archive/                # Archive page
│   ├── bookmarks/              # Saved articles
│   ├── author/[slug]/          # Author profile
│   ├── about/                  # About page
│   ├── contact/                # Contact page
│   ├── subscribe/              # Newsletter
│   ├── privacy/                # Privacy policy
│   ├── terms/                  # Terms of service
│   ├── sitemap.xml/            # Sitemap route
│   └── rss.xml/                # RSS route
├── components/
│   ├── articles/               # Article display components
│   ├── home/                   # Homepage sections
│   ├── layout/                 # Header, Footer, Sidebar
│   └── ui/                     # Reusable UI primitives
├── lib/                        # Data layer & utilities
│   ├── articles.ts             # Article data & queries
│   ├── authors.ts              # Author data
│   ├── categories.ts           # Category data
│   └── utils.ts                # Date/format helpers
└── types/                      # TypeScript types
    └── index.ts
```

## Replacing Mock Data with a CMS

The data layer in `lib/articles.ts`, `lib/authors.ts`, and `lib/categories.ts` uses
static mock data. To connect a real CMS (Sanity, Contentful, Prismic, etc.):

1. Replace the exported functions in `lib/articles.ts` with async fetch calls to your CMS API
2. Add `async`/`await` to the page components that call those functions
3. Update `generateStaticParams` to fetch slugs from the CMS
4. **Note on caching — read before assuming ISR is active:** every page in
   this app (`/`, `/news/[category]/[slug]`, `/author/[slug]`, `/archive`,
   `/category/[slug]`, `/article/[slug]`) is fully dynamic, not ISR. `app/layout.tsx`
   (the root layout, shared by every route) calls `headers()` on every request
   to read the CSP nonce. `headers()` is a Next.js Dynamic API and
   unconditionally forces full dynamic SSR regardless of any `revalidate`
   export on the page itself — adding `revalidate` to a page will not produce
   ISR here. To get real ISR (or safe edge caching) on these routes, the
   nonce-based CSP must first be replaced with a non-nonce strategy, or a
   provably per-visitor-safe caching layer must be added — see the
   comment blocks in `app/page.tsx`, `app/news/[category]/[slug]/page.tsx`,
   `app/author/[slug]/page.tsx`, `app/archive/page.tsx`,
   `app/category/[slug]/page.tsx`, `app/article/[slug]/page.tsx`, and
   `next.config.mjs` (search "Issue #5 fix") for the full explanation.
   `POST /api/revalidate` no longer pretends to invalidate an ISR cache that
   doesn't exist for these routes — see `app/api/revalidate/route.ts` for
   what it actually does and the `purgeEdgeCache()` extension point for
   wiring in real CDN-purge logic later.
   **No route in this app is currently edge-cached.** A previous version of
   this README and of `next.config.mjs`/`middleware.ts` described
   `Cache-Control: public, s-maxage=3600` headers being applied to these
   routes so a CDN could edge-cache them. That was removed: every one of
   these routes renders nonce-bearing HTML, and marking a per-request,
   nonce-bound response "public" tells shared caches (Cloudflare, corporate
   proxies, etc.) it is safe to replay that exact response — including its
   embedded nonce — to other visitors, which is not a property this app
   actually provides. See the corrected comment block above the `headers()`
   function in `next.config.mjs` and the "Issue #1 resolution" block in
   `middleware.ts` for the full rationale and the safe options for
   reintroducing edge caching in the future.

## Deployment

> **⚠️ Before going live — complete all three prerequisite steps below or the site will have broken functionality on first request.**

### 🚦 Pre-Launch Gate Checklist

Work through every item before declaring the deployment production-ready.  Items marked **BLOCKER** must be confirmed `✅` before the launch gate opens.

| # | Item | How to verify | Status |
|---|------|---------------|--------|
| 1 | **Atlas IP allowlist** — no `0.0.0.0/0` entry | Log into MongoDB Atlas → **Security → Network Access** → confirm the list contains only your egress IPs. Set `ATLAS_IP_RESTRICTED=true` in the deployment env to confirm. | **BLOCKER** — manual dashboard check required |
| 2 | **`ATLAS_IP_RESTRICTED=true`** set in env | `npm run build` (via `check-env.mjs`) will error if this is missing with `DATABASE_URL` present | Auto-enforced by `scripts/check-env.mjs` |
| 3 | **MongoDB indexes created** | Run `npx tsx scripts/create-indexes.ts` once against the Atlas cluster | Manual one-time step |
| 4 | **Resend sender domain verified** | Resend dashboard → Domains → status must be `Verified` | Manual check |
| 5 | **Upstash Redis configured** (serverless) | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set in env | Required on Vercel; see [Rate Limiting](#️-rate-limiting--required-reading-before-launch) |
| 6 | **Cloudflare Cache Bypass rule** active | `curl -v https://yourdomain/api/newsletter` must return `CF-Cache-Status: BYPASS` | See [Cloudflare section](#️-cloudflare-cache-bypass--required-before-launch) |
| 7 | **`SVG_CDN_TICKET`** — not `UNTRACKED` if CMS/upload work is beginning | `grep "SVG_CDN_TICKET" next.config.mjs` | Only a blocker if remotePatterns or CMS work has begun |
| 8 | **Vercel region matches Atlas cluster region** | Compare `regions` in `vercel.json` against your Atlas cluster’s AWS region — see [Vercel Function Region](#vercel-function-region--latency-optimisation) below | Manual check — update `vercel.json` if they differ |
| 9 | **`npm run build` passes** with no errors or warnings | Run locally or in CI | Auto-enforced |

> **M-3 — Atlas IP allowlist (item 1) is the only launch blocker that cannot be enforced from code.**  The `ATLAS_IP_RESTRICTED=true` env flag is a confirmation token, not a security control — setting it does not itself restrict Atlas.  A team member must physically log into the Atlas dashboard and verify no `0.0.0.0/0` entry exists in **Security → Network Access** before this gate is cleared.

### Prerequisite 1 — Run MongoDB index setup (required, one-time, idempotent)

Run this **once** against your Atlas cluster after provisioning and **before** the first request hits the live site. It is safe to re-run on every deploy.

```bash
DATABASE_URL="mongodb+srv://user:pass@cluster.mongodb.net/faulter?retryWrites=true&w=majority" \
  npm run create-indexes
```

Without this step:
- The search page throws `MongoServerError` on every `$text` query (missing `article_text_search` index)
- Newsletter deduplication falls back to Resend only — duplicate subscribers can be written to the DB (missing `email_unique_ci` index)
- Contact form PII is never auto-purged — GDPR Art. 5(1)(e) violation (missing `contact_ttl_90d` TTL index)

See the [MongoDB Index Setup section](#-mongodb-index-setup--required-after-first-provisioning) for the full CI/CD integration example.

### Prerequisite 2 — Verify Resend sender domain

In the [Resend dashboard → Domains](https://resend.com/domains), verify the domain used in `RESEND_FROM_EMAIL` **before** enabling the newsletter or contact form in production.

An unverified domain causes every outbound email to silently fail with `domain_not_verified` — the subscriber is written to MongoDB but receives no confirmation email and no unsubscribe link (CAN-SPAM / GDPR Art. 17 compliance gap).

**Smoke test — run this after your first deploy:**

```bash
# Sends a real newsletter subscription — check your inbox AND Resend dashboard logs
curl -s -w "\nHTTP status: %{http_code}\n" \
  -X POST https://your-domain.com/api/newsletter \
  -H "Content-Type: application/json" \
  -d '{"email":"smoketest@your-verified-domain.com"}'
# Expected HTTP status: 200
# Then verify: welcome email arrived, unsubscribe link in that email works.
# If no email arrives, check Resend dashboard → Logs for domain_not_verified errors.
```

### Prerequisite 3 — Configure Upstash Redis (required on Vercel / serverless)

Without Upstash, rate limiting uses an in-process Map that resets on every cold start — providing zero protection on Vercel. Set the following in your **build and runtime** environment:

```
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxxxxxxxxxxxxxxxxxxxxxxxxxx
UPSTASH_CONFIGURED=true     ← set this only after both credentials above are set
```

See the [Rate Limiting section](#-rate-limiting--required-reading-before-launch) for the full explanation.

---

### ⚠️ Atlas IP Access List — Required Before Launch

**MongoDB Atlas clusters default to `0.0.0.0/0` (allow all IPs) in the free tier.** This must be restricted to your application server's IP range before going live. If left open, any credential leak (log line, leaked `.env` file, exposed environment variables) gives an attacker direct, unauthenticated access to your entire database.

**This is one of the most common causes of MongoDB data breaches.**

**To restrict the Atlas IP Access List:**

1. Log in to [https://cloud.mongodb.com](https://cloud.mongodb.com)
2. Select your Project → **Security** → **Network Access**
3. **Remove** the `0.0.0.0/0` entry if it exists (click the trash icon)
4. Click **Add IP Address** and add your application server's egress IP:

| Platform | What to add |
|---|---|
| **Vercel** | Add Vercel's egress IP ranges (found in Vercel docs → Deployment Protection → Firewall). Add each CIDR block individually. |
| **Self-hosted VPS / Docker** | Add the static public IP of your server (find it with `curl ifconfig.me` on the server) |
| **Coolify / Railway / Render** | Check the platform's docs for egress IP ranges and add each one |
| **Development only** | You may temporarily add your office/home IP — **never `0.0.0.0/0`** |

5. Confirm the change is saved and the cluster shows **no `0.0.0.0/0` entry**
6. Set `ATLAS_IP_RESTRICTED=true` in your deployment environment to confirm this step is complete

**Verify after configuration:**

```bash
# Connect using mongosh — this should succeed from your app server IP
mongosh "$DATABASE_URL" --eval "db.adminCommand({ ping: 1 })"

# This should FAIL from any IP not in the allowlist
# (verify from a separate machine not in the allowlist)
```

The pre-build script (`scripts/check-env.mjs`) will block the production build with a hard error if `ATLAS_IP_RESTRICTED` is not set to `"true"` when `DATABASE_URL` is present. This forces explicit confirmation before every production deploy.

> **Note:** `ATLAS_IP_RESTRICTED=true` is an acknowledgement token, not a secret — it has no cryptographic value. Setting it does not itself restrict Atlas access; it confirms you have done so manually in the Atlas dashboard.

> **Audit L-2 — INFRASTRUCTURE BLOCKER:** Whether `0.0.0.0/0` is absent from the Atlas Network Access dashboard cannot be verified from the codebase. `ATLAS_IP_RESTRICTED=true` is a required operator confirmation, but it is not a substitute for performing the configuration. Before launch, a team member must log into the Atlas dashboard and visually confirm that `0.0.0.0/0` is not present in **Security → Network Access**. Consider using Vercel's Private Network / VPC peering for the strongest isolation.

### Vercel (recommended)
```bash
npx vercel
```

### Self-hosted
```bash
npm run build
npm start
```

### ⚠️ Reverse-Proxy Body Size Limits — Required for Self-Hosted Deployments

`/api/contact`, `/api/newsletter`, `/api/csp-report`, and `/api/error-report` each enforce their own in-app byte cap on the request body (12 KB / 12 KB / 16 KB / 4 KB respectively — see the `MAX_BODY_BYTES` constant at the top of each route file). Those caps are enforced by streaming the body and aborting the read as soon as the limit is crossed (`lib/readBody.ts`), so an oversized request is never fully buffered in memory by this app.

**On Vercel**, the platform's own request-size ceiling (~4.5 MB) bounds worst-case memory regardless of the app-level cap, so no extra configuration is required.

**On a self-hosted deployment** (bare VPS, Docker, Fly.io, Railway, or any setup behind nginx/Caddy), there is no platform-level ceiling unless you configure one. Although this app's own streaming read prevents any single request from ballooning memory use, a reverse-proxy-level cap is still the correct place to reject oversized bodies — it stops the connection before bytes ever reach the Node process at all, and it protects every route uniformly (including any future route that forgets to add its own cap).

**nginx** — add a `client_max_body_size` directive scoped to these specific locations (slightly above each route's own cap is fine; the in-app check is still the authoritative limit):

```nginx
location /api/contact {
    client_max_body_size 16k;
    proxy_pass http://localhost:3000;
}

location /api/newsletter {
    client_max_body_size 16k;
    proxy_pass http://localhost:3000;
}

location /api/csp-report {
    client_max_body_size 20k;
    proxy_pass http://localhost:3000;
}

location /api/error-report {
    client_max_body_size 8k;
    proxy_pass http://localhost:3000;
}
```

**Caddy** — the equivalent is a `request_body` matcher with `max_size`:

```caddyfile
@oversized {
    path /api/contact /api/newsletter
    not request_body max_size 16kb
}
respond @oversized 413
```

Without a proxy-level cap, a client that streams an arbitrarily large body via `Transfer-Encoding: chunked` to any of these four routes is still only ever capped in-process at the configured `MAX_BODY_BYTES` per individual request — but many such requests in parallel, each within the per-IP rate limit window, can still add up across connections. The reverse-proxy cap closes that gap.

### ⚠️ Cloudflare Cache Eligibility — Required Before Launch

`next.config.mjs` sends correct `CDN-Cache-Control` / `Surrogate-Control` headers for every ISR and static route in this app (1 hour for content pages, 1 year for static assets, etc.). **That is necessary but not sufficient on its own.**

By default, Cloudflare does not cache HTML at all — caching eligibility is decided by file extension, and `.html` / extensionless document routes are excluded from that default list regardless of what `Cache-Control` headers the origin sends. Until a Cache Rule explicitly marks these routes **"Eligible for cache"**, every request to `/`, `/news/*`, `/article/*`, `/category/*`, `/tag/*`, `/author/*`, `/archive`, `/about`, `/privacy`, `/terms`, `/newsletter`, `/subscribe`, and `/contact` is a guaranteed edge `MISS`, and 100% of that traffic reaches Vercel origin compute no matter how correct the application code is.

**Apply the fix with Terraform (recommended) — see `infra/cloudflare/README.md` for full setup:**

```bash
cd infra/cloudflare
terraform init
terraform apply \
  -var="cloudflare_zone_id=<your zone ID>" \
  -var="cloudflare_api_token=<token scoped to Zone -> Cache Rules -> Edit>"
```

This same Terraform module also manages the `/api/*` bypass rule described in the next section, so the two can never drift out of sync. `infra/cloudflare/README.md` also documents manual dashboard and raw-API alternatives if you don't use Terraform.

**Verify the rule is active:**

```bash
curl -sI https://yourdomain.com/ | grep -i cf-cache-status
# First request: cf-cache-status: MISS (or EXPIRED)
# Second request within the TTL window: cf-cache-status: HIT
# A result of DYNAMIC or BYPASS on a repeat request means the rule is not in place — fix before launch.
```

> **Note:** This requirement is tracked as **Finding C-1 (Critical)** in the cache/CDN audit. The app-level code is correct; the CDN layer must be configured to honour it.

> **⚠️ `CLOUDFLARE_CACHE_RULES_APPLIED=true` is an acknowledgement, not proof (Audit MED-1).** `next.config.mjs` only checks that this variable is the literal string `"true"` at build time — it has no way to confirm the Terraform apply (or manual dashboard steps) actually succeeded. If you set this variable by hand to unblock a deployment without first confirming the Cache Rule is live (Cloudflare dashboard → Caching → Cache Rules — all four rules from `infra/cloudflare/README.md` present and enabled), the build gate passes but the site silently runs at **0% Cloudflare cache-hit ratio**: every request still reaches Vercel origin compute, you pay for that compute instead of getting Cloudflare's edge caching, and nothing in the build output tells you this happened. Prefer the automated workflow (`.github/workflows/cloudflare-cache-rules.yml`), which only sets this variable *after* verifying the rules are live via the Cloudflare API. If you must set it manually, always verify with the `curl` check above first. As a safety net, `.github/workflows/post-deploy-smoke.yml`'s `html-cache-eligibility` job re-checks `cf-cache-status: HIT`/`EXPIRED` on the home page after every push to `main` and on a weekly schedule — but that only catches the gap after a bad deploy has already shipped, not before.

### ⚠️ Cloudflare Cache Bypass — Required Before Launch

If your deployment sits behind Cloudflare (or any caching CDN), you **must** configure a cache bypass rule for `/api/*` before going live. (If you applied the Terraform module above, this is already handled — its first rule bypasses `/api/*` and `/search` explicitly, kept in the same resource as the eligibility rule above so they can't drift apart. The manual steps below are for dashboard-only setups.)

**Why this matters — `GET /api/csrf`**

The CSRF endpoint sets `Cache-Control: no-store` in its response, but that header alone is not sufficient when Cloudflare has a "Cache Everything" rule active. In that scenario Cloudflare caches the CSRF token at the edge and serves the same stale token to every user who hits that PoP. The double-submit check then fails for all users whose session cookie doesn't match the cached token — and in the worst case, a cached token from an earlier session could match a different user's cookie, which is the exact CSRF forgery the endpoint is meant to prevent.

**Required Cloudflare configuration (choose one):**

| Option | Where | Setting |
|--------|-------|---------|
| **A — Cache Rule** (recommended) | Cloudflare dashboard → Caching → Cache Rules | Match: `(http.request.uri.path matches "^/api/")` → Action: **Bypass cache** |
| **B — Page Rule** | Cloudflare dashboard → Rules → Page Rules | URL: `yourdomain.com/api/*` → Cache Level: **Bypass** |
| **C — Verify default** | Cloudflare dashboard → Caching → Configuration | Confirm "Default Cache Behavior" does **not** include a "Cache Everything" override that matches `/api/*` |

**Verify the rule is active (run this after every Cloudflare config change):**

```bash
curl -sI https://yourdomain.com/api/csrf | grep -i cf-cache-status
# Must output:  cf-cache-status: BYPASS
# A result of HIT or MISS means the rule is not in place — fix before launch.
```

Add this check to your deployment runbook and CI smoke-test suite. The `cf-cache-status` header is always present on proxied requests; a `BYPASS` value confirms Cloudflare is honouring the `Cache-Control: no-store` instruction.

> **Note:** This requirement is documented in the source at `app/api/csrf/route.ts` under the `M-8 fix` comment. The code is correct; the CDN layer must be configured to honour it.

### ⚠️ Creating Distributable Archives — Required Reading

**Never** create a shareable ZIP by selecting the project folder in your file manager
or running `zip -r faulter.zip faulter/`.  A filesystem ZIP captures every file on
disk, including `.env.local`, which will contain real secrets in production
(`RESEND_API_KEY`, `UPSTASH_REDIS_REST_TOKEN`, `SEARCH_COOKIE_SECRET`, `DATABASE_URL`
with credentials, etc.).  `.gitignore` protects Git history but has no effect on
a filesystem ZIP.

**Always** use the provided npm script, which delegates to `git archive` and
therefore respects `.gitignore`:

```bash
npm run archive        # produces faulter.zip — safe to share
```

This is equivalent to:

```bash
git archive HEAD --output=faulter.zip
```

`git archive` only includes files that are tracked by Git.  `.env.local` (and
`node_modules/`, `.next/`, etc.) are listed in `.gitignore` and will never appear
in the output.

### ⚠️ Rate Limiting — Required Reading Before Launch

The default rate limiter (`lib/rateLimit.ts`) uses an **in-process Map**.

| Deployment type | Rate limiting status |
|---|---|
| Single Docker container / single Coolify dyno / single PM2 instance | ✅ Works correctly |
| Vercel, Netlify, AWS Lambda, or any serverless/edge platform | ❌ **Silently fails open** — each cold start is a fresh process with an empty Map |
| Multiple Node.js replicas (horizontal scaling) | ❌ **Silently fails open** — each replica has its own counter |

"Fails open" means **every request is allowed through** — you have no spam or abuse protection on those platforms.

**To enable production-safe rate limiting (Upstash Redis):**

1. Create a free Redis database at [upstash.com](https://upstash.com)
2. `npm install @upstash/ratelimit @upstash/redis`
3. Add to your environment:
   ```
   UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=AXxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. In `lib/rateLimit.ts`: uncomment the Upstash block and delete the Map block

Until this is done, a single IP can submit the contact form or subscribe to the newsletter an unlimited number of times on serverless deployments. A startup `console.warn` is emitted each time the process starts as a reminder.


### ⚠️ SVG Images and `dangerouslyAllowSVG` — Required Reading Before Adding File Uploads or a CMS

`next.config.mjs` sets `dangerouslyAllowSVG: true` so that `next/image` can serve the SVG placeholder images in `public/article-images/` and `public/avatars/`.

**This flag is safe only while every SVG in `public/` is a committed, trusted, build-time asset.**

SVG is XML and supports inline JavaScript (`<script>`, `onclick=`, `onload=`, `javascript:` URIs, `<foreignObject>`). If a malicious or accidentally-crafted SVG lands in `public/` and gets served by `next/image`, the browser executes it with full same-origin access — a stored-XSS vulnerability that bypasses the nonce-based CSP entirely.

**Three layers of protection are in place:**

1. **Pre-build audit script** (`scripts/audit-svg.mjs`) — runs automatically as part of `npm run build` via the `prebuild` hook. Scans every `.svg` in `public/` for `<script>`, `on*` event handlers, `javascript:` URIs, and `<foreignObject>`. Fails the build with a clear report if any are found. Run manually at any time with `npm run audit-svg`.

2. **ESLint guard** (`.eslintrc.json`) — emits a build-blocking error if `dangerouslyAllowSVG: true` appears alongside a non-empty `remotePatterns` array, or whenever the flag appears at all (forcing a conscious review via `eslint-disable-next-line` with a justification comment).

3. **`remotePatterns: []`** in `next.config.mjs` — `next/image` will never proxy a third-party URL, so no externally-sourced SVG can reach the image pipeline.

**Before adding any of the following, re-evaluate this flag:**

| Feature | Risk |
|---|---|
| CMS integration that writes images to `public/` | High — CMS-written SVGs bypass all three guards above |
| File upload endpoint that saves to `public/` | High — user-supplied SVGs would execute in the browser |
| Non-empty `remotePatterns` entry | Medium — remote SVGs served via next/image |
| Object storage (R2/S3) served via `next/image` | Medium — depends on who can write to the bucket |

If any of the above apply, either:
- Set `dangerouslyAllowSVG: false` (breaks serving SVG assets — you'll need a different approach), **or**
- Serve images from a sandboxed subdomain or CDN that sets `Content-Security-Policy: sandbox` on SVG responses, **or**
- Convert all SVGs to raster formats (PNG/WebP) before storing.

#### 🎯 Open Milestone: CDN Image Migration (Audit L-1 — Pre-CMS Required)

Before starting any CMS integration, file-upload endpoint, or `remotePatterns` change, **a backlog ticket for the CDN image migration must exist and be linked in `next.config.mjs`**. This is the only safe sequence — completing CMS integration before the migration would immediately satisfy one of the trigger conditions above and make `dangerouslyAllowSVG: true` a live vulnerability.

**Tracking sentinel (M-2):** `next.config.mjs` contains the line:

```
SVG_CDN_TICKET: UNTRACKED
```

Replace `UNTRACKED` with your actual ticket ID (e.g. `SVG_CDN_TICKET: GH-42`) when the ticket is created.  To make this machine-enforceable and block merges that still carry the sentinel, add this step to your CI workflow **before any CMS/upload PR is merged**:

```yaml
- name: Reject untracked SVG CDN milestone
  run: |
    if grep -rq "SVG_CDN_TICKET: UNTRACKED" next.config.mjs; then
      echo "❌ SVG_CDN_TICKET is untracked. Create the CDN migration ticket"
      echo "   and replace UNTRACKED with the ticket ID before merging any"
      echo "   CMS, upload, or remotePatterns change."
      exit 1
    fi
```

**Ticket title:** `"Migrate article images to CDN subdomain (prerequisite for disabling dangerouslyAllowSVG)"`

Acceptance criteria for the ticket:
1. Article and avatar images served from a dedicated origin (e.g. `images.faulter.news` or an R2/S3 URL) via `<img>` or a `next/image` loader — not proxied from `/public` at the main origin.
2. `dangerouslyAllowSVG` removed (or set to `false`) from `next.config.mjs`.
3. `contentSecurityPolicy: "script-src 'none'; sandbox allow-same-origin"` added to the `images` config to sandbox any SVG served on the CDN origin.
4. `scripts/audit-svg.mjs` retained and still runs in `prebuild` for any SVGs remaining in `public/` (e.g. `icon.svg`).

> See `next.config.mjs` → `// SVG_CDN_TICKET` and `// ── S-1 / L-1` for the authoritative trigger condition list.


### ⚠️ MongoDB Index Setup — Required After First Provisioning

The application requires several MongoDB indexes and collection validators to function correctly.  They are **not** created automatically by the application — they must be applied once against your Atlas cluster after it is provisioned and before the site goes live.

**Why this is separate from `npm run build`**

`npm run prebuild` runs `check-env.mjs` and `audit-svg.mjs` — both can run at build time without a live database connection.  `create-indexes.ts` requires an active MongoDB connection and is therefore a **deployment-time** step, not a build-time step.  Running it during `npm run build` would make every CI build fail unless `DATABASE_URL` and live Atlas connectivity are available in the build environment, which is atypical and unnecessary.

**Run once after provisioning (idempotent — safe to re-run on every deploy):**

```bash
# Export your connection string, then:
DATABASE_URL=mongodb+srv://user:pass@cluster.mongodb.net/faulter?retryWrites=true&w=majority \
  npm run create-indexes
```

Or if `DATABASE_URL` is already in your shell environment:

```bash
npm run create-indexes
```

**What it creates:**

| Collection | Index / Validator | Purpose |
|---|---|---|
| `subscribers` | `email_unique_ci` (unique, case-insensitive) | Prevents duplicate subscriptions |
| `articles` | `article_text_search` (text) | Powers `/search` — **the search page throws `MongoServerError` if this index is absent** |
| `contact_submissions` | `contact_ttl_90d` (TTL, 90 days) | GDPR Art. 5(1)(e) — auto-purges PII after 90 days |
| `gdpr_erasure_log` | `gdpr_erasure_log_ttl_7y` (TTL, 7 years) | GDPR Art. 5(2) accountability records |
| `subscribers`, `contact_submissions` | JSON Schema validators | Reject writes with missing/wrong-typed fields at the DB layer |

**Integrate into your CI/CD deployment pipeline:**

```yaml
# GitHub Actions example — runs after the service is wired and DATABASE_URL is available
- name: Apply MongoDB indexes
  run: npm run create-indexes
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

The script exits with code 1 on failure so a broken connection or misconfigured `DATABASE_URL` fails the deployment pipeline visibly rather than leaving the site live with missing indexes.

**Startup health-check**

`getDb()` fires a background index health-check (`checkRequiredIndexes`) on first connection.  If any required index is missing, a loud `console.error` is written to the deployment log stream.  The site continues to serve pages — but the search page will throw on the first `$text` query, and GDPR TTL purges will not run.  Treat these log entries as a deployment-blocking alert.

---

---

## Vercel Function Region — Latency Optimisation

`vercel.json` pins Vercel serverless functions to `iad1` (Washington D.C., AWS us-east-1) by default:

```json
"regions": ["iad1"]
```

**Why this matters:** Every API route (`/api/contact`, `/api/newsletter`, `/api/unsubscribe`, etc.) opens a MongoDB connection from the Vercel function to your Atlas cluster. If the function region and Atlas cluster region are on opposite sides of the world, each database round-trip adds 100–200 ms of network latency per request.

**You must set this to match your Atlas cluster’s AWS region.** The default `iad1` is correct only if your Atlas cluster is deployed in AWS us-east-1.

### How to find your Atlas cluster region

1. Log in to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Select your project → **Clusters** → click your cluster name
3. Under **Cluster Details**, note the **Region** (e.g. `AWS / N. Virginia (us-east-1)`)

### AWS region → Vercel region code mapping

| Atlas AWS region | Vercel region code | Location |
|------------------|--------------------|----------|
| `us-east-1` | `iad1` | Washington D.C., USA (default) |
| `us-west-2` | `pdx1` | Portland, OR, USA |
| `eu-west-1` | `dub1` | Dublin, Ireland |
| `eu-central-1` | `fra1` | Frankfurt, Germany |
| `ap-southeast-1` | `sin1` | Singapore |
| `ap-southeast-2` | `syd1` | Sydney, Australia |
| `ap-south-1` | `bom1` | Mumbai, India |
| `ap-northeast-1` | `hnd1` | Tokyo, Japan |
| `sa-east-1` | `gru1` | São Paulo, Brazil |
| `ca-central-1` | `yul1` | Montreal, Canada |

> **Hobby plan:** only a single region is supported — the `regions` array must contain exactly one entry.  
> **Pro/Enterprise plan:** you can list multiple regions for multi-region deployments, but each additional region adds cold-start complexity and cross-region DB latency for the non-primary instances.

### How to update

Edit `vercel.json` and replace `iad1` with the code matching your Atlas region:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "trailingSlash": false,
  "cleanUrls": false,
  "regions": ["fra1"]
}
```

> **Audit L-3:** `trailingSlash: false` and `cleanUrls: false` are set explicitly to reinforce Next.js’s existing defaults at the Vercel platform-routing layer, preventing duplicate-content SEO issues from trailing-slash variants of the same URL.

## Customisation

- **Brand colours**: Edit `tailwind.config.ts` — change `accent` colour values
- **Typography**: Edit font imports in `app/layout.tsx` and `tailwind.config.ts`
- **Categories**: Edit `lib/categories.ts`
- **Authors**: Edit `lib/authors.ts`
- **Articles**: Edit `lib/articles.ts`
