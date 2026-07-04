import { categories } from "@/lib/categories";
import { authors } from "@/lib/authors";
import { getPublishedArticlesForSitemap, getArticlesByAuthor } from "@/lib/articles";
import { absoluteUrl, SITE_LAUNCH_DATE } from "@/lib/site";

/**
 * Escape a string for safe embedding in XML text content.
 * Required for <loc> values — a CMS slug containing &, <, or > would
 * otherwise produce malformed XML that feed readers and Google reject.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Revalidate every hour so new published articles appear promptly.
export const revalidate = 3600;

// SITE_LAUNCH_DATE is imported from lib/site.ts — see comment there.
// It was previously defined locally in this file; centralising it in lib/site.ts
// ensures rss.xml and sitemap.xml always agree on the same value.

interface SitemapEntry {
  url: string;
  lastmod?: string;
  changefreq: string;
  priority: string;
}

export async function GET() {
  // Hoist the article fetch so we can derive freshness dates for every entry
  // type in one pass rather than calling the getter multiple times.
  const publishedArticles = getPublishedArticlesForSitemap();

  // Build a per-category map of the newest article date (YYYY-MM-DD) so
  // category listing pages reflect actual content changes, not render time.
  const categoryLatest = new Map<string, string>();
  for (const a of publishedArticles) {
    const d = (a.updatedAt ?? a.publishedAt).split("T")[0];
    const prev = categoryLatest.get(a.categorySlug);
    if (!prev || d > prev) categoryLatest.set(a.categorySlug, d);
  }

  // Site-wide newest article date — used for listing pages whose content
  // changes in step with article publishes (home, archive).
  // Falls back to SITE_LAUNCH_DATE when there are no published articles.
  const newestArticleDate = publishedArticles.reduce<string>(
    (max, a) => {
      const d = (a.updatedAt ?? a.publishedAt).split("T")[0];
      return d > max ? d : max;
    },
    SITE_LAUNCH_DATE
  );

  const staticPages: SitemapEntry[] = [
    // Home and archive list articles, so their lastmod tracks the newest
    // published article — not the ISR revalidation clock.
    { url: absoluteUrl("/"),        lastmod: newestArticleDate, changefreq: "daily",   priority: "1.0" },
    // Editorial pages: stable until a developer intentionally edits their source.
    // Update SITE_LAUNCH_DATE (above) when that happens.
    { url: absoluteUrl("/about"),   lastmod: SITE_LAUNCH_DATE,  changefreq: "monthly", priority: "0.5" },
    { url: absoluteUrl("/contact"), lastmod: SITE_LAUNCH_DATE,  changefreq: "monthly", priority: "0.4" },
    // /search is noindex — omit from sitemap to avoid signaling it as indexable.
    // /bookmarks is client-only and noindex — omit for the same reason.
    // L-1 fix: /subscribe is now noindex too (lead-gen form, no editorial
    // content) — omit from the sitemap for the same reason as above.
    { url: absoluteUrl("/archive"), lastmod: newestArticleDate, changefreq: "daily",   priority: "0.6" },
    { url: absoluteUrl("/privacy"), lastmod: SITE_LAUNCH_DATE,  changefreq: "yearly",  priority: "0.3" },
    { url: absoluteUrl("/terms"),   lastmod: SITE_LAUNCH_DATE,  changefreq: "yearly",  priority: "0.3" },
  ];

  // Each category page's lastmod is the date of its most recently published
  // (or updated) article — so Googlebot only revisits a category when its
  // content has actually changed.
  const categoryPages: SitemapEntry[] = categories.map((cat) => ({
    url: absoluteUrl(`/category/${cat.slug}`),
    lastmod: categoryLatest.get(cat.slug) ?? newestArticleDate,
    changefreq: "daily",
    priority: "0.7",
  }));

  // Only published articles appear in the sitemap — never drafts.
  // H-1 fix: getPublishedArticlesForSitemap() returns only the fields this
  // route needs (slug, categorySlug, updatedAt, publishedAt). The raw
  // Article[] is no longer exported; author.email cannot reach this route.
  const articlePages: SitemapEntry[] = publishedArticles
    .map((a) => ({
      url: absoluteUrl(`/news/${a.categorySlug}/${a.slug}`),
      lastmod: (a.updatedAt ?? a.publishedAt).split("T")[0],
      changefreq: "weekly",
      priority: "0.8",
    }));

  // MED-9 fix: only include authors who have at least one published article.
  // app/author/[slug]/page.tsx sets robots:{index:false} for empty author pages,
  // so submitting them to Google via the sitemap creates a noindex/sitemap
  // contradiction that triggers Search Console warnings.
  //
  // getArticlesByAuthor() sorts newest-first, so [0] is the most recent article.
  // Using that date means the author entry only refreshes when they actually
  // publish new content — same principle as category and article pages above.
  const authorPages: SitemapEntry[] = authors
    .flatMap((a) => {
      const authorArticles = getArticlesByAuthor(a.slug);
      if (authorArticles.length === 0) return [];
      const lastmod = authorArticles[0].publishedAt.split("T")[0];
      return [{
        url: absoluteUrl(`/author/${a.slug}`),
        lastmod,
        changefreq: "weekly",
        priority: "0.6",
      }];
    });

  const allPages = [
    ...staticPages,
    ...categoryPages,
    ...articlePages,
    ...authorPages,
  ];

  const urlElements = allPages
    .map((page) => {
      const lastmodTag = page.lastmod
        ? `\n    <lastmod>${page.lastmod}</lastmod>`
        : "";
      return `  <url>
    <loc>${xmlEscape(page.url)}</loc>${lastmodTag}
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlElements}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type":    "application/xml; charset=utf-8",
      // Belt-and-suspenders: .xml is in Cloudflare's extension-based cache
      // default list, but explicit CDN-Cache-Control and Surrogate-Control
      // headers lock in the TTL so any zone Cache Rule or "Cache Everything"
      // override cannot accidentally change it.
      // stale-if-error=86400: instructs Cloudflare to serve the last-known-good
      // sitemap for up to 24 h if the origin returns a 5xx during an outage,
      // preventing Googlebot de-prioritisation. Previously carried by the
      // (now-removed) next.config.mjs block for this path; moved here so the
      // route handler is the single source of truth.
      "Cache-Control":     "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400",
      "CDN-Cache-Control": "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400",
      "Surrogate-Control": "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400",
    },
  });
}
