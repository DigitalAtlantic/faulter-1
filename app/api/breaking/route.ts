import { NextResponse } from "next/server";
import { getBreakingArticles } from "@/lib/articles";

/**
 * GET /api/breaking
 *
 * ── Finding 4 fix (Option A) ──────────────────────────────────────────────────
 *
 * Returns the set of currently-breaking articles so the BreakingNewsTicker
 * Client Component can fetch fresh data on page load instead of relying on
 * the stale ISR snapshot that was baked into the root layout at render time.
 *
 * Before this fix, BreakingNewsTicker was a Server Component rendered inside
 * the root layout (app/layout.tsx). Because it called getBreakingArticles()
 * at ISR render time, its output was baked into every route's HTML snapshot.
 * This meant:
 *   • A new breaking story published after a route's last ISR render would
 *     not appear in that route's ticker until that specific route was
 *     re-rendered — which could be up to the full max-age (1 hour) away.
 *   • Different routes cached at different times could show different breaking
 *     stories in their ticker, making the site appear inconsistent.
 *   • A retraction or correction to a breaking article required every cached
 *     route to be purged simultaneously to remove the story from the ticker.
 *
 * With the Option A fix:
 *   • BreakingNewsTicker becomes a "use client" component that fetches this
 *     endpoint on mount. The HTML snapshot contains a skeleton/fallback; the
 *     live ticker content loads fresh on every page visit.
 *   • The ticker is decoupled from ISR snapshots entirely — no matter how stale
 *     a route's HTML is, the ticker always reflects the current breaking state.
 *   • Cache invalidation for the ticker no longer requires purging every route;
 *     only this endpoint's response (short TTL) needs to be fresh.
 *
 * ── Response shape ───────────────────────────────────────────────────────────
 * 200 {
 *   "articles": [
 *     {
 *       "title":    "...",
 *       "slug":     "...",
 *       "category": { "slug": "..." }
 *     }
 *   ]
 * }
 *
 * The response is intentionally minimal — only the fields the ticker actually
 * renders (title for text, category.slug + slug for the link href). This keeps
 * the payload small and avoids shipping content or sanitizedContent to the
 * browser unnecessarily.
 *
 * ── Caching ──────────────────────────────────────────────────────────────────
 * Cache-Control:     public, s-maxage=60, stale-while-revalidate=300
 * CDN-Cache-Control:  public, max-age=60, stale-while-revalidate=300
 * Surrogate-Control:  public, max-age=60, stale-while-revalidate=300
 *
 * All three are sent (cache-audit fix) to match the pattern used everywhere
 * else cacheable in this codebase — Cache-Control for browsers/Vercel edge,
 * CDN-Cache-Control as Cloudflare's preferred signal, Surrogate-Control for
 * Fastly/Varnish/RFC-compliant proxies (stripped before the browser sees it).
 *
 * s-maxage=60 means Cloudflare (and any other shared cache) will hold the
 * response for 60 seconds before revalidating. This is intentionally short:
 * the main benefit of Option A is ticker freshness, so we want a low TTL.
 * stale-while-revalidate=300 allows Cloudflare to serve the stale response for
 * up to 5 more minutes while fetching a fresh copy in the background — prevents
 * a cache miss from adding latency to the ticker render on page load.
 *
 * On the CMS revalidation webhook: the caller may also call
 * POST /api/revalidate with type "article" to purge this endpoint from
 * Cloudflare's edge cache immediately, rather than waiting for s-maxage=60 to
 * expire. The purgeEdgeCache() call in route.ts adds "/api/breaking" to the
 * purge list when type === "article" so CMS webhooks keep the ticker fresh
 * without any extra configuration.
 *
 * ── Security ─────────────────────────────────────────────────────────────────
 * No authentication — this is public data already displayed on every page.
 * Rate limiting is not applied here because:
 *   • The response is cached at the edge (Cloudflare) and at the CDN layer,
 *     so repeated requests from many clients hit the cache, not this handler.
 *   • The data returned is the same for every caller; there is nothing to
 *     brute-force or enumerate.
 *   • The underlying getBreakingArticles() call is a synchronous in-memory
 *     filter — CPU cost is negligible.
 * If this endpoint is ever backed by a database, add rate limiting at that
 * point using checkRateLimitFailOpen() from lib/upstash.ts.
 */

/** Minimal breaking-article shape sent to the client ticker. */
interface BreakingItem {
  title:    string;
  slug:     string;
  category: { slug: string };
}

export async function GET(): Promise<NextResponse> {
  const breaking = getBreakingArticles();

  const articles: BreakingItem[] = breaking.map((a) => ({
    title:    a.title,
    slug:     a.slug,
    category: { slug: a.category.slug },
  }));

  return NextResponse.json(
    { articles },
    {
      headers: {
        // Short shared-cache TTL for freshness; stale-while-revalidate avoids
        // cache-miss latency during background revalidation.
        //
        // Cache-audit fix: this previously set only Cache-Control. Every other
        // cacheable response in this codebase (next.config.mjs's headers(),
        // robots.txt, sitemap.xml, rss.xml) explicitly sends all three cache
        // headers as deliberate, documented redundancy:
        //   Cache-Control     — browsers + Vercel's own edge cache.
        //   CDN-Cache-Control — Cloudflare's preferred, higher-priority signal.
        //   Surrogate-Control — Fastly/Varnish/RFC-compliant proxies; stripped
        //                       before reaching the browser.
        // The Terraform cache_rules.tf rule for this route uses
        // edge_ttl = { mode = "respect_origin" }, which does read s-maxage
        // from Cache-Control today — so this was not a live caching bug — but
        // relying on that single header is the only inconsistency with the
        // rest of the app's belt-and-suspenders pattern. Adding the other two
        // headers here removes that gap and matches every other route.
        "Cache-Control":     "public, s-maxage=60, stale-while-revalidate=300",
        "CDN-Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "Surrogate-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}

// Reject all non-GET methods.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
