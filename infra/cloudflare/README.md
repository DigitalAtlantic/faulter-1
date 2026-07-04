# Cloudflare edge cache eligibility — fixes audit Finding C-1 (Critical)

## What this fixes

`next.config.mjs` already sends correct `CDN-Cache-Control` / `Surrogate-Control`
headers for every ISR and static route in this app — 1 hour for content pages
(`/`, `/news/[category]/[slug]`, `/category/[slug]`, `/tag/[slug]`,
`/author/[slug]`, `/archive`), 1 year for static pages and assets, and so on.

**That work is necessary but not sufficient on its own.** Cloudflare does not
cache HTML by default. Cache *eligibility* is decided by file extension —
`.html` / extensionless document routes are excluded from Cloudflare's default
cached-extension list, regardless of what `Cache-Control` headers the origin
sends. A header like `CDN-Cache-Control` only controls *TTL*, and only takes
effect *after* a request has already been marked "Eligible for cache" by a
**Cache Rule**. That rule lives on the Cloudflare zone, not in this repository
— which is exactly why this gap survived 15 rounds of otherwise-thorough
in-app fixes.

Without it: every page in this app is a guaranteed edge `MISS`/`DYNAMIC`
forever, and 100% of traffic reaches Vercel origin compute no matter how
correct the application code is.

This module adds exactly that rule — nothing else. It does not set its own
TTLs (`edge_ttl`/`browser_ttl` mode `respect_origin` means Cloudflare defers
entirely to the `CDN-Cache-Control` / `Cache-Control` values this app already
sends per route), and it does not touch WAF, redirects, Page Rules, or any
other Cloudflare product.

It also folds in the **`/api/*` cache-bypass requirement** already documented
in the root `README.md` under *"Cloudflare Cache Bypass — Required Before
Launch"* (CSRF-token cache-poisoning risk), so the "make this cacheable" and
"make sure this specific thing never is" rules live in one place and can't
drift apart.

---

## Option A — GitHub Actions (recommended, fully automated)

Push any change to `infra/cloudflare/**` on `main`, or trigger
`.github/workflows/cloudflare-cache-rules.yml` via `workflow_dispatch`.

The workflow:
1. Runs `terraform apply` to push the Cache Rules to the Cloudflare zone.
2. Verifies all four expected rule `ref` values are present via the
   Cloudflare API.
3. Calls the Vercel REST API to upsert `CLOUDFLARE_CACHE_RULES_APPLIED=true`
   into the project's Production environment — closing the loop so the
   `next.config.mjs` build gate passes on the next deploy automatically.

**Required GitHub Actions secrets** (Settings → Secrets → Actions):

| Secret | Where to get it |
|--------|----------------|
| `CLOUDFLARE_ZONE_ID` | Cloudflare dashboard → your domain → Overview (right sidebar) |
| `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com/profile/api-tokens → Zone → Cache Rules → Edit (scoped to this zone) |
| `VERCEL_TOKEN` | https://vercel.com/account/tokens → personal or team token with env var read/write |
| `VERCEL_PROJECT_ID` | Vercel dashboard → your project → Settings → General → Project ID |
| `VERCEL_TEAM_ID` | Vercel dashboard → Settings → General → Team ID *(leave unset for personal accounts)* |

**Cloudflare token scope:** create a new, narrowly-scoped token at
https://dash.cloudflare.com/profile/api-tokens with **Zone → Cache Rules →
Edit** for this zone only. Do not reuse `CLOUDFLARE_PURGE_API_TOKEN` from
the app's `.env` — that token only needs (and should only have) **Zone →
Cache Purge → Edit**. See `variables.tf` for the full explanation.

## Option B — Terraform (manual CLI)

```bash
cd infra/cloudflare
terraform init

# Either copy terraform.tfvars.example -> terraform.tfvars and fill it in
# (it's gitignored), or pass vars directly / via TF_VAR_* env vars:
terraform apply \
  -var="cloudflare_zone_id=<your zone ID>" \
  -var="cloudflare_api_token=<token scoped to Zone -> Cache Rules -> Edit>"
```

Re-running `terraform apply` after future edits to `cache_rules.tf` will
update the same named rules in place (the `ref` field on each rule keeps
their IDs stable across applies) rather than creating duplicates.

After a successful manual apply, set `CLOUDFLARE_CACHE_RULES_APPLIED=true`
in Vercel (Settings → Environment Variables → Production) so the
`next.config.mjs` build gate passes on your next deploy.

## Option C — Cloudflare dashboard (manual)

Create **four** Cache Rules in the order below (Caching → Cache Rules → Create
rule). Rule order matters — Cloudflare evaluates them top-to-bottom.

| Step | Rule name | Match expression | Action / settings |
|------|-----------|------------------|-------------------|
| 1 | `bypass_api_and_search` | `starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api/breaking"` | **Bypass cache** |
| 2 | `cache_eligible_public_routes` | `not (starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api/breaking")` | **Eligible for cache**. Edge TTL: **Use cache-control header if present** (do **not** override with a fixed value — this app sets per-route 1 h / 24 h / 1 yr TTLs). Browser TTL: same. |
| 3 | `strip_sort_page_from_category_tag_cache_key` | `(starts_with(http.request.uri.path, "/category/")) or (starts_with(http.request.uri.path, "/tag/"))` | **Eligible for cache**. Edge/Browser TTL: **Use cache-control header if present**. Cache key: **Exclude query string parameters** → add `sort` and `page`. |
| 4 | `strip_q_from_search_cache_key` | `http.request.uri.path eq "/search"` | **Eligible for cache**. Edge/Browser TTL: **Use cache-control header if present**. Cache key: **Exclude query string parameters** → add `q`. |

