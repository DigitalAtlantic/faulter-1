import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getArticleBySlug, getRelatedArticles, getPublishedCategorySlugs, getPublishedArticles } from "@/lib/articles";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { ArticleMeta } from "@/components/ui/ArticleMeta";
import { ShareButtons } from "@/components/ui/ShareButtons";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { NewsletterSignup } from "@/components/ui/NewsletterSignup";
import { Sidebar } from "@/components/layout/Sidebar";
import { ReadingControls } from "@/components/articles/ReadingControls";
import { ReadingProgress } from "@/components/articles/ReadingProgress";
import { formatDate } from "@/lib/utils";
import { absoluteUrl, siteName, STATIC_ASSET_VERSION } from "@/lib/site";
import { safeJsonLd } from "@/lib/jsonld";

// Static CSP fix: this route no longer calls headers() (directly, or
// transitively through app/layout.tsx) — see middleware.ts and
// app/layout.tsx for the CSP-strategy change that removed the per-request
// nonce. With no Dynamic API usage left, Next.js can pre-render every path
// returned by generateStaticParams() below at build time and revalidate it
// on the schedule set here, instead of silently bailing out to fully
// dynamic SSR on every request.
export const revalidate = 3600;

interface ArticlePageProps {
  params: Promise<{ category: string; slug: string }>;
}

