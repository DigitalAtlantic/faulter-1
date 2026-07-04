# ──────────────────────────────────────────────────────────────────────────
# Fixes cache/CDN audit Finding C-1 (Critical):
# "Cloudflare cache eligibility for HTML is not addressed anywhere"
# ──────────────────────────────────────────────────────────────────────────
#
# next.config.mjs already sends correct CDN-Cache-Control / Surrogate-Control
# headers for every ISR and static route in this app: 1 hour for content
# pages (/, /news/[category]/[slug], /category/[slug], /tag/[slug],
# /author/[slug], /archive), 1 year for /about, /privacy, /terms,
# /newsletter, /subscribe, /_next/static, /_next/image, etc.
#
# That work is necessary but NOT sufficient on its own. Cloudflare does not
# cache HTML by default — caching ELIGIBILITY is decided by file extension,
# and .html / extensionless document routes are excluded from that default
# list regardless of what Cache-Control headers the origin sends. A header
# like CDN-Cache-Control only controls TTL *after* a resource has already
# been marked "Eligible for cache" by a Cache Rule. Without the rule below,
# every page in this app is a guaranteed edge MISS/BYPASS forever, and 100%
# of traffic reaches Vercel origin compute no matter how correct the
# app-level headers are.
#
# This ruleset adds exactly that — nothing else. It does not set its own
# TTLs (edge_ttl/browser_ttl mode = "respect_origin" means Cloudflare defers
# entirely to the CDN-Cache-Control / Cache-Control values next.config.mjs
# already sets per route), and it does not touch WAF, redirects, Page Rules,
# or any other Cloudflare product.
#
# ──────────────────────────────────────────────────────────────────────────
# IMPORTANT: Cloudflare allows exactly ONE zone-level ruleset per phase.
# All rules that target `kind = "zone"` and
# `phase = "http_request_cache_settings"` MUST live in this single resource.
# A second `cloudflare_ruleset` resource in the same phase will conflict at
# apply time and silently prevent whichever resource Terraform tries to create
# second from ever being applied — meaning the cache-key normalisation rules
# for /category/*, /tag/*, and /search would never take effect.
#
# The previous version of this file incorrectly split the cache-key
# normalisation into a separate `cloudflare_ruleset.category_tag_cache_key`
# resource. That split caused a Terraform conflict on every apply, which is
# why the strip_sort_page_from_category_tag_cache_key and
# strip_q_from_search_cache_key rules were never actually live on the zone.
# All rules are merged here into a single resource so they are applied
# atomically and never conflict.
# ──────────────────────────────────────────────────────────────────────────
#
# The three rules in this ruleset (rules 2, 3, and 4 below) are the
# bullet-3 High fix: strip sort/page query params from the Cloudflare cache
# key on /category/* and /tag/* routes, and strip q from /search.
# Rule 5 strips UTM and click-tracking params globally (audit Finding 1 fix).
#
# Why the key-normalisation rules exist:
#   The CategoryArticleList and TagArticleList Client Components use
#   router.push() (not <Link>) to update sort and page URL params, so the
#   browser address bar reflects the current view
#   (/category/world?sort=oldest&page=2) but NO new HTTP request is sent to
#   the origin — the ISR HTML shell is already in the browser, and
#   pagination/sorting happens entirely client-side using the articles already
#   passed as props.
#
#   This is correct behaviour by design (see CategoryArticleList.tsx), but it
#   creates a Cloudflare cache-key problem: even though the origin always
#   serves the same HTML for /category/world regardless of query params,
#   Cloudflare's default behaviour is to include the full query string in the
#   cache key. A visitor arriving directly at /category/world?sort=oldest&page=2
#   (e.g. from a shared link or search engine) causes a Cloudflare MISS — a
#   separate cache entry is stored for every (sort, page) combination,
#   fragmenting the cache across the cartesian product of sort × page values.
#
#   The rules below fix that by instructing Cloudflare to ignore sort and page
#   when constructing the cache key for /category/* and /tag/*, and to ignore q
#   for /search. Every combination — /?sort=latest, /?sort=oldest, /?page=2 —
#   is served from the same single ISR cache entry as the bare path URL.
#
# Cache-key exclusion vs. URL normalisation:
#   These rules exclude params from the CACHE KEY only — they do not rewrite
#   the URL sent to the origin, and they do not strip params from the browser's
#   address bar. The origin still sees the full URL if a cache miss occurs; the
#   client still sees the correct URL for bookmarking and back/forward
#   navigation.
#
# ──────────────────────────────────────────────────────────────────────────

