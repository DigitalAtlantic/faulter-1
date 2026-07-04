import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { checkRateLimitFailOpen, hasUpstash } from "@/lib/upstash";
import { getClientIp } from "@/lib/rateLimit";
import { isRealProduction } from "@/lib/env";
import { getArticleBySlug, tagToSlug } from "@/lib/articles";

/**
 * Constant-time string comparison to prevent timing-oracle attacks on the
 * revalidation secret.
 *
 * D-3 fix: replaces the plain `!==` check.  Even though a 256-bit hex secret
 * makes timing attacks impractical in practice, using timingSafeEqual:
 *  • eliminates the risk entirely for shorter/weaker operator-supplied secrets
 *  • removes the code comment that normalises the weaker approach for future readers
 *  • costs zero runtime overhead
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * POST /api/revalidate
 *
 * ── Resolution: ISR is real again — revalidatePath() has been restored ─────
 *
 * This endpoint previously called `revalidatePath()` for the home, category,
 * and article routes, on the assumption that those routes used Next.js's
 * ISR / Full Route Cache. That assumption became false when app/layout.tsx
 * (an ancestor of every route) started calling `headers()` on every request
 * to read a per-request CSP nonce — `headers()` is a Next.js Dynamic API,
 * and its presence anywhere in the render tree unconditionally forces full
 * dynamic SSR for the whole route, leaving no cache entry for
 * `revalidatePath()` to invalidate. At that point this endpoint was changed
 * to stop calling `revalidatePath()` (it had become a silent no-op) and
 * instead return `revalidated: false` with an explanatory note.
 *
 * Per the latest audit, the root cause has been removed instead of worked
 * around: app/layout.tsx and the individual page components no longer call
 * headers() for a nonce, and middleware.ts's production CSP now uses a
 * static `script-src 'self' 'unsafe-inline' …` policy that is identical on
 * every response (see the "non-request-specific CSP strategy" comment in
 * middleware.ts). `/`, `/news/[category]/[slug]`, `/author/[slug]`, and
 * `/archive`, and `/article/[slug]` are statically generated / served via ISR
 * (`revalidate = 3600`) again. (Finding 3 fix: `/article/[slug]` previously
 * used `revalidate = false` — build-time static with a 1-year CDN TTL — while
 * `/news/[category]/[slug]` used `revalidate = 3600`. Both routes render
 * identical content, so a correction would be reflected on `/news/` within one
 * ISR cycle but remain stale on `/article/` at Cloudflare for up to 365 days.
 * Changing to `revalidate = 3600` and aligning the CDN-Cache-Control TTL to
 * 1 hour eliminates that gap; `/api/revalidate` now purges `/article/<slug>`
 * alongside `/news/<category>/<slug>` on every article update.)
 * There is now a real Next.js cache entry for each of these paths, so
 * `revalidatePath()` is meaningful again and has been restored below as the
 * primary on-demand invalidation mechanism.
 *
 * `/category/[slug]` is included in the path lists below for completeness
 * (it appears alongside the article/category it revalidates). M-3 fix: this
 * comment used to say the route "still renders dynamically in its own
 * right" because it read `searchParams` for sort/pagination, making
 * `revalidatePath()` a no-op for it — that read has since moved into a
 * "use client" child (CategoryArticleList) wrapped in `<Suspense>`, so the
 * Server Component itself is ISR-eligible (`revalidate = 3600`) and
 * `revalidatePath("/category/<slug>")` below is a real, meaningful
 * invalidation, not a no-op.
 *
 * ── What freshness depends on now ────────────────────────────────────────
 * `revalidatePath()` invalidates Next.js's own Full Route Cache / Data Cache
 * entries at the origin. `purgeEdgeCache()` then calls the Cloudflare Cache
 * Purge API (`POST /zones/{id}/purge_cache`) to evict stale HTML from
 * Cloudflare's edge PoPs immediately. Configure CLOUDFLARE_ZONE_ID and
 * CLOUDFLARE_PURGE_API_TOKEN (see .env.example) to enable it. If either
 * variable is absent the Cloudflare purge is skipped with a console.warn
 * and origin-level ISR invalidation still happens via revalidatePath().
 *
 * ── What this endpoint actually does now ─────────────────────────────────
 * 1. Authenticates the caller (REVALIDATE_SECRET, checked before the per-IP
 *    rate limit — see "L-2 fix" comment below for why that order matters).
 * 2. Validates the request shape (unchanged).
 * 3. Calls `revalidatePath()` for each affected path, invalidating Next.js's
 *    own ISR/Data Cache entries at the origin.
 * 4. Calls `purgeEdgeCache(paths)` to purge Cloudflare's edge cache for
 *    the affected paths (requires CLOUDFLARE_ZONE_ID and
 *    CLOUDFLARE_PURGE_API_TOKEN — skipped with a warning if absent).
 * 5. Returns 200 with `revalidated: true` and the paths that were
 *    invalidated at the origin.
 *
 * This endpoint is intentionally kept (rather than deleted) so existing CMS
 * webhook configurations keep working without a 404, and so it has a single
 * place to land real CDN-purge logic later.
 *
 * ── Security design ──────────────────────────────────────────────────────────
 * The endpoint is protected by a shared secret (`REVALIDATE_SECRET`) that
 * MUST be set in your deployment environment.  Every request must include the
 * header:
 *
 *   x-revalidate-secret: <your-secret>
 *
 * without which the endpoint returns 401.  This prevents arbitrary external
 * callers from triggering cache invalidation storms.
 *
 * Generate the secret (run once, store in deployment env):
 *   openssl rand -hex 32
 *
 * Add it to your deployment platform as `REVALIDATE_SECRET` and copy the same
 * value into your CMS webhook configuration.
 *
 * ── Request format ───────────────────────────────────────────────────────────
 * POST /api/revalidate
 * Header: x-revalidate-secret: <secret>
 * Header: Content-Type: application/json
 * Body:
 *   {
 *     "type": "article",          // required — "article" | "category" | "home"
 *     "categorySlug": "world",    // required when type === "article" or "category"
 *     "articleSlug": "g20-..."    // required when type === "article"
 *   }
 *
 * ── Response format ──────────────────────────────────────────────────────────
 * 200 { "revalidated": true, "paths": ["/news/world/g20-...", "/category/world", "/"],
 *       "note": "Next.js ISR cache invalidated at origin and Cloudflare edge-cache
 *                purged (if CLOUDFLARE_ZONE_ID + CLOUDFLARE_PURGE_API_TOKEN are set)." }
 * 400 { "error": "Missing required field: articleSlug" }
 * 401 { "error": "Invalid or missing revalidation secret" }
 * 405 { "error": "Method not allowed" }
 * 500 { "error": "Revalidation endpoint is not configured (REVALIDATE_SECRET missing). ...",
 *       "code": "secret_not_configured" }
 *     — server misconfiguration. Retrying will not help until REVALIDATE_SECRET is set.
 * 500 { "error": "Revalidation failed. Check server logs for details.",
 *       "code": "edge_cache_purge_failed",
 *       "message": "Edge cache purge failed — see server logs", "paths": [...] }
 *     — L-4 fix: the request was authenticated and valid; only the Cloudflare
 *       edge-cache purge call failed. A CMS can use `code` to
 *       tell this apart from secret_not_configured above and decide whether to retry.
 *       M-1 fix: `message` is a fixed, generic string — the underlying
 *       Cloudflare error (which may contain zone IDs, API token error
 *       details, or other internal info) is logged server-side only and
 *       never echoed back to the caller, even though this endpoint is
 *       itself authenticated by REVALIDATE_SECRET.
 *
 * ── Paths included in the response (for future CDN-purge wiring) ────────────
 * For type "article":
 *   /news/<categorySlug>/<articleSlug>   — the article page itself
 *   /article/<articleSlug>               — the ad-layout alias (Finding 3 fix:
 *                                          previously missing from this list,
 *                                          leaving Cloudflare's 1-yr cached copy
 *                                          stale after any post-publish edit)
 *   /category/<categorySlug>             — the category listing (shows the article)
 *   /                                    — the home page (may feature the article)
 *   /author/<authorSlug>                 — M-1 fix: author page (lists their articles)
 *   /tag/<tagSlug>  (one per tag)        — M-1 fix: tag pages (list articles with
 *                                          that tag); looked up from lib/articles.ts
 *                                          by articleSlug so the API payload is
 *                                          unchanged. If the article is not found
 *                                          in the local data (e.g. a draft), these
 *                                          paths are omitted gracefully.
 *   /archive                             — M-1 fix: chronological archive listing
 *   /rss.xml                             — M-1 fix: RSS feed (new/updated articles)
 *   /sitemap.xml                         — M-1 fix: sitemap (new article URLs)
 *
 * For type "category":
 *   /category/<categorySlug>             — the category listing
 *   /                                    — home page
 *
 * For type "home":
 *   /                                    — home page only
 *
 * ── CMS webhook integration ──────────────────────────────────────────────────
 * Call this endpoint from your CMS on article save.  Example (fetch):
 *
 *   await fetch("https://faulter.news/api/revalidate", {
 *     method: "POST",
 *     headers: {
 *       "Content-Type": "application/json",
 *       "x-revalidate-secret": process.env.REVALIDATE_SECRET,
 *     },
 *     body: JSON.stringify({
 *       type: "article",
 *       categorySlug: article.category.slug,
 *       articleSlug: article.slug,
 *     }),
 *   });
 *
 * ── REVALIDATE_SECRET not set ────────────────────────────────────────────────
 * If `REVALIDATE_SECRET` is absent from the environment, the endpoint returns
 * 500 on every request and logs a loud error. This is intentional: a missing
 * secret means the endpoint is completely unprotected — allowing it to succeed
 * would be worse than failing. Set the secret before pointing your CMS at it.
 */

