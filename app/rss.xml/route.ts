// Revalidate every hour — matches article publish cadence.
export const revalidate = 3600;

import { getLatestArticles } from "@/lib/articles";
import { absoluteUrl, siteName, siteDescription, SITE_LAUNCH_DATE } from "@/lib/site";
// H-4: Strip any HTML tags that a rich-text CMS editor may have accidentally
// saved into an excerpt field.  escapeCdata() alone only prevents CDATA
// injection — it does not remove markup that RSS readers (which treat
// <description> CDATA as HTML) would render as live elements.
import { sanitizeText } from "@/lib/sanitize";

/**
 * Escape a string for safe embedding inside an XML CDATA section.
 *
 * CDATA sections end at the first occurrence of "]]>".  If article text
 * contains that exact sequence, the CDATA block closes prematurely and the
 * remaining content is parsed as raw XML — opening an injection path.
 *
 * The canonical fix is to split the closing sequence across two adjacent
 * CDATA blocks: "]]>" → "]]]]><![CDATA[>"
 */
function escapeCdata(s: string): string {
  return s.replace(/]]>/g, "]]]]><![CDATA[>");
}

/**
 * Escape a string for safe embedding in XML text content AND inside
 * double-quoted XML attributes.
 *
 * Required for elements like <category> that are not wrapped in CDATA, and
 * for attribute values such as the `url` on <media:content> (H-1 fix).
 * A category name containing &, <, or > would otherwise produce malformed
 * XML; a `"` inside a double-quoted attribute value would let the
 * attacker break out of the attribute and inject arbitrary markup, which is
 * exactly the vector H-1 identified for unescaped CDN image URLs.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * M-7: Emit a <media:content> element only for raster image formats that
 * feed readers reliably render as thumbnails (JPEG, PNG, WebP, GIF, AVIF).
 *
 * SVG is excluded because the majority of RSS clients either refuse SVG
 * outright or display a broken-image placeholder.  The current article images
 * are all SVG paths served from /article-images/*.svg, so this function
 * returns an empty string for all of them — suppressing the element rather
 * than emitting a tag that renders as a blank thumbnail.
 *
 * When the image pipeline is migrated to R2/S3/CDN (real JPEG/WebP files),
 * this function will automatically start emitting the tag for those URLs
 * without any further changes.  The only thing that changes is the file
 * extension on the stored path.
 *
 * `medium="image"` is included per the Media RSS spec so aggregators that
 * support multiple media types (video, audio, image) know to render this as
 * an image thumbnail.
 *
 * H-1 fix: the `url` attribute is passed through xmlEscape() before being
 * interpolated into the double-quoted attribute. Real CDN/image-optimizer
 * URLs (Cloudinary, imgix, Vercel image optimization, S3 presigned URLs)
 * routinely contain `?`/`&` query parameters, and an unescaped `&` breaks
 * XML well-formedness for every feed consumer, while an unescaped `"` would
 * allow attribute/tag injection. Every other dynamic value in this feed is
 * already escaped (escapeCdata()/xmlEscape()); this keeps the attribute
 * consistent with that pattern instead of being a silent exception that
 * only happens to be safe today because images are static SVG paths.
 *
 * @param imageUrl - Absolute URL of the article's featured image.
 * @returns A <media:content> XML element string, or an empty string for SVG.
 */
function mediaContentTag(imageUrl: string): string {
  // Extract the pathname so the check works regardless of whether the URL
  // is absolute (https://faulter.news/article-images/art-001.svg) or the
  // raw path (/article-images/art-001.svg) passed before absoluteUrl().
  let pathname: string;
  try {
    pathname = new URL(imageUrl).pathname;
  } catch {
    // absoluteUrl() always produces a valid URL; this catch is a safety net
    // for any unexpected value during future CMS migration.
    pathname = imageUrl;
  }

  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  const RASTER_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

  if (!RASTER_FORMATS.has(ext)) return "";

  return `      <media:content url="${xmlEscape(imageUrl)}" medium="image"/>
`;
}

