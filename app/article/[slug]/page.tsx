/**
 * app/article/[slug]/page.tsx — Article page with provider-agnostic ad layout.
 *
 * Desktop: 2-column grid — main content (fluid) + sticky 300px sidebar.
 * Mobile:  Single stacked column; sidebar hidden below md breakpoint.
 *
 * Ad placement strategy (conservative Phase-1 default):
 *   - AD_SLOT_TOP     : Full-width leaderboard above the article body.
 *   - AD_SLOT_MID_1   : After ~300 words (between body sections 1 and 2).
 *   - AD_SLOT_MID_2   : After ~600 words (between body sections 2 and 3).
 *   - AD_SLOT_SIDEBAR : Sticky 300×600 in the right column (desktop only).
 *   - AD_SLOT_BOTTOM  : Full-width below the article, above related links.
 *
 * ── Fixes applied (production audit 2026-06-14) ──────────────────────────────
 *
 *   C-1  Raw JSON.stringify in dangerouslySetInnerHTML → safeJsonLd()
 *        Escapes </script>, U+2028, U+2029 so CMS fields cannot break out
 *        of the <script> tag and inject arbitrary HTML (XSS).
 *
 *   C-2  params typed as plain object → Promise<{slug:string}>
 *        Both generateMetadata and the page component now await params before
 *        destructuring, matching Next.js 15 App Router requirements.
 *
 *   C-3  Soft 200 "Article not found" JSX → notFound()
 *        A proper 404 response with the correct status code and noindex so
 *        missing slugs are never indexed by search engines.
 *
 *   H-1  Stub getArticle() removed → delegates to getArticleBySlug()
 *        Every /article/* URL previously served the same hardcoded placeholder.
 *        Now uses the same data layer as /news/[category]/[slug].
 *
 *   L-5  No CSP nonce on JSON-LD <script> → nonce read from x-nonce header
 *        Without the nonce the script is blocked by the production nonce-based
 *        CSP, preventing Google from receiving structured data.
 *
 *   M-1  No generateStaticParams → added; pre-renders all published slugs
 *        Unknown slugs still reach getArticleBySlug() and hit notFound().
 *
 * ── Fixes applied (production audit follow-up 2) ─────────────────────────────
 *
 *   This route previously read the CSP nonce via headers() (for the JSON-LD
 *   <script> below), and app/layout.tsx (an ancestor of every route) also
 *   called headers() to nonce its own inline hydration scripts. headers() is
 *   a Next.js Dynamic API — its presence anywhere in the render tree forces
 *   the whole route to render dynamically on every request, regardless of
 *   the `revalidate` export below, which silently defeated both this page's
 *   own static rendering and ISR.
 *
 *   Per the latest audit, both headers() calls have been removed: the CSP
 *   strategy in middleware.ts no longer issues a per-request nonce (it uses
 *   a static `script-src 'self' 'unsafe-inline' …` policy instead — see the
 *   comment there), so there is nothing left for this page or app/layout.tsx
 *   to read per request. `revalidate = false` below now actually takes
 *   effect: Next.js pre-renders every slug from generateStaticParams() at
 *   build time and serves that static HTML on every request.
 *
 *   getArticleBySlug() (used below) looks up by slug ALONE, with no category
 *   to disambiguate — a slug collision across categories would silently
 *   resolve to the wrong article. lib/articles.ts throws at module load if
 *   any two articles share a slug, and types/index.ts documents the same
 *   constraint as a required unique index once this moves to a CMS.
 */

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdSlot } from "@/components/ads/AdSlot";
import { SmartLinkWrapper } from "@/components/ads/SmartLinkWrapper";
import {
  AD_SLOT_TOP,
  AD_SLOT_MID_1,
  AD_SLOT_MID_2,
  AD_SLOT_BOTTOM,
  AD_SLOT_SIDEBAR,
} from "@/lib/ads/config";
import { getPublishedSlugs, getArticleBySlug, getRelatedArticles } from "@/lib/articles";
import { safeJsonLd } from "@/lib/jsonld";
import { absoluteUrl, siteName, STATIC_ASSET_VERSION } from "@/lib/site";

