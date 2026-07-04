"use client";

// ─── Why this is a Client Component ─────────────────────────────────────────
//
// The previous CategoryPage Server Component awaited `searchParams` in its
// function body, which caused Next.js to opt the ENTIRE route out of the Full
// Route Cache (ISR) on every request — even bare `/category/technology` with
// no query string.  Moving all searchParams-dependent rendering here fixes
// that: the Server Component (page.tsx) now reads only `params` and is freely
// ISR-cached, while this component handles sort and pagination client-side
// using useSearchParams(), costing zero origin round-trips.
//
// SUSPENSE REQUIREMENT: The parent Server Component wraps this component in a
// <Suspense> boundary.  This is mandatory per Next.js 15 docs — without it,
// the presence of useSearchParams() in a subtree opts the whole page route
// back into dynamic rendering.  The Suspense boundary localises the dynamic
// slice to this component only.
//
// LINK HOISTING: The <link rel="canonical"> and <link rel="next"> elements
// rendered here are placed inside a Client Component, but React 19 (which
// Next.js 15 requires) automatically hoists <link> tags to <head> regardless
// of where they appear in the component tree.
//
// ─── Finding 7 fix: History-API navigation ───────────────────────────────────
//
// PROBLEM: The previous implementation used <Link href="/category/[slug]?sort=…&page=…">
// for all sort and pagination controls.  <Link> performs a full Next.js
// navigation, which means Cloudflare sees a cache-key change on every sort or
// page click — fragmenting the ISR cache across the cartesian product of
// sort × page combinations and eliminating the cache-hit ratio benefit of ISR.
//
// FIX: All sort and pagination interactions now use router.push() (Next.js
// router) instead of <Link>.  router.push() performs a client-side navigation:
// - The browser address bar and URL update (bookmarking, back/forward work).
// - useSearchParams() in this component re-reads the new params synchronously.
// - NO new HTTP request is sent to Cloudflare or the origin — the ISR HTML
//   shell is already in the browser and the article data is already in the
//   component's props.
//
// The net effect: Cloudflare's cache key for /category/[slug] is always the
// bare path.  Every visitor, regardless of their current sort mode or page
// number, is served from a single cached ISR entry.

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { absoluteUrl } from "@/lib/site";
import type { PublicArticle } from "@/types";

const PAGE_SIZE = 9;
const MAX_PAGE = 1_000;
const VALID_SORT_MODES = ["latest", "trending"] as const;
type SortMode = (typeof VALID_SORT_MODES)[number];

function parsePage(raw: string | null): number {
  const n = parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > MAX_PAGE) return MAX_PAGE;
  return n;
}

interface CategoryArticleListProps {
  slug: string;
  articles: PublicArticle[];
}

export function CategoryArticleList({ slug, articles }: CategoryArticleListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawSort = searchParams.get("sort");
  const sort: SortMode = VALID_SORT_MODES.includes(rawSort as SortMode)
    ? (rawSort as SortMode)
    : "latest";
  const page = parsePage(searchParams.get("page"));

  // Navigate client-side — no new HTTP request is issued to Cloudflare/origin.
  // The ISR HTML shell stays in the browser; only the URL and rendered slice change.
  const navigate = useCallback(
    (nextSort: SortMode, nextPage: number) => {
      const params = new URLSearchParams();
      params.set("sort", nextSort);
      params.set("page", String(nextPage));
      router.push(`/category/${slug}?${params.toString()}`, { scroll: false });
    },
    [router, slug]
  );

  const sorted =
    sort === "trending"
      ? [...articles].sort((a, b) => (b.isTrending ? 1 : 0) - (a.isTrending ? 1 : 0))
      : [...articles].sort(
          (a, b) =>
            new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const isFirstPage = safePage <= 1;

  return (
    <>
      {/* Canonical consolidation for paginated views (all point back to base slug).
          rel="next" helps non-Google crawlers follow the pagination chain.
          React 19 hoists these <link> elements to <head> automatically. */}
      {!isFirstPage && (
        <link rel="canonical" href={absoluteUrl(`/category/${slug}`)} />
      )}
      {safePage < totalPages && (
        <link
          rel="next"
          href={absoluteUrl(`/category/${slug}?sort=${sort}&page=${safePage + 1}`)}
        />
      )}

      {/* Sort controls — use buttons + router.push() instead of <Link> so
          Cloudflare only ever sees the bare /category/[slug] cache key. */}
      <div className="flex items-center gap-4 mb-6">
        <span className="text-xs font-sans font-semibold uppercase tracking-widest text-ink-muted dark:text-zinc-500">
          Sort by:
        </span>
        <button
          type="button"
          onClick={() => navigate("latest", 1)}
          className={`text-xs font-sans font-semibold uppercase tracking-widest px-3 py-1.5 border transition-colors ${
            sort === "latest"
              ? "border-accent text-accent bg-accent/5"
              : "border-border dark:border-border-dark text-ink-secondary dark:text-zinc-400 hover:border-accent hover:text-accent"
          }`}
        >
          Latest
        </button>
        <button
          type="button"
          onClick={() => navigate("trending", 1)}
          className={`text-xs font-sans font-semibold uppercase tracking-widest px-3 py-1.5 border transition-colors ${
            sort === "trending"
              ? "border-accent text-accent bg-accent/5"
              : "border-border dark:border-border-dark text-ink-secondary dark:text-zinc-400 hover:border-accent hover:text-accent"
          }`}
        >
          Most Read
        </button>
      </div>

      {/* Articles grid */}
      {paginated.length === 0 ? (
        <div className="py-20 text-center">
          <p className="font-serif text-2xl text-ink-secondary dark:text-zinc-400 mb-2">No stories yet</p>
          <p className="text-sm text-ink-muted dark:text-zinc-500">
            Check back soon — our journalists are on it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
          {paginated.map((article, i) => (
            <ArticleCard
              key={article.id}
              article={article}
              variant="grid"
              priority={i < 3 && isFirstPage}
              showExcerpt={i < 3}
              showBookmark
            />
          ))}
        </div>
      )}

      {/* Pagination — buttons + router.push() keep Cloudflare cache key clean */}
      {totalPages > 1 && (
        <nav
          className="mt-12 flex items-center justify-center gap-2"
          aria-label="Pagination"
        >
          {safePage > 1 && (
            <button
              type="button"
              onClick={() => navigate(sort, safePage - 1)}
              className="px-4 py-2 border border-border dark:border-border-dark text-sm font-sans
                         text-ink-secondary dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
            >
              ← Previous
            </button>
          )}

          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => navigate(sort, p)}
              className={`w-10 h-10 flex items-center justify-center text-sm font-sans border transition-colors ${
                p === safePage
                  ? "border-accent bg-accent text-white"
                  : "border-border dark:border-border-dark text-ink-secondary dark:text-zinc-400 hover:border-accent hover:text-accent"
              }`}
              aria-current={p === safePage ? "page" : undefined}
            >
              {p}
            </button>
          ))}

          {safePage < totalPages && (
            <button
              type="button"
              onClick={() => navigate(sort, safePage + 1)}
              className="px-4 py-2 border border-border dark:border-border-dark text-sm font-sans
                         text-ink-secondary dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
            >
              Next →
            </button>
          )}
        </nav>
      )}
    </>
  );
}