export async function GET() {
  // H-5: Defensive status guard — getLatestArticles() already filters
  // status === "published", but this call-site filter ensures the RSS feed
  // stays draft-free even if the getter is ever loosened (e.g. for an admin
  // preview mode).  Belt-and-suspenders: the cost is one array pass; the risk
  // of omitting it is leaking unpublished articles to every feed reader.
  const articles = getLatestArticles(20).filter((a) => a.status === "published");

  // Derive lastBuildDate from the newest article rather than from the current
  // clock.  new Date().toUTCString() was the only timestamp in the feed that
  // did not reflect actual content freshness: on an ISR hit the clock advances
  // but the content is identical, so every cached response carried a different
  // lastBuildDate — defeating conditional-GET and making cache validators see
  // the feed as perpetually dirty.  Using the most-recent publishedAt keeps the
  // field stable across revalidation cycles when no new articles have landed.
  const newestArticleMs = articles.length > 0
    ? Math.max(...articles.map((a) => new Date(a.publishedAt).getTime()))
    : new Date(SITE_LAUNCH_DATE).getTime(); // stable fallback — shared constant from lib/site.ts
  const lastBuildDate = new Date(newestArticleMs).toUTCString();

  // Audit fix: siteName/siteDescription (lib/site.ts) are hardcoded literals
  // today and contain no XML metacharacters, so this was not an active
  // injection vector — but every other dynamic value in this feed (item
  // title/link/description/creator/category, the channel <link>) is already
  // passed through xmlEscape() or wrapped in CDATA. Leaving these two as the
  // sole unescaped exception meant a future edit (e.g. "News & Analysis", or
  // sourcing either value from an env var/CMS field) would silently produce
  // malformed XML with no warning — the same class of "safe today only by
  // coincidence" gap the H-1 fix above closed for image URLs.
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xmlEscape(siteName)}</title>
    <link>${xmlEscape(absoluteUrl("/"))}</link>
    <description>${xmlEscape(siteDescription)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${xmlEscape(absoluteUrl("/rss.xml"))}" rel="self" type="application/rss+xml"/>
${articles.map((a) => {
  // Security: only use author.name here — never author.email or any other
  // internal field.  The RSS spec allows "email (Name)" in dc:creator but
  // exposing staff email addresses in a public feed enables harvesting and
  // phishing, so we intentionally omit it.
  const authorName = a.author.name;
  return `    <item>
      <title><![CDATA[${escapeCdata(a.title)}]]></title>
      <link>${xmlEscape(absoluteUrl(`/news/${a.category.slug}/${a.slug}`))}</link>
      <guid isPermaLink="true">${xmlEscape(absoluteUrl(`/news/${a.category.slug}/${a.slug}`))}</guid>
      <description><![CDATA[${escapeCdata(sanitizeText(a.excerpt))}]]></description>
      <pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>
      <dc:creator><![CDATA[${escapeCdata(authorName)}]]></dc:creator>
      <category>${xmlEscape(a.category.name)}</category>
${mediaContentTag(absoluteUrl(a.featuredImage))}    </item>`;
}).join("\n")}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type":    "application/rss+xml; charset=utf-8",
      // Belt-and-suspenders: Cache-Control alone is sufficient for Cloudflare's
      // extension-based cache default (.xml), but CDN-Cache-Control and
      // Surrogate-Control lock in the TTL explicitly so any zone-level Cache
      // Rule or "Cache Everything" override cannot accidentally change it.
      // stale-if-error=86400: instructs Cloudflare to serve the last-known-good
      // feed for up to 24 h if the origin returns a 5xx during an outage,
      // preventing Googlebot de-prioritisation and dropped RSS subscriber alerts.
      // Previously carried by the (now-removed) next.config.mjs block for this
      // path; moved here so the route handler is the single source of truth.
      "Cache-Control":     "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400",
      "CDN-Cache-Control": "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400",
      "Surrogate-Control": "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400",
    },
  });
}