// ─── Finding 3 fix ────────────────────────────────────────────────────────────
//
// PREVIOUS STATE: `revalidate = false` — build-time static, no ISR.
// /news/[category]/[slug] used `revalidate = 3600` (hourly ISR). Both routes
// render the same article content. On-demand revalidation via POST /api/revalidate
// called revalidatePath() for /news/<category>/<slug> and purged that path from
// Cloudflare, but the /article/<slug> copy (served with CDN-Cache-Control:
// max-age=31536000) would stay stale at Cloudflare edge nodes for up to 365 days.
// If an article was corrected or retracted, the /article/ URL — which is what
// the ad-layout page uses for related-article links — would keep serving stale
// content to every visitor hitting a Cloudflare PoP for the full year TTL.
//
// FIX: align /article/[slug] to the same ISR schedule as /news/[category]/[slug]:
//
//   1. revalidate = 3600 here (was `false`) — Next.js treats this route as ISR:
//      paths from generateStaticParams() are pre-built at deploy time and
//      refreshed every hour at the origin, matching /news/[category]/[slug].
//
//   2. CDN-Cache-Control for /article/:slug updated from max-age=31536000 (1 yr)
//      to max-age=3600 (1 hr) in next.config.mjs — Cloudflare now evicts the
//      edge-cached HTML after 1 hour instead of 1 year.
//
//   3. /api/revalidate now includes /article/<slug> in its revalidatePath() calls
//      and Cloudflare purge list when an article changes, so corrections and
//      retractions take effect at both /news/ and /article/ URLs within seconds.

export const revalidate = 3600;

// ─── M-1 fix: generateStaticParams ───────────────────────────────────────────
//
// Declares the known slugs so Next.js pre-renders them at build time. Unknown
// slugs still reach getArticleBySlug() at request time (for any request that
// falls through to the server, e.g. during a redeploy) and hit notFound() —
// producing a proper 404.
//
// H-1 fix: uses getPublishedSlugs() instead of the raw articles array.
// getPublishedSlugs() returns only { slug: string }[] with no Article or
// PublicArticle objects — the internal Article[] is no longer exported.

export function generateStaticParams(): { slug: string }[] {
  return getPublishedSlugs();
}

// ─── C-2 fix: params typed as Promise ────────────────────────────────────────

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

// ─── H-1 fix: delegate to the real data layer ────────────────────────────────
//
// getArticleBySlug() filters status === "published" and strips author.email.
// Returns PublicArticle | undefined (not null).

async function getArticle(slug: string) {
  return getArticleBySlug(slug) ?? null;
}