export async function generateStaticParams() {
  // Only pre-render published articles — drafts are never pre-built.
  // getArticleBySlug already enforces the published filter at lookup time;
  // this filter here ensures the static path list itself contains no drafts.
  //
  // H-1 fix: uses getPublishedCategorySlugs() instead of the raw articles
  // array. The internal Article[] is no longer exported; only typed accessor
  // functions are available from lib/articles.ts.
  return getPublishedCategorySlugs();
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { category: _category, slug } = await params;
  const article = getArticleBySlug(slug);
  // getArticleBySlug() already returns undefined for drafts — it enforces
  // the published filter internally.  A redundant article.status check here
  // would suggest to future readers that status must be re-verified after
  // every call, which is misleading noise.  The !article guard is sufficient.
  if (!article) {
    // noindex + nocanonical for missing/unpublished articles.
    // Setting robots.index=false tells crawlers to drop the URL.
    // Omitting alternates.canonical prevents a self-referencing canonical
    // from signaling to search engines that this URL is authoritative.
    return {
      title: "Article Not Found",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: article.title,
    description: article.excerpt,
    authors: [{ name: article.author.name }],
    keywords: article.tags,
    alternates: {
      canonical: absoluteUrl(`/news/${article.category.slug}/${article.slug}`),
    },
    openGraph: {
      title: article.title,
      description: article.excerpt,
      type: "article",
      url: absoluteUrl(`/news/${article.category.slug}/${article.slug}`),
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      authors: [article.author.name],
      tags: article.tags,
      // Issue fix: article.featuredImage is a root-relative path (e.g.
      // "/article-images/art-001-world.svg") — see types/index.ts. Social
      // scrapers (Facebook, LinkedIn, Slack, etc.) require an absolute URL
      // for og:image and will fail to resolve a relative path, silently
      // dropping the preview image. absoluteUrl() resolves it against
      // NEXT_PUBLIC_SITE_URL, matching the same wrapping already applied to
      // the JSON-LD `image` field below.
      images: [{ url: absoluteUrl(article.featuredImage), alt: article.featuredImageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.excerpt,
      // Same fix as openGraph.images above — Twitter/X also requires an
      // absolute URL for card image resolution.
      images: [absoluteUrl(article.featuredImage)],
    },
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { category, slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article || article.status !== "published") notFound();
  if (article.category.slug !== category) notFound();

  // Static CSP fix: the JSON-LD <script> below no longer needs a nonce
  // attribute. Production CSP now uses `script-src 'self' 'unsafe-inline' …`
  // (see middleware.ts), which permits this inline script without one.

  const related = getRelatedArticles(article.id);
  // H-1 fix: getPublishedArticles() returns PublicArticle[] directly — the
  // raw `articles` export no longer exists and toPublicArticle() is no longer
  // needed here. author.email is structurally absent from PublicArticle so it
  // cannot leak even if the prevArticle/nextArticle objects were forwarded
  // further than .title/.slug/.category (which are all that's actually rendered).
  const published = getPublishedArticles();
  const currentIndex = published.findIndex((a) => a.id === article.id);
  const prevArticle = currentIndex > 0 ? published[currentIndex - 1] : null;
  const nextArticle =
    currentIndex < published.length - 1 ? published[currentIndex + 1] : null;
  const articleUrl = absoluteUrl(
    `/news/${article.category.slug}/${article.slug}`
  );
  // L-3 fix: toPublicArticle() (lib/articles.ts) now guarantees
  // sanitizedContent is present on every PublicArticle — it resolves the
  // pre-sanitized field server-side (falling back to
  // sanitizeArticleContent() on the raw content when needed, e.g. during a
  // MongoDB migration window where a freshly ingested document hasn't been
  // through the CMS save hook yet) before dropping the raw `content` field
  // from the object entirely. PublicArticle no longer carries `content` at
  // all, so there's nothing left to fall back to here.
  const safeContent = article.sanitizedContent;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.excerpt,
    // image must be an absolute URL and is expected as an array by Google's
    // Rich Results validator. width/height help crawlers avoid a HEAD request.
    image: [absoluteUrl(article.featuredImage)],
    datePublished: article.publishedAt,
    dateModified: article.updatedAt ?? article.publishedAt,
    // author as an array is the spec-correct form (a single-element array
    // is valid and future-proofs co-authored articles).
    author: [
      {
        "@type": "Person",
        name: article.author.name,
        url: absoluteUrl(`/author/${article.author.slug}`),
      },
    ],
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
    mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
    keywords: article.tags.join(", "),
    articleSection: article.category.name,
  };

  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      <ReadingProgress />

      <div className="bg-paper-warm dark:bg-zinc-900 border-b border-border dark:border-border-dark">
        <div className="max-w-screen-xl mx-auto px-5 py-2">
          <nav
            className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="hover:text-accent transition-colors">
              Home
            </Link>
            <span>/</span>
            <Link
              href={`/category/${article.category.slug}`}
              className="hover:text-accent transition-colors"
            >
              {article.category.name}
            </Link>
            <span>/</span>
            <span className="text-ink-tertiary dark:text-zinc-400 line-clamp-1">
              {article.title}
            </span>
          </nav>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-5 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
          <article className="min-w-0" id="article-content">
            <header className="mb-6">
              {article.isBreaking && (
                <span className="breaking-badge mb-3 inline-block">Breaking</span>
              )}
              <div className="mb-3">
                <CategoryBadge
                  name={article.category.name}
                  slug={article.category.slug}
                />
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-black text-ink dark:text-zinc-100 leading-tight mb-5">
                {article.title}
              </h1>
              <p className="font-sans text-lg text-ink-secondary dark:text-zinc-400 leading-relaxed mb-6 border-l-4 border-accent pl-4">
                {article.excerpt}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-t border-b border-border dark:border-border-dark">
                <ArticleMeta
                  author={article.author}
                  publishedAt={article.publishedAt}
                  readingTime={article.readingTime}
                  size="md"
                  showAvatar
                />
                <div className="flex items-center gap-3">
                  <ReadingControls />
                  <BookmarkButton articleId={article.id} showLabel />
                  <ShareButtons title={article.title} url={articleUrl} />
                </div>
              </div>
            </header>

            <figure className="mb-8">
              <div className="relative aspect-[16/9] overflow-hidden">
                <Image
                  src={article.featuredImage}
                  alt={article.featuredImageAlt}
                  fill
                  priority
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 75vw, 900px"
                />
              </div>
              {article.featuredImageCaption && (
                <figcaption className="text-xs text-ink-muted dark:text-zinc-500 font-sans mt-2 italic">
                  {article.featuredImageCaption}
                </figcaption>
              )}
            </figure>

            <div
              className="article-body"
              dangerouslySetInnerHTML={{ __html: safeContent }}
            />

            {article.updatedAt && (
              <p className="text-xs text-ink-muted dark:text-zinc-500 font-sans mt-6 pt-4 border-t border-border dark:border-border-dark">
                Last updated: {formatDate(article.updatedAt)}
              </p>
            )}

            {article.tags.length > 0 && (
              <div className="mt-8 pt-6 border-t border-border dark:border-border-dark">
                <span className="text-xs font-sans font-semibold uppercase tracking-widest text-ink-muted dark:text-zinc-500 mr-3">
                  Tags:
                </span>
                {article.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/search?q=${encodeURIComponent(tag)}`}
                    className="inline-block text-xs font-sans font-medium px-3 py-1 border border-border dark:border-border-dark
                               text-ink-secondary dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors mr-2 mb-2"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-border dark:border-border-dark flex flex-wrap items-center gap-4">
              <ShareButtons title={article.title} url={articleUrl} />
              <BookmarkButton articleId={article.id} showLabel />
            </div>

            <div className="mt-10 p-6 border border-border dark:border-border-dark bg-paper-warm dark:bg-zinc-900">
              <div className="flex gap-4">
                <Link
                  href={`/author/${article.author.slug}`}
                  className="flex-shrink-0"
                >
                  <Image
                    src={article.author.avatar}
                    alt={article.author.name}
                    width={64}
                    height={64}
                    className="rounded-full object-cover"
                  />
                </Link>
                <div>
                  <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-1">
                    About the author
                  </p>
                  <Link
                    href={`/author/${article.author.slug}`}
                    className="font-serif text-lg font-bold text-ink dark:text-zinc-100 hover:text-accent transition-colors"
                  >
                    {article.author.name}
                  </Link>
                  <p className="text-xs text-ink-muted dark:text-zinc-500 font-sans mb-2">
                    {article.author.role}
                  </p>
                  <p className="text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed">
                    {article.author.bio}
                  </p>
                </div>
              </div>
            </div>

            <NewsletterSignup variant="inline" />

            {related.length > 0 && (
              <section className="mt-10" aria-labelledby="related-heading">
                <div className="mb-6 pb-3 border-b-2 border-ink dark:border-zinc-100">
                  <h2
                    id="related-heading"
                    className="font-serif text-xl font-bold text-ink dark:text-zinc-100"
                  >
                    Related Stories
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {related
                    .slice(0, 3)
                    .map((a) => (
                      <ArticleCard key={a.id} article={a} variant="grid" />
                    ))}
                </div>
              </section>
            )}

            <nav
              className="mt-10 pt-8 border-t-2 border-ink dark:border-zinc-100 grid grid-cols-2 gap-6"
              aria-label="Article navigation"
            >
              {prevArticle ? (
                <Link
                  href={`/news/${prevArticle.category.slug}/${prevArticle.slug}`}
                  className="group"
                >
                  <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-ink-muted dark:text-zinc-500">
                    ← Previous
                  </span>
                  <p className="font-serif text-sm font-bold text-ink dark:text-zinc-100 group-hover:text-accent transition-colors leading-snug mt-1 line-clamp-2">
                    {prevArticle.title}
                  </p>
                </Link>
              ) : (
                <div />
              )}
              {nextArticle ? (
                <Link
                  href={`/news/${nextArticle.category.slug}/${nextArticle.slug}`}
                  className="group text-right"
                >
                  <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-ink-muted dark:text-zinc-500">
                    Next →
                  </span>
                  <p className="font-serif text-sm font-bold text-ink dark:text-zinc-100 group-hover:text-accent transition-colors leading-snug mt-1 line-clamp-2">
                    {nextArticle.title}
                  </p>
                </Link>
              ) : (
                <div />
              )}
            </nav>
          </article>

          <div className="hidden lg:block">
            <div className="sticky top-28">
              <Sidebar />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
