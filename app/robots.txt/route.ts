import { siteUrl } from "@/lib/site";

// Dynamic robots.txt — always uses the correct NEXT_PUBLIC_SITE_URL from env.
// Replaces the static public/robots.txt that hardcoded the production domain.
export const dynamic = "force-static";
export const revalidate = 86400; // 24 h

export function GET() {
  const content = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    // H-2 fix: /api/unsubscribe must be reachable by browsers following
    // one-click unsubscribe links from email clients.  robots.txt is advisory
    // for crawlers, not browsers, so this entry exists purely as documentation
    // — it has no effect on a user clicking an unsubscribe link.  We add it
    // anyway so that any crawler-based link-checking tool (e.g. Screaming Frog)
    // does not flag the unsubscribe URL as disallowed.
    //
    // In robots.txt, more-specific rules take precedence over less-specific ones
    // in all major crawlers (Googlebot, Bingbot), so Allow: /api/unsubscribe
    // correctly overrides Disallow: /api/ below.
    "Allow: /api/unsubscribe",
    // M-7 fix: Allow /api/csrf explicitly so that aggressive bot-management
    // layers (Cloudflare Super Bot Fight Mode, CDN WAF rules) that honour
    // robots.txt for non-browser traffic cannot inadvertently block the CSRF
    // token-vending endpoint.  robots.txt is advisory for crawlers, not a
    // browser control — browsers always reach /api/csrf regardless.  The
    // explicit Allow mirrors the existing Allow: /api/unsubscribe pattern and
    // documents intent: this endpoint is deliberately reachable.
    //
    // In robots.txt, more-specific rules take precedence over less-specific ones
    // in all major crawlers (Googlebot, Bingbot), so Allow: /api/csrf correctly
    // overrides Disallow: /api/ for that specific path.
    "Allow: /api/csrf",
    // L-9: Disallow: /api/ covers all API routes, including /api/csp-report.
    // Crawlers are unlikely to POST to a report endpoint, but listing /api/
    // as disallowed ensures it does not appear in search indexes and removes
    // any ambiguity about intent.  /api/unsubscribe and /api/csrf are
    // explicitly allowed above because they need to be reachable; every other
    // /api/* path — including /api/csp-report — is intentionally blocked.
    "Disallow: /api/",
    "Disallow: /bookmarks",
    // L-1 fix: verified against the live CMS data layer (lib/articles.ts /
    // types/index.ts) — drafts are gated by a `status: "draft" | "published"
    // | "unpublished"` field, not by any slug naming convention. Every seed
    // slug is a plain slugified title (e.g. "g20-leaders-historic-climate-
    // accord-emergency-summit") with no "draft-" prefix anywhere. A
    // `Disallow: /news/*/draft-*` rule would therefore match nothing real
    // and silently do no work, so it has been removed rather than kept as
    // dead weight.
    //
    // Draft URLs are still safe: getArticleBySlug() filters on
    // `status === "published"` and returns `undefined` for anything else,
    // which every caller (article page, generateMetadata) turns into a 404 /
    // noindex response. That status-field check — not a slug pattern — is
    // the actual mechanism preventing drafts from being indexed or served,
    // and it requires no robots.txt support to function.
    //
    // If a future CMS migration introduces a predictable draft-slug pattern
    // (a prefix, suffix, or separate path), add the matching Disallow rule
    // back here at that time.
    // L-2: site.webmanifest is a browser-facing PWA metadata file, not a
    // content page.  Crawlers are unlikely to index it regardless, but an
    // explicit Disallow removes any ambiguity and keeps the crawl budget
    // focused on indexable content.  The file must remain publicly readable
    // by browsers — robots.txt is advisory for crawlers only, so this has no
    // effect on browsers fetching the manifest for PWA installation.
    "Disallow: /site.webmanifest",
    "",
    `Sitemap: ${siteUrl}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(content, {
    headers: {
      "Content-Type":    "text/plain; charset=utf-8",
      // Belt-and-suspenders: .txt is in Cloudflare's extension-based cache
      // default list, but explicit CDN-Cache-Control and Surrogate-Control
      // headers lock in the TTL so any zone Cache Rule or "Cache Everything"
      // override cannot accidentally change it.
      "Cache-Control":     "public, max-age=86400, stale-while-revalidate=86400",
      "CDN-Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
      "Surrogate-Control": "public, max-age=86400, stale-while-revalidate=86400",
    },
  });
}