> ⚠️ `/search` is **not** in the bypass expression — it is a fully static shell
> whose result rendering is client-side. `/api/breaking` is explicitly excluded
> from the bypass so its `s-maxage=60` response is cached at the edge.

After applying, set `CLOUDFLARE_CACHE_RULES_APPLIED=true` in Vercel (Settings
→ Environment Variables → Production) so the `next.config.mjs` build gate
passes on the next deploy. (Option A sets this automatically.)

## Option D — Cloudflare API directly (curl)

```bash
curl "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" \
  --request PUT \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "description": "Faulter - edge cache eligibility and cache-key normalisation",
    "rules": [
      {
        "ref": "bypass_api_and_search",
        "action": "set_cache_settings",
        "expression": "starts_with(http.request.uri.path, \"/api/\") and http.request.uri.path ne \"/api/breaking\"",
        "description": "Bypass edge cache for /api/* except /api/breaking (CSRF-token cache-poisoning risk; /api/breaking is cached at s-maxage=60)",
        "action_parameters": { "cache": false },
        "enabled": true
      },
      {
        "ref": "cache_eligible_public_routes",
        "action": "set_cache_settings",
        "expression": "not (starts_with(http.request.uri.path, \"/api/\") and http.request.uri.path ne \"/api/breaking\")",
        "description": "Eligible for cache - home, articles, category/tag/author/archive listings, form shells, /api/breaking. TTL deferred to origin Cache-Control headers.",
        "action_parameters": {
          "cache": true,
          "edge_ttl": { "mode": "respect_origin" },
          "browser_ttl": { "mode": "respect_origin" }
        },
        "enabled": true
      },
      {
        "ref": "strip_sort_page_from_category_tag_cache_key",
        "action": "set_cache_settings",
        "expression": "(starts_with(http.request.uri.path, \"/category/\")) or (starts_with(http.request.uri.path, \"/tag/\"))",
        "description": "Normalise cache key for /category/* and /tag/* by stripping sort and page params so every pagination/sort variant shares the same ISR shell",
        "action_parameters": {
          "cache": true,
          "cache_key": {
            "exclude_query_strings_from_cache_key": { "list": ["sort", "page"] }
          },
          "edge_ttl": { "mode": "respect_origin" },
          "browser_ttl": { "mode": "respect_origin" }
        },
        "enabled": true
      },
      {
        "ref": "strip_q_from_search_cache_key",
        "action": "set_cache_settings",
        "expression": "http.request.uri.path eq \"/search\"",
        "description": "Normalise cache key for /search by stripping q param so all search queries share the same static shell entry",
        "action_parameters": {
          "cache": true,
          "cache_key": {
            "exclude_query_strings_from_cache_key": { "list": ["q"] }
          },
          "edge_ttl": { "mode": "respect_origin" },
          "browser_ttl": { "mode": "respect_origin" }
        },
        "enabled": true
      }
    ]
  }'
```

> ⚠️ This `PUT` **replaces the entire rule list** for the `http_request_cache_settings`
> phase on the zone. If you already have other Cache Rules configured on this
> zone, fetch them first with `GET` on the same URL and merge their `rules`
> array with the four above instead of overwriting — or just use Option A or B
> instead, both of which apply rules safely via Terraform.

---

## Verify the fix

```bash
# First request to a content page — expect MISS (cache not yet warm)
curl -sI https://yourdomain.com/ | grep -i cf-cache-status

# Second request within the TTL window — expect HIT
curl -sI https://yourdomain.com/ | grep -i cf-cache-status

# /api/* (except /api/breaking) should always BYPASS
curl -sI https://yourdomain.com/api/csrf | grep -i cf-cache-status

# /api/breaking should be cached (s-maxage=60 from the route handler)
curl -sI https://yourdomain.com/api/breaking | grep -i cf-cache-status

# /search shell is cached — the q param is stripped from the cache key
# so /search?q=foo and /search hit the same edge entry
curl -sI "https://yourdomain.com/search?q=anything" | grep -i cf-cache-status

# /category/* and /tag/* — sort and page are stripped from the cache key
curl -sI "https://yourdomain.com/category/world?sort=trending&page=2" | grep -i cf-cache-status
```

Expected results:
| URL | First request | Repeat request (within TTL) |
|-----|---------------|------------------------------|
| `/`, `/news/*`, `/category/*`, `/tag/*`, `/search`, etc. | `MISS` or `EXPIRED` | `HIT` |
| `/api/*` (except `/api/breaking`) | `BYPASS` | `BYPASS` |
| `/api/breaking` | `MISS` | `HIT` (60 s TTL) |

> A repeat request to a content page that still comes back `DYNAMIC` or
> `BYPASS` means the rule isn’t active yet. Check that it deployed and that
> DNS for the zone is proxied (orange-clouded), not DNS-only. Fix before
> relying on any of the cache-hit-ratio numbers elsewhere in the audit.

Add the content-page HIT check and the `/api/csrf` BYPASS check to your
deployment runbook / CI smoke tests, the same way the existing check is
documented in the root `README.md`.