/** Paths revalidated for a full article update.
 *
 * Finding 3 fix: includes /article/<slug> alongside /news/<category>/<slug>
 * because both routes render the same article content. Previously only the
 * /news/ path was purged, leaving the /article/ copy stale at Cloudflare edge
 * nodes for up to 365 days (CDN-Cache-Control: max-age=31536000). Now both
 * paths are invalidated at the Next.js origin via revalidatePath() and purged
 * from Cloudflare via purgeEdgeCache() on every article update.
 *
 * M-1 fix: also includes /author/<slug>, /tag/<slug> for each tag, /archive,
 * /rss.xml, and /sitemap.xml. Previously these routes were not purged on
 * article update, leaving up to one ISR cycle (1 h) of staleness for
 * corrections and retractions — defeating the purpose of on-demand
 * revalidation for those pages.
 *
 * authorSlug and tagSlugs are looked up from lib/articles.ts by articleSlug
 * so the CMS webhook payload does not need to change. If the article is not
 * found locally (e.g. a draft the static data does not yet include), the
 * author/tag paths are omitted gracefully and only the canonical URL set is
 * purged.
 */
function articlePaths(
  categorySlug: string,
  articleSlug: string,
  authorSlug: string | undefined,
  tagSlugs: string[],
): string[] {
  const paths = [
    `/news/${categorySlug}/${articleSlug}`,
    `/article/${articleSlug}`,
    `/category/${categorySlug}`,
    "/",
    "/archive",
    "/rss.xml",
    "/sitemap.xml",
    // Finding 4 fix (Option A): /api/breaking is the endpoint the client-side
    // BreakingNewsTicker fetches on page load. Purging it here ensures the edge
    // cache for the ticker data is cleared immediately when any article changes,
    // not just when the s-maxage=60 TTL on the /api/breaking response expires.
    "/api/breaking",
  ];
  if (authorSlug) {
    paths.push(`/author/${authorSlug}`);
  }
  for (const slug of tagSlugs) {
    paths.push(`/tag/${slug}`);
  }

  return paths;
}

