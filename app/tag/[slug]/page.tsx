import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getArticlesByTag, getTagLabel, getAllTagSlugs } from "@/lib/articles";
import { siteName, absoluteUrl, STATIC_ASSET_VERSION } from "@/lib/site";
import { safeJsonLd } from "@/lib/jsonld";
import { Sidebar } from "@/components/layout/Sidebar";
import { TagArticleList } from "./TagArticleList";
import Link from "next/link";

// ─── Static / dynamic rendering strategy ────────────────────────────────────
//
// WHAT WAS WRONG (two separate issues, mirroring app/category/[slug]/page.tsx):
//
// Issue 1 — vercel.json: CDN-Cache-Control: no-store was applied to /tag/* at
// the Cloudflare layer.  Removed in vercel.json; ISR headers now live in
// next.config.mjs.
//
// Issue 2 — page body: the page previously awaited `searchParams` in the
// Server Component function body.  In Next.js 15, this opts the ENTIRE route
// out of the Full Route Cache on every request.
//
// THE FIX:
//
// This Server Component no longer touches `searchParams` at all.  All
// query-param-dependent rendering (article grid, pagination) is delegated to
// the `TagArticleList` Client Component, which is wrapped in a `<Suspense>`
// boundary to prevent useSearchParams() from re-opting the page into dynamic
// rendering at the route level.

export const revalidate = 3600; // ISR: regenerate at most once per hour

const PAGE_SIZE = 9;

export async function generateStaticParams() {
  return getAllTagSlugs().map((slug) => ({ slug }));
}

interface TagPageProps {
  params: Promise<{ slug: string }>;
  // searchParams intentionally omitted — accessing it here would opt the
  // entire route out of ISR.  All query-param logic lives in TagArticleList.
}

export async function generateMetadata({
  params,
}: Pick<TagPageProps, "params">): Promise<Metadata> {
  const { slug } = await params;
  const label = getTagLabel(slug);
  if (!label) return { title: "Tag Not Found", robots: { index: false, follow: false } };

  const description = `Stories tagged "${label}" on ${siteName}.`;

  return {
    title: `${label} — Tagged Stories`,
    description,
    alternates: {
      canonical: absoluteUrl(`/tag/${slug}`),
    },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${label} — ${siteName}`,
      description,
      url: absoluteUrl(`/tag/${slug}`),
    },
    twitter: {
      card: "summary_large_image",
      title: `${label} — ${siteName}`,
      description,
    },
  };
}

// Suspense fallback: article grid skeleton for the tag article list column.
function ArticleListFallback() {
  return (
    <div className="animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
        {Array.from({ length: PAGE_SIZE }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="aspect-[16/10] bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-3 w-14 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-4 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-3 w-20 bg-paper-secondary dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function TagPage({ params }: TagPageProps) {
  const { slug } = await params;
  const label = getTagLabel(slug);
  if (!label) notFound();

  // All published articles for this tag, fetched once and passed to the
  // Client Component for client-side pagination.
  const allArticles = getArticlesByTag(slug);
  const total = allArticles.length;

  // JSON-LD for the ISR canonical (page-1) snapshot of this tag.
  const firstPageArticles = allArticles.slice(0, PAGE_SIZE);
  const tagUrl = absoluteUrl(`/tag/${slug}`);
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${tagUrl}#collection`,
    name: `${label} — ${siteName}`,
    description: `Stories tagged "${label}" on ${siteName}.`,
    url: tagUrl,
    publisher: {
      "@type": "Organization",
      name: siteName,
      url: absoluteUrl("/"),
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl(`/icon.svg?v=${STATIC_ASSET_VERSION}`),
        width: 512,
        height: 512,
      },
    },
    hasPart: firstPageArticles.map((article) => ({
      "@type": "NewsArticle",
      headline: article.title,
      url: absoluteUrl(`/news/${article.category.slug}/${article.slug}`),
      datePublished: article.publishedAt,
      description: article.excerpt,
    })),
  };

  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(collectionJsonLd) }}
      />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-6" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-accent transition-colors">Home</Link>
        <span>/</span>
        <span className="text-ink-tertiary dark:text-zinc-400">Tag: {label}</span>
      </nav>

      {/* Tag header — server-rendered, always ISR-cached */}
      <header className="mb-8 pb-6 border-b-2 border-ink dark:border-zinc-100">
        <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-2">
          Tag
        </p>
        <h1 className="font-serif text-4xl lg:text-5xl font-black text-ink dark:text-zinc-100 mb-3">
          {label}
        </h1>
        <p className="text-xs text-ink-muted dark:text-zinc-500 font-sans">
          {total} {total === 1 ? "story" : "stories"}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
        {/* Article list column: wrapped in a single container div so the
            CSS Grid sees exactly one item here, regardless of how many
            top-level siblings TagArticleList returns (it returns a
            Fragment with the article grid / pagination as siblings).
            Without this wrapper, <Suspense> renders no DOM element of its
            own, so those Fragment children become direct children of the
            grid and get auto-placed into the grid's columns independently
            — e.g. the article grid landing in the 300px sidebar column
            while the sidebar itself drops to a row underneath. The
            Suspense boundary prevents useSearchParams() inside
            TagArticleList from opting this Server Component out of ISR.
            See: https://nextjs.org/docs/app/api-reference/functions/use-search-params#static-rendering */}
        <div>
          <Suspense fallback={<ArticleListFallback />}>
            <TagArticleList slug={slug} label={label} articles={allArticles} />
          </Suspense>
        </div>

        {/* Sidebar — always server-rendered */}
        <div className="hidden lg:block">
          <div className="sticky top-28">
            <Sidebar />
          </div>
        </div>
      </div>
    </div>
  );
}