resource "cloudflare_ruleset" "edge_cache_eligibility" {
  zone_id     = var.cloudflare_zone_id
  name        = "Faulter — edge cache eligibility and cache-key normalisation"
  description = "Bypasses most /api/* routes; carves out /api/breaking (short-TTL public endpoint) so it IS cached; marks every other route eligible with TTL deferred to the app's Cache-Control headers; normalises cache keys for /category/*, /tag/*, and /search by stripping sort, page, and q params; strips UTM and click-tracking params globally so campaign links share cache entries with canonical URLs. All rules are merged into one resource because Cloudflare allows only one zone-level ruleset per phase. See cache/CDN audit Finding C-1, bullet-3 High fix, the High /search fix, and audit Finding 1 (UTM fragmentation)."
  kind        = "zone"
  phase       = "http_request_cache_settings"

  # ── Rule 1: bypass /api/* (except /api/breaking) ────────────────────────
  #
  # Mutation and webhook routes must never be cached. /api/csrf in particular
  # cannot be cached — if the CSRF token response were served from edge cache,
  # every client would receive the same token, collapsing CSRF protection to
  # zero (cache-poisoning of the anti-CSRF token). See README "Cloudflare Cache
  # Bypass — Required Before Launch".
  #
  # /api/breaking is explicitly excluded from the bypass so it can be cached at
  # the edge (s-maxage=60, set by its route handler).
  rules {
    ref         = "bypass_api_and_search"
    description = "Bypass edge cache for /api/* (mutation + webhook routes; also prevents CSRF-token cache poisoning on /api/csrf — see README 'Cloudflare Cache Bypass'). /api/breaking is explicitly excluded so it can be cached at the edge (s-maxage=60). /search is no longer bypassed — the page was refactored to a fully static shell; all query-dependent rendering is client-side via useSearchParams() in <SearchResults>."
    expression  = "starts_with(http.request.uri.path, \"/api/\") and http.request.uri.path ne \"/api/breaking\""
    action      = "set_cache_settings"

    action_parameters {
      cache = false
    }

    enabled = true
  }

  # ── Rule 2: baseline cache eligibility for all public routes ────────────
  #
  # Marks every non-/api route eligible for caching. TTL comes entirely from
  # each route's own CDN-Cache-Control / Cache-Control header set in
  # next.config.mjs (mode = "respect_origin" — Cloudflare defers to the
  # app-level headers rather than imposing its own TTL).
  #
  # /category/* and /tag/* and /search are covered by this rule for baseline
  # eligibility; the cache-key normalisation rules below (Rules 3 and 4) then
  # additionally constrain which query params participate in the cache key for
  # those paths specifically.
  rules {
    ref         = "cache_eligible_public_routes"
    description = "Eligible for cache — home, articles, category/tag/author/archive listings, static editorial pages, newsletter/subscribe/contact/bookmarks/search shells, sitemap.xml/rss.xml/robots.txt, opengraph-image, _next/image, and /api/breaking. TTL comes entirely from each route's own CDN-Cache-Control / Cache-Control header set in next.config.mjs (or the route handler for /api/breaking)."
    expression  = "not (starts_with(http.request.uri.path, \"/api/\") and http.request.uri.path ne \"/api/breaking\")"
    action      = "set_cache_settings"

    action_parameters {
      cache = true

      edge_ttl {
        mode = "respect_origin"
      }

      browser_ttl {
        mode = "respect_origin"
      }
    }

    enabled = true
  }

  # ── Rule 3: cache-key normalisation for /category/* and /tag/* ──────────
  #
  # Strips `sort` and `page` from the Cloudflare cache key so that every
  # sort/page combination shares the same ISR HTML shell as the bare path.
  # See the module-level comment above for the full rationale.
  #
  # Only `sort` and `page` are stripped — the only params that
  # CategoryArticleList / TagArticleList read via useSearchParams(). Stripping
  # only the known params is safer than stripping ALL query params, which would
  # collapse hypothetical future functional params (preview tokens, variant
  # flags, etc.) into the same cache entry and cause stale-content bugs.
  rules {
    ref         = "strip_sort_page_from_category_tag_cache_key"
    description = "Exclude sort and page query params from the cache key on /category/* and /tag/* so every pagination/sort variant is served from the same ISR HTML shell. Bullet-3 High fix."
    expression  = "(starts_with(http.request.uri.path, \"/category/\")) or (starts_with(http.request.uri.path, \"/tag/\"))"
    action      = "set_cache_settings"

    action_parameters {
      cache = true

      cache_key {
        exclude_query_strings_from_cache_key {
          list = ["sort", "page"]
        }
      }

      edge_ttl {
        mode = "respect_origin"
      }

      browser_ttl {
        mode = "respect_origin"
      }
    }

    enabled = true
  }

  # ── Rule 4: cache-key normalisation for /search ─────────────────────────
  #
  # Strips `q` from the Cloudflare cache key for /search. The search shell is
  # fully static — result rendering is client-side via useSearchParams() in
  # <SearchResults>. The HTML response is byte-identical for /search,
  # /search?q=foo, and /search?q=anything. Without this rule, every unique
  # query string creates a separate Cloudflare cache entry, fragmenting the
  # cache across the full cardinality of user search queries and guaranteeing
  # a MISS on every first-time query. With it, all variants share one edge
  # cache entry.
  rules {
    ref         = "strip_q_from_search_cache_key"
    description = "Exclude the q param from the Cloudflare cache key for /search. The search shell is fully static; result rendering is client-side. /search?q=foo and /search?q=bar serve the same HTML and must share a single edge cache entry. High severity fix."
    expression  = "http.request.uri.path eq \"/search\""
    action      = "set_cache_settings"

    action_parameters {
      cache = true

      cache_key {
        exclude_query_strings_from_cache_key {
          list = ["q"]
        }
      }

      edge_ttl {
        mode = "respect_origin"
      }

      browser_ttl {
        mode = "respect_origin"
      }
    }

    enabled = true
  }

  # ── Rule 5: UTM and click-tracking param normalisation (global) ──────────
  #
  # WHY THIS RULE EXISTS (audit Finding 1):
  #
  # Cloudflare's default cache key includes the full query string. Email
  # platforms, social networks, and ad networks append tracking parameters
  # to every outbound link:
  #
  #   utm_source / utm_medium / utm_campaign / utm_term / utm_content
  #     — Google Analytics / GA4 campaign parameters
  #   fbclid   — Facebook / Instagram click ID (unique per click)
  #   gclid    — Google Ads click ID (unique per click)
  #   ttclid   — TikTok click ID (unique per click)
  #   msclkid  — Microsoft / Bing Ads click ID (unique per click)
  #   mc_cid / mc_eid — Mailchimp campaign and email IDs
  #   _hsenc / _hsmi — HubSpot email tracking IDs
  #   ref / source    — common referral shorthand parameters
  #
  # Without this rule, a newsletter send to 10,000 subscribers generates up to
  # 10,000 separate Cloudflare cache entries for the same article URL —
  # because utm_campaign typically encodes the send date and mc_eid encodes
  # the subscriber ID, making every link effectively unique. fbclid is even
  # worse: Facebook generates a globally unique value per click, so every
  # single click from a shared post is a guaranteed cache MISS.
  #
  # WHAT THIS RULE DOES:
  #
  # It strips the listed parameters from the CACHE KEY only. It does NOT:
  #   • Rewrite or strip the URL sent to the origin on a cache miss
  #   • Modify the URL visible in the browser address bar
  #   • Affect non-cacheable routes (/api/* is excluded by Rule 1 before
  #     this rule is evaluated, so tracking params on API calls are unaffected)
  #
  # After this rule, /news/politics/ceasefire-talks,
  # /news/politics/ceasefire-talks?utm_source=newsletter&utm_campaign=2026-06-28,
  # and /news/politics/ceasefire-talks?fbclid=<unique-id> all resolve to the
  # same Cloudflare cache entry — the one already warm from organic traffic.
  #
  # SAFETY:
  #
  # None of these parameters affect the HTML served by the origin. They are
  # purely decoration appended by the sending platform and consumed client-side
  # by analytics scripts. Collapsing them into a single cache key is safe:
  # every visitor, regardless of which tracking params they carry, receives
  # identical HTML.
  #
  # MAINTENANCE:
  #
  # This list covers the most common parameters in use as of 2026. Add new
  # platform-specific IDs here as they are encountered — the pattern is:
  # if the parameter is appended by a sending platform and never changes the
  # HTML the origin returns, it belongs in this list.
  rules {
    ref         = "strip_tracking_params_global"
    description = "Strip UTM campaign params and platform click IDs from the Cloudflare cache key on all cacheable public routes. These params are appended by email/social/ad platforms and never affect the HTML the origin serves. Without this rule, every newsletter send and every social click generates a separate Cloudflare cache entry, eliminating the cache hit ratio benefit for campaign traffic. Audit Finding 1 fix."
    expression  = "not starts_with(http.request.uri.path, \"/api/\")"
    action      = "set_cache_settings"

    action_parameters {
      cache = true

      cache_key {
        exclude_query_strings_from_cache_key {
          list = [
            # Google Analytics / GA4 campaign parameters
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content",
            "utm_id",
            # Platform click IDs — globally unique per click, worst-case cache fragmentation
            "fbclid",   # Facebook / Instagram
            "gclid",    # Google Ads
            "gclsrc",   # Google cross-account conversion tracking
            "ttclid",   # TikTok
            "msclkid",  # Microsoft / Bing Ads
            # Email platform tracking IDs
            "mc_cid",   # Mailchimp campaign ID
            "mc_eid",   # Mailchimp subscriber email ID
            "_hsenc",   # HubSpot email tracking
            "_hsmi",    # HubSpot email message ID
            # Generic referral shorthand
            "ref",
            "source",
          ]
        }
      }

      edge_ttl {
        mode = "respect_origin"
      }

      browser_ttl {
        mode = "respect_origin"
      }
    }

    enabled = true
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Audit finding H-1 fix: SVG security headers for /article-images/* and
# /avatars/* via Cloudflare http_response_headers_transform.
#
# PROBLEM:
#   /article-images/ and /avatars/ are excluded from the Next.js middleware
#   matcher (see config.matcher in middleware.ts) so that middleware never runs
#   for those paths. A previous early-return branch in middleware() attempted to
#   set security headers on these SVG responses, but that branch was unreachable
#   because the matcher exclusion meant middleware was never invoked for those
#   paths at all. As a result, every SVG under /article-images/ and /avatars/
#   was served without:
#     • X-Content-Type-Options: nosniff   — allows MIME-sniffing to text/html
#     • Content-Disposition: attachment   — allows inline SVG rendering/execution
#     • X-Frame-Options: DENY             — allows embedding in third-party frames
#     • Referrer-Policy                   — inconsistent with all other responses
#
#   With dangerouslyAllowSVG: true in next.config.mjs and no browser-layer
#   guard, a malicious SVG reaching /public would execute scripts in the
#   main origin context on direct navigation.
#
# FIX:
#   Apply the four security headers at the Cloudflare response-transform layer.
#   This is strictly better than the middleware approach because:
#     1. Headers are set on EVERY response, including cache hits — middleware
#        runs only on cold cache misses (new PoP warmup).
#     2. Zero middleware execution cost for these high-volume static assets.
#     3. Defence-in-depth: applies even if middleware is bypassed due to a
#        configuration error.
#
# PHASE NOTE:
#   This resource uses phase = "http_response_headers_transform", which is a
#   DIFFERENT phase from the edge_cache_eligibility resource above
#   (http_request_cache_settings). Cloudflare allows exactly one zone-level
#   ruleset per phase, so these two resources do not conflict.
# ──────────────────────────────────────────────────────────────────────────────

resource "cloudflare_ruleset" "svg_security_headers" {
  zone_id     = var.cloudflare_zone_id
  name        = "Faulter — SVG security headers"
  description = "Applies X-Content-Type-Options, Content-Disposition, X-Frame-Options, and Referrer-Policy to every response from /article-images/* and /avatars/*. These paths are excluded from the Next.js middleware matcher (middleware never runs for them), so headers must be enforced here. Fixes audit finding H-1: dead isStaticSvg branch in middleware.ts."
  kind        = "zone"
  phase       = "http_response_headers_transform"

  rules {
    ref         = "svg_security_headers"
    description = "Security headers for static SVG assets in /article-images/ and /avatars/. Prevents MIME-sniffing, inline SVG execution, framing, and referrer leakage. H-1 fix."
    expression  = "(http.request.uri.path wildcard \"/article-images/*\") or (http.request.uri.path wildcard \"/avatars/*\")"
    action      = "rewrite"
    enabled     = true

    action_parameters {
      # Prevents MIME-sniffing: the browser must treat this as image/svg+xml,
      # never as text/html, regardless of content. Without this an SVG containing
      # HTML-like content could be rendered as a document in legacy browsers.
      headers {
        name      = "X-Content-Type-Options"
        operation = "set"
        value     = "nosniff"
      }

      # Forces download on direct navigation. Mirrors the Content-Disposition
      # header that next/image's optimizer emits when it proxies SVGs — we
      # replicate it here for direct-URL requests that bypass the optimizer.
      # If a malicious SVG reaches /public, a user navigating to its URL gets
      # a download prompt instead of script execution in the main browsing context.
      headers {
        name      = "Content-Disposition"
        operation = "set"
        value     = "attachment"
      }

      # Prevents embedding in third-party <iframe>s. An SVG loaded in a frame
      # on an attacker-controlled page could be used for clickjacking or, if
      # the SVG contains script, to execute it in a framed context.
      headers {
        name      = "X-Frame-Options"
        operation = "set"
        value     = "DENY"
      }

      # Consistent with the Referrer-Policy applied to all HTML responses by
      # middleware.ts. Prevents referrer leakage that could correlate SVG
      # asset requests with authenticated user sessions.
      headers {
        name      = "Referrer-Policy"
        operation = "set"
        value     = "strict-origin-when-cross-origin"
      }
    }
  }
}
