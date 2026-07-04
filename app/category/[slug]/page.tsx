import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCategoryBySlug, categories } from "@/lib/categories";
import { getArticlesByCategory } from "@/lib/articles";
import { siteName, absoluteUrl, STATIC_ASSET_VERSION } from "@/lib/site";
import { safeJsonLd } from "@/lib/jsonld";
import { Sidebar } from "@/components/layout/Sidebar";
import { CategoryArticleList } from "./CategoryArticleList";
import Link from "next/link";

// ─── Static / dynamic rendering strategy ────────────────────────────────────
//
// WHAT WAS WRONG (two separate issues):
//
// Issue 1 — vercel.json: CDN-Cache-Control: no-store was applied to /category/*
// at the Cloudflare layer, completely defeating ISR regardless of what
// Next.js emitted.  Removed in vercel.json; ISR headers are now set in
// next.config.mjs (matching the /author/:slug pattern already in place).
//
// Issue 2 — page body: the page previously awaited `searchParams` in the
// Server Component function body.  In Next.js 15, accessing `searchParams`
// inside a Server Component opts the ENTIRE route out of the Full Route Cache
// on every request — including bare `/category/technology` with no query
// string.  The ISR revalidate timer exists but never populates a cached entry
// because the page is always treated as fully dynamic.
//
// THE FIX:
//
// This Server Component no longer touches `searchParams` at all.  It reads
// only `params` (the slug), fetches the articles, and delegates all
// query-param-dependent rendering (sort controls, article grid, pagination) to
// the `CategoryArticleList` Client Component.
//
// The Client Component is wrapped in a `<Suspense>` boundary.  This is a
// mandatory Next.js 15 requirement: without it, the presence of
// useSearchParams() in a subtree opts the whole page route back into dynamic
// rendering.  The Suspense boundary localises the dynamic slice to the article
// list only, keeping the Server Component (header, metadata, JSON-LD) fully
// ISR-eligible.
//
// ISR SNAPSHOT: The pre-rendered HTML always represents the page-1 / latest
// default view.  Visitors with URL params (sort, page) see a brief Suspense
// fallback skeleton while the Client Component hydrates; the correct content
// is then rendered client-side without an origin round-trip.  This is the
// standard Next.js 15 tradeoff for ISR + client-side filtering.
//
// INVARIANT — see middleware.ts `H-6 INVARIANT` comment:
// No server component in this subtree reads a cookie to alter the HTML it
// renders.  If you add session-aware or personalised rendering under
// app/category/**, this remains true regardless of caching, but is doubly
// important because the static shell IS shared across users.
// The ESLint rule in .eslintrc.json (app/category/**) will fire if you call
// `cookies()` or access `request.cookies` here — that is the signal.

export const revalidate = 3600; // ISR: regenerate at most once per hour

const PAGE_SIZE = 9;

// Pre-generate a static shell for every known category slug at build time.
// `dynamicParams` stays at its default of `true` so unknown slugs (e.g. a
// category added after the last build) are still handled dynamically rather
// than 404'd.
export async function generateStaticParams() {
  return categories.map((c) => ({ slug: c.slug }));
}

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  // searchParams intentionally omitted — accessing it here would opt the
  // entire route out of ISR.  All query-param logic lives in CategoryArticleList.
}

export async function generateMetadata({
  params,
}: Pick<CategoryPageProps, "params">): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);
  if (!category) return { title: "Category Not Found", robots: { index: false, follow: false } };

  return {
    title: `${category.name} News`,
    description: category.description,
    alternates: {
      canonical: absoluteUrl(`/category/${category.slug}`),
    },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${category.name} — ${siteName}`,
      description: category.description,
      url: absoluteUrl(`/category/${category.slug}`),
    },
    twitter: {
      card: "summary_large_image",
      title: `${category.name} — ${siteName}`,
      description: category.description,
    },
  };
}

// Suspense fallback: article grid skeleton scoped to just the article list
// column.  Keeps the category header and sidebar visible from the ISR cache
// while the Client Component hydrates.
function ArticleListFallback() {
  return (
    <div className="animate-pulse">
      {/* Sort controls placeholder */}
      <div className="flex items-center gap-4 mb-6">
        <div className="h-3 w-12 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-7 w-16 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-7 w-20 bg-paper-secondary dark:bg-zinc-800" />
      </div>
      {/* Article grid placeholder */}
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

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);
  if (!category) notFound();

  // All articles are fetched here and passed to the Client Component so it can
  // sort and paginate client-side.  The Server Component itself never reads
  // searchParams — see the strategy comment above.
  const allArticles = getArticlesByCategory(slug).filter(
    (a) => a.status === "published"
  );
  const total = allArticles.length;

  // JSON-LD for the ISR canonical (page-1, latest) snapshot of this category.
  // The Server Component always represents page 1, so this JSON-LD is always
  // included.  Paginated views (?page=2, etc.) are noindex, so structured data
  // there has no indexing effect regardless.
  const firstPageArticles = [...allArticles]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, PAGE_SIZE);

  const categoryUrl = absoluteUrl(`/category/${category.slug}`);
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${categoryUrl}#collection`,
    name: `${category.name} — ${siteName}`,
    description: category.description,
    url: categoryUrl,
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
        <span className="text-ink-tertiary dark:text-zinc-400">{category.name}</span>
      </nav>

      {/* Category header — server-rendered, always ISR-cached */}
      <header className="mb-8 pb-6 border-b-2 border-ink dark:border-zinc-100">
        <h1 className="font-serif text-4xl lg:text-5xl font-black text-ink dark:text-zinc-100 mb-3">
          {category.name}
        </h1>
        <p className="text-ink-secondary dark:text-zinc-400 font-sans text-base max-w-2xl">
          {category.description}
        </p>
        <p className="text-xs text-ink-muted dark:text-zinc-500 font-sans mt-2">
          {total} {total === 1 ? "story" : "stories"}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
        {/* Article list column: wrapped in a single container div so the
            CSS Grid sees exactly one item here, regardless of how many
            top-level siblings CategoryArticleList returns (it returns a
            Fragment with sort controls / grid / pagination as siblings).
            Without this wrapper, <Suspense> renders no DOM element of its
            own, so those Fragment children become direct children of the
            grid and get auto-placed into the grid's columns independently
            — e.g. the article grid landing in the 300px sidebar column
            while the sidebar itself drops to a row underneath. The
            Suspense boundary prevents useSearchParams() inside
            CategoryArticleList from opting this Server Component out of ISR.
            See: https://nextjs.org/docs/app/api-reference/functions/use-search-params#static-rendering */}
        <div>
          <Suspense fallback={<ArticleListFallback />}>
            <CategoryArticleList slug={slug} articles={allArticles} />
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