/** Paths revalidated when only a category listing changes (no specific article). */
function categoryPaths(categorySlug: string): string[] {
  return [`/category/${categorySlug}`, "/"];
}

/** Paths revalidated when only the home page content changes. */
function homePaths(): string[] {
  return ["/"];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── H-2 fix: Upstash presence guard ─────────────────────────────────────
  // Without Upstash, checkRateLimit() falls back to an in-process Map that is
  // scoped to a single serverless instance.  On a multi-instance deployment
  // (Vercel, etc.) each cold-start instance has its own independent Map, making
  // the 50 req/60 s cap effectively per-instance rather than per-deployment.
  // A misconfigured CMS with a tight save-hook loop could therefore flood
  // purgeEdgeCache() calls (see below) across N parallel instances, each
  // independently capped at 50/min, yielding 50*N calls per minute with no
  // aggregate enforcement.  This mirrors the guard used by /api/newsletter and
  // /api/contact routes.
  if (isRealProduction() && !hasUpstash()) {
    console.error(
      "[revalidate] MISCONFIGURATION: Upstash Redis is not configured.\n" +
      "  The revalidation rate limit is ineffective on this deployment.\n" +
      "  Set UPSTASH_REDIS_REST_URL (https://) and UPSTASH_REDIS_REST_TOKEN\n" +
      "  in your deployment environment, then redeploy.\n" +
      "  Returning 503 until Upstash is configured."
    );
    return NextResponse.json(
      { error: "Revalidation endpoint is unavailable — Upstash Redis is not configured." },
      { status: 503, headers: { "Retry-After": "3600" } }
    );
  }

  // ── Secret validation ────────────────────────────────────────────────────
  // L-2 fix: validated BEFORE the per-IP rate limit below (previously ran
  // after it). An unauthenticated caller was paying for one Upstash pipeline
  // round-trip per request before being rejected for a bad/missing secret —
  // every other secret/CSRF-gated route in this codebase (contact,
  // newsletter, csrf) validates the caller before incurring the
  // rate-limit-store round-trip, so this endpoint now matches that ordering.
  // The Upstash-presence guard above still runs first since it's an
  // availability check, not a caller-auth check.
  //
  // REVALIDATE_SECRET must be set in the deployment environment.
  // If it is absent we return 500 rather than 401: a missing secret is a
  // server misconfiguration, not an authorisation failure from the caller.
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    console.error(
      "[revalidate] REVALIDATE_SECRET is not set. " +
        "Generate one with `openssl rand -hex 32` and add it to your " +
        "deployment environment variables. The endpoint is disabled until the " +
        "secret is configured."
    );
    return NextResponse.json(
      {
        error:
          "Revalidation endpoint is not configured (REVALIDATE_SECRET missing). " +
          "Contact the site administrator.",
        // L-4 fix: this 500 means "server misconfiguration" — distinct from
        // the edge_cache_purge_failed 500 below, which means "the request
        // was valid and authenticated but the CDN purge call itself failed."
        // A CMS should not retry this one; retrying won't help until an
        // operator sets REVALIDATE_SECRET.
        code: "secret_not_configured",
      },
      { status: 500 }
    );
  }

  // Compare the caller-supplied secret against our expected value using a
  // constant-time algorithm (D-3 fix).  This eliminates timing-oracle risk
  // for any secret length, including short/weak values an operator might set.
  const suppliedSecret = request.headers.get("x-revalidate-secret");
  if (!suppliedSecret || !safeCompare(suppliedSecret, secret)) {
    // Return 401 rather than 403: the caller may be a CMS that was
    // misconfigured with the wrong secret, not a malicious actor.
    return NextResponse.json(
      { error: "Invalid or missing revalidation secret" },
      { status: 401 }
    );
  }

  // ── D-6 fix: per-IP rate limit (fail-open) ───────────────────────────────
  // A CMS misconfiguration (e.g. a tight save-hook loop, a runaway deployment
  // pipeline) can send thousands of webhook calls per minute.  Each call
  // triggers purgeEdgeCache() for up to three paths (see below), which puts
  // pressure on any downstream CDN purge API once that integration exists.
  //
  // Limit: 50 req / IP / 60 s.  A CMS sending one webhook per article save
  // would have to publish 50 articles in one minute to hit this; that is
  // implausible for human-driven publishing.  If a large automated import
  // needs to bypass this, it should be done via a separate one-time migration
  // script that calls the CDN purge API directly, not via repeated webhook calls.
  //
  // M-3 fix: uses checkRateLimitFailOpen instead of checkRateLimit.
  // This endpoint is already protected by REVALIDATE_SECRET, so the primary
  // abuse vector (unauthenticated flooding) is blocked before rate-limiting is
  // reached.  A transient Upstash outage must not block CMS webhook deliveries
  // with 429s and cause stale content to persist for up to one ISR cycle.
  //
  // Returns 429 (not 401/403) so the CMS can distinguish rate-limiting from
  // an auth failure and can implement exponential back-off rather than retrying
  // immediately.
  const ip = getClientIp(request.headers);
  if (!await checkRateLimitFailOpen(`revalidate:${ip}`, 50, 60 * 1000, "[revalidate]")) {
    return NextResponse.json(
      { error: "Too many revalidation requests — please slow down your webhook calls." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const type = body.type;
  if (typeof type !== "string" || !["article", "category", "home"].includes(type)) {
    return NextResponse.json(
      { error: 'Missing or invalid "type" field — must be "article", "category", or "home"' },
      { status: 400 }
    );
  }

  // ── Determine which paths to revalidate ──────────────────────────────────
  let paths: string[];

  if (type === "article") {
    const categorySlug = body.categorySlug;
    const articleSlug = body.articleSlug;

    if (typeof categorySlug !== "string" || !categorySlug.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: "categorySlug" (string)' },
        { status: 400 }
      );
    }
    if (typeof articleSlug !== "string" || !articleSlug.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: "articleSlug" (string)' },
        { status: 400 }
      );
    }

    // Sanitise slugs — only lowercase alphanumerics and hyphens are valid slug
    // characters in this codebase.  Rejecting anything else prevents path
    // traversal via crafted slugs (e.g. "../../etc/passwd").
    const slugPattern = /^[a-z0-9-]+$/;
    if (!slugPattern.test(categorySlug.trim())) {
      return NextResponse.json(
        { error: 'Invalid "categorySlug" — must contain only lowercase letters, digits, and hyphens' },
        { status: 400 }
      );
    }
    if (!slugPattern.test(articleSlug.trim())) {
      return NextResponse.json(
        { error: 'Invalid "articleSlug" — must contain only lowercase letters, digits, and hyphens' },
        { status: 400 }
      );
    }

    // M-1 fix: look up the article by slug to obtain its author and tag slugs
    // so we can propagate revalidation to /author/<slug> and /tag/<slug> pages
    // without requiring the CMS webhook to send those fields. The lookup is
    // best-effort: if the article is not found in the local data (e.g. a newly
    // created article that has not yet been seeded into lib/articles.ts, or a
    // deletion), author and tag paths are simply omitted and only the canonical
    // URL set is purged. This is always at least as correct as the previous
    // behaviour, which never purged those paths at all.
    const matchedArticle = getArticleBySlug(articleSlug.trim());
    const authorSlug = matchedArticle?.author.slug;
    const tagSlugs = matchedArticle ? matchedArticle.tags.map(tagToSlug) : [];

    paths = articlePaths(categorySlug.trim(), articleSlug.trim(), authorSlug, tagSlugs);
  } else if (type === "category") {
    const categorySlug = body.categorySlug;

    if (typeof categorySlug !== "string" || !categorySlug.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: "categorySlug" (string)' },
        { status: 400 }
      );
    }

    const slugPattern = /^[a-z0-9-]+$/;
    if (!slugPattern.test(categorySlug.trim())) {
      return NextResponse.json(
        { error: 'Invalid "categorySlug" — must contain only lowercase letters, digits, and hyphens' },
        { status: 400 }
      );
    }

    paths = categoryPaths(categorySlug.trim());
  } else {
    // type === "home"
    paths = homePaths();
  }

  // ── Origin cache invalidation ─────────────────────────────────────────────
  // Resolution: now that `/`, `/news/[category]/[slug]`, `/author/[slug]`,
  // `/archive`, `/rss.xml`, `/sitemap.xml`, and `/article/[slug]` are
  // statically generated / ISR'd again (see the module doc comment above),
  // each path below corresponds to a real Next.js Full Route Cache / Data
  // Cache entry. revalidatePath() invalidates that entry at the origin so the
  // next request re-renders fresh content, regardless of the route's own
  // `revalidate` interval.
  // `/category/<slug>` and `/tag/<slug>` are included in `paths` for
  // completeness. M-3 fix: this comment used to say both routes "still
  // render dynamically in their own right" because they read `searchParams`
  // for sort/pagination, making revalidatePath() a harmless no-op for them —
  // that read has since moved into a "use client" child (CategoryArticleList
  // / TagArticleList) wrapped in `<Suspense>`, so both Server Components are
  // ISR-eligible (`revalidate = 3600`) and revalidatePath() is a real
  // invalidation for them too, same as `/author/<slug>`.
  // M-1 fix: `/archive`, `/rss.xml`, `/sitemap.xml`, `/author/<slug>`, and
  // `/tag/<slug>` paths are now included in the article paths set so a
  // publish/correct/retract webhook propagates to every cached surface that
  // shows the affected article, not just the article page and homepage.
  for (const path of paths) {
    // L-2 fix: /rss.xml and /sitemap.xml are Next.js Route Handlers, not
    // page routes. revalidatePath() only invalidates Full Route Cache entries
    // for page/layout routes — it has no effect on Route Handler responses,
    // which are governed by their own `revalidate` export and by Cloudflare
    // edge TTLs. Calling revalidatePath("/rss.xml") is a silent no-op that
    // adds misleading log output. These paths are still included in `paths`
    // for purgeEdgeCache() (the Cloudflare purge below), which is the
    // only mechanism that actually clears their edge-cached responses.
    if (path === "/rss.xml" || path === "/sitemap.xml") continue;

    try {
      revalidatePath(path);
    } catch (err) {
      // revalidatePath() throws only in exceptional cases (e.g. called
      // outside a request context). Log and continue with the remaining
      // paths rather than failing the whole request for one bad path.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[revalidate] revalidatePath("${path}") failed: ${message}`);
    }
  }

  // ── Edge-cache purge (Cloudflare) ────────────────────────────────────────
  // revalidatePath() above clears Next.js's own Full Route Cache / Data Cache
  // at the origin. When Cloudflare sits in front of this deployment it caches
  // HTML responses independently — stale HTML can remain at Cloudflare's edge
  // PoPs until the CDN TTL expires (up to 1 h for ISR routes, 1 year for
  // static routes, per the CDN-Cache-Control headers set in next.config.mjs).
  //
  // purgeEdgeCache() calls the Cloudflare Cache Purge API to evict exactly the
  // affected URLs so the next visitor gets fresh HTML immediately.
  //
  // Required environment variables:
  //   CLOUDFLARE_ZONE_ID         — Zone ID from: Cloudflare dashboard → domain → Overview.
  //   CLOUDFLARE_PURGE_API_TOKEN — Scoped Cloudflare API token with the single
  //                                permission "Zone – Cache Purge – Edit".
  //                                Generate at: https://dash.cloudflare.com/profile/api-tokens
  //   NEXT_PUBLIC_SITE_URL       — Full origin URL (e.g. https://faulter.news).
  //                                Already required at build time (check-env.mjs).
  //
  // If any variable is absent the purge is skipped (console.warn) and no error
  // is thrown — deployments that do NOT use Cloudflare operate without these
  // env vars. Origin-level ISR invalidation still happens via revalidatePath().
  //
  // Throws on Cloudflare API error so the caller's try/catch returns a
  // structured 500 { code: "edge_cache_purge_failed" } response (L-4 fix).
  async function purgeEdgeCache(paths: string[]): Promise<void> {
    const zoneId   = process.env.CLOUDFLARE_ZONE_ID;
    const apiToken = process.env.CLOUDFLARE_PURGE_API_TOKEN;
    const siteUrl  = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

    if (!zoneId || !apiToken || !siteUrl) {
      const missing = [
        !zoneId    && "CLOUDFLARE_ZONE_ID",
        !apiToken  && "CLOUDFLARE_PURGE_API_TOKEN",
        !siteUrl   && "NEXT_PUBLIC_SITE_URL",
      ]
        .filter(Boolean)
        .join(", ");
      console.warn(
        `[revalidate] Cloudflare edge-cache purge skipped — missing env var(s): ${missing}. ` +
          "Origin cache was still invalidated by revalidatePath(). " +
          "Set all three variables to enable immediate Cloudflare purge on publish."
      );
      return;
    }

    // `paths` are always exact routes (e.g. "/news/world/my-article"), never
    // wildcards/prefixes, so a plain files-only purge is sufficient — no split
    // into files/prefixes needed.
    const allUrls = paths.map((p) => `${siteUrl}${p}`);
    const purgeBody: { files: string[] } = { files: allUrls };

    // Network-level failure (DNS, TLS, timeout) is surfaced as a thrown Error
    // so the outer try/catch returns edge_cache_purge_failed (L-4 fix).
    //
    // cache: "no-store" — a cached purge response would silently no-op the
    // purge, leaving stale HTML at Cloudflare's edge while this route
    // reports success. signal: AbortSignal.timeout(...) — a hung Cloudflare
    // API response would otherwise hold this route handler open
    // indefinitely; 5 s matches the timeout used for the Cloudflare
    // Turnstile siteverify call in lib/turnstile.ts.
    let cfRes: Response;
    try {
      cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(purgeBody),
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        }
      );
    } catch (networkErr) {
      throw new Error(
        `Cloudflare purge_cache network error: ${
          networkErr instanceof Error ? networkErr.message : String(networkErr)
        }`
      );
    }

    const responseText = await cfRes.text();

    if (!cfRes.ok) {
      throw new Error(
        `Cloudflare purge_cache returned HTTP ${cfRes.status}: ${responseText}`
      );
    }

    let cfResult: { success: boolean; errors?: unknown[] };
    try {
      cfResult = JSON.parse(responseText) as { success: boolean; errors?: unknown[] };
    } catch {
      throw new Error(
        `Cloudflare purge_cache returned HTTP ${cfRes.status} but body ` +
          `was not valid JSON: ${responseText}`
      );
    }

    if (!cfResult.success) {
      throw new Error(
        `Cloudflare purge_cache API returned success=false. ` +
          `Errors: ${JSON.stringify(cfResult.errors ?? [])}`
      );
    }

    console.log(
      `[revalidate] Cloudflare edge-cache purged for: ${allUrls.join(", ")}`
    );
  }

  try {
    await purgeEdgeCache(paths);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[revalidate] purgeEdgeCache failed: ${message}`);
    // L-4 fix: distinguish this failure mode from every other error response
    // this route can return (400 bad request, 401 bad secret, 429 rate
    // limited). Without a stable `code`, a CMS integration that only checks
    // HTTP status would have no reliable way to tell "your secret is wrong,
    // stop retrying" (401) apart from "the CDN purge call itself failed,
    // retrying may help" (this 500) — and indiscriminate retries on a 401
    // just waste the CMS's own retry budget for no benefit. `paths` is
    // included so the caller can re-trigger purge for exactly these paths
    // without re-deriving them from the original request body.
    //
    // M-1 fix: the underlying `message` (e.g. a raw Cloudflare API error
    // body, "HTTP 403: ...", or "fetch failed: ...") is logged server-side
    // above but is NOT echoed back in the response. Even though this
    // endpoint is authenticated by REVALIDATE_SECRET, the underlying error
    // text can leak internal details — Cloudflare zone IDs, API token
    // error specifics, or network/DNS topology — to whatever system
    // receives the CMS webhook response. The client instead gets a fixed,
    // generic string; operators diagnose via server logs.
    return NextResponse.json(
      {
        error: "Revalidation failed. Check server logs for details.",
        code: "edge_cache_purge_failed",
        message: "Edge cache purge failed — see server logs",
        paths,
      },
      { status: 500 }
    );
  }

  const cfConfigured = !!(
    process.env.CLOUDFLARE_ZONE_ID &&
    process.env.CLOUDFLARE_PURGE_API_TOKEN &&
    process.env.NEXT_PUBLIC_SITE_URL
  );

  console.log(
    `[revalidate] Paths invalidated: ${paths.join(", ")}. ` +
    `Next.js ISR/Data Cache purged at origin via revalidatePath(). ` +
    (cfConfigured
      ? "Cloudflare edge-cache purge completed."
      : "Cloudflare purge skipped (CLOUDFLARE_ZONE_ID / CLOUDFLARE_PURGE_API_TOKEN not set).")
  );

  return NextResponse.json({
    revalidated: true,
    paths,
    note: cfConfigured
      ? "Next.js ISR cache invalidated at origin and Cloudflare edge-cache purged for these paths."
      : "Next.js ISR cache invalidated at origin. Cloudflare edge-cache purge was skipped — " +
        "set CLOUDFLARE_ZONE_ID, CLOUDFLARE_PURGE_API_TOKEN, and NEXT_PUBLIC_SITE_URL to enable it.",
  });
}

// All other HTTP methods are explicitly rejected.
// GET is blocked to prevent accidental revalidation via a URL in a browser.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