// ─── generateMetadata ─────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  // C-2 fix: await params before destructuring
  const { slug } = await params;
  const article = await getArticle(slug);

  // C-3 note: notFound() is not supported inside generateMetadata.
  // Return noindex metadata; the page component will call notFound() properly.
  if (!article) {
    return {
      title: "Article Not Found",
      robots: { index: false, follow: false },
    };
  }

  // Audit fix [H-1]: canonical points to /news/ URL, which is the sitemap URL
  // and the route with editorial SEO authority. /article/ is the ad-layout alias.
  const canonicalUrl = absoluteUrl(`/news/${article.category.slug}/${article.slug}`);
  const ogImage = article.featuredImage ? absoluteUrl(article.featuredImage) : undefined;

  return {
    title: `${article.title} | ${siteName}`,
    description: article.excerpt,
    // /article/[slug] is an ad-layout alias for /news/[category]/[slug].
    // noindex prevents Google from indexing both URLs as separate pages.
    // The canonical above points to /news/ but canonicals are hints, not
    // directives — noindex is the reliable signal that this URL is not
    // the authoritative version.
    robots: { index: false, follow: true },
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: article.title,
      description: article.excerpt,
      type: "article",
      url: canonicalUrl,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      authors: [article.author.name],
      ...(ogImage && {
        images: [{ url: ogImage, width: 1200, height: 630, alt: article.featuredImageAlt }],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.excerpt,
      // Issue fix: twitter.images was previously omitted entirely, even
      // though openGraph.images (above) already had a correctly
      // absoluteUrl()-wrapped image available via `ogImage`. Without this,
      // Twitter/X card previews fell back to no image while Facebook/
      // LinkedIn/Slack previews (which read openGraph) rendered correctly —
      // an inconsistent, silently broken preview experience on one platform.
      // Reuses the same `ogImage` variable so both fields always stay in sync.
      ...(ogImage && { images: [ogImage] }),
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ArticlePage({ params }: ArticlePageProps) {
  // C-2 fix: await params before destructuring
  const { slug } = await params;
  const article = await getArticle(slug);

  // C-3 fix: proper 404 — not a soft 200 with "Article not found" JSX
  if (!article) {
    notFound();
  }

  // H-1 fix: use real data fields from PublicArticle (not local stub interface)
  // Audit fix [H-1]: canonical points to /news/ URL to match generateMetadata above.
  const canonicalUrl = absoluteUrl(`/news/${article.category.slug}/${article.slug}`);
  const authorUrl = absoluteUrl(`/author/${article.author.slug}`);

  // L-3 fix: toPublicArticle() (lib/articles.ts) now guarantees
  // sanitizedContent is present on every PublicArticle — it resolves the
  // pre-sanitized field server-side (falling back to
  // sanitizeArticleContent() on the raw content when needed) before
  // dropping the raw `content` field from the object entirely.
  // PublicArticle no longer carries `content` at all, so there's nothing
  // left to fall back to here even if it were needed.
  const safeContent = article.sanitizedContent;

  // Related articles from the real data layer (same logic as news route)
  const relatedArticles = getRelatedArticles(article.id);

  const publishedDate = new Date(article.publishedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // C-1 fix: safeJsonLd() instead of raw JSON.stringify().
  // Escapes </script>, <!--, -->, U+2028, U+2029 so CMS-sourced fields
  // cannot break out of the <script> tag (XSS).
  //
  // Build-fix: safeJsonLd() is called inline inside the JSX attribute below
  // (matching the pattern already used in app/news/[category]/[slug]/page.tsx)
  // rather than being pre-applied here. The "dangerouslySetInnerHTML guard"
  // ESLint rule (.eslintrc.json) only recognises the safeJsonLd(...) call
  // when it appears directly as the __html value in the JSX — assigning the
  // already-escaped string to a variable first and referencing the bare
  // identifier (the previous shape of this code) doesn't match that AST
  // selector and fails `next build`. The data is unescaped here and escaped
  // at the point of use; nothing about the XSS protection itself changes.
  const jsonLdData = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.excerpt,
    url: canonicalUrl,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt ?? article.publishedAt,
    author: {
      "@type": "Person",
      name: article.author.name,
      url: authorUrl,
    },
    publisher: {
      "@type": "Organization",
      name: siteName,
      logo: {
        "@type": "ImageObject",
        // M-4 fix: Google News rich results require a raster publisher logo
        // (PNG/JPEG/WebP). SVG is explicitly rejected by the Rich Results
        // validator and will not generate article rich snippets or Google
        // News thumbnails. /public/logo.png is a 600×60 placeholder PNG;
        // replace it with a real branded logo before launch.
        //
        // Google's logo constraints (from the Rich Results spec):
        //   • Width ≤ 600 px, height ≤ 60 px, aspect ratio ≥ 600:60 recommended
        //   • Format: PNG, JPEG, or WebP (not SVG, GIF, or ICO)
        //   • The logo must be readable on a white background
        //
        // REQUIRED BEFORE LAUNCH: replace /logo.png with your actual branded
        // raster logo. The placeholder is a solid-colour rectangle with the
        // site name as text — functional for rich-result validation testing
        // but not appropriate for production. See public/logo.png.
        url: absoluteUrl(`/logo.png?v=${STATIC_ASSET_VERSION}`),
        width: 600,
        height: 60,
      },
    },
    ...(article.featuredImage && {
      image: {
        "@type": "ImageObject",
        url: absoluteUrl(article.featuredImage),
        description: article.featuredImageAlt,
      },
    }),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
  };

  return (
    <>
      {/* Static CSP fix: no nonce attribute needed — production CSP now uses
          script-src 'self' 'unsafe-inline' …, see middleware.ts */}
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLdData) }}
      />

      {/* ── Top leaderboard (970×250 desktop / 320×50 mobile) ── */}
      <div className="max-w-screen-xl mx-auto px-4">
        <AdSlot slotId={AD_SLOT_TOP} />
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6">
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="mb-4 text-sm text-ink-muted dark:text-zinc-400 font-sans"
        >
          <Link href="/" className="hover:underline">
            Home
          </Link>
          <span className="mx-2" aria-hidden="true">
            /
          </span>
          <Link
            href={`/category/${article.category.slug}`}
            className="hover:underline capitalize"
          >
            {article.category.name}
          </Link>
        </nav>

        {/*
         * Two-column grid:
         *   col 1 (main): fluid, min-w-0 prevents long-word overflow
         *   col 2 (sidebar): fixed 300 px, hidden on mobile
         */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8 items-start">

          {/* ══ Main Content Column ══ */}
          <main>
            <header className="mb-6">
              <span className="text-xs font-semibold uppercase tracking-widest text-accent font-sans">
                {article.category.name}
              </span>
              <h1 className="mt-2 text-3xl md:text-4xl font-bold leading-tight text-ink dark:text-white font-serif">
                {article.title}
              </h1>
              <p className="mt-3 text-lg text-ink-secondary dark:text-zinc-300 font-serif leading-relaxed">
                {article.excerpt}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-muted dark:text-zinc-400 font-sans">
                <span>
                  By{" "}
                  <Link
                    href={authorUrl}
                    className="font-semibold text-ink dark:text-zinc-200 hover:underline"
                  >
                    {article.author.name}
                  </Link>
                </span>
                <span aria-hidden="true">·</span>
                <time dateTime={article.publishedAt}>{publishedDate}</time>
                {article.readingTime && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{article.readingTime} min read</span>
                  </>
                )}
              </div>
            </header>

            {/* Hero image */}
            {article.featuredImage && (
              <div className="relative w-full aspect-[16/9] mb-6 overflow-hidden rounded-sm bg-paper-secondary dark:bg-zinc-800">
                <Image
                  src={article.featuredImage}
                  alt={article.featuredImageAlt}
                  fill
                  priority
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, calc(100vw - 332px)"
                />
              </div>
            )}

            {/* ── Article body with mid-content ads injected ── */}
            <article
              className="prose prose-lg dark:prose-invert max-w-none font-serif"
              dangerouslySetInnerHTML={{ __html: safeContent }}
            />

            {/* Mid-content ads — rendered after the body */}
            <AdSlot slotId={AD_SLOT_MID_1} className="my-6" />
            <AdSlot slotId={AD_SLOT_MID_2} className="my-6" />

            {/* Tags */}
            {article.tags.length > 0 && (
              <div className="mt-8 flex flex-wrap gap-2">
                {article.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/tag/${tag.toLowerCase().replace(/\s+/g, "-")}`}
                    className="px-3 py-1 text-xs font-sans font-semibold uppercase tracking-wide border border-border dark:border-border-dark text-ink-muted dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            )}

            {/* Bottom ad (970×250 desktop / 300×250 mobile) */}
            <AdSlot slotId={AD_SLOT_BOTTOM} className="mt-8" />

            {/* Related articles */}
            {relatedArticles.length > 0 && (
              <section className="mt-8 border-t border-border dark:border-border-dark pt-6">
                <h2 className="text-lg font-bold font-serif text-ink dark:text-white mb-4">
                  Related Stories
                </h2>
                <ul className="space-y-3">
                  {relatedArticles.map((related) => (
                    <li key={related.slug}>
                      {/*
                       * M-2 fix: SmartLinkWrapper requires NEXT_PUBLIC_SMART_LINK_URL
                       * AND NEXT_PUBLIC_SMART_LINK_CONFIRMED="true" before it does
                       * anything — see the GOVERNANCE comment in
                       * components/ads/SmartLinkWrapper.tsx. When active, it opens
                       * the monetisation smart link in a new tab on click and now
                       * renders a small disclosure glyph so that's no longer silent.
                       */}
                      <SmartLinkWrapper href={`/news/${related.category.slug}/${related.slug}`}>
                        <Link
                          href={`/news/${related.category.slug}/${related.slug}`}
                          className="group flex flex-col gap-0.5"
                        >
                          <span className="text-xs font-semibold uppercase tracking-wide text-accent font-sans">
                            {related.category.name}
                          </span>
                          <span className="font-serif text-ink dark:text-zinc-200 group-hover:underline leading-snug">
                            {related.title}
                          </span>
                        </Link>
                      </SmartLinkWrapper>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </main>

          {/* ══ Sidebar Column (hidden on mobile) ══ */}
          <aside className="hidden md:block">
            {/*
             * Sticky: stays at the top of the viewport (8px gap) while the
             * main column still has room; scrolls normally after that.
             */}
            <div className="sticky top-2 space-y-6">
              <AdSlot slotId={AD_SLOT_SIDEBAR} />

              {/* Newsletter promo below the sidebar ad */}
              <div className="border border-border dark:border-border-dark p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted dark:text-zinc-500 font-sans mb-1">
                  Newsletter
                </p>
                <p className="text-sm font-serif text-ink dark:text-zinc-300 mb-3">
                  Get the day's top stories delivered to your inbox every morning.
                </p>
                <Link
                  href="/newsletter"
                  className="block w-full text-center py-2 px-4 bg-ink dark:bg-white text-paper dark:text-ink text-sm font-sans font-semibold hover:opacity-80 transition-opacity"
                >
                  Subscribe — it's free
                </Link>
              </div>
            </div>
          </aside>

        </div>
      </div>
    </>
  );
}
