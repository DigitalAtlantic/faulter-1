"use client";

// ─── Why this is a Client Component ─────────────────────────────────────────
//
// Mirrors the same fix applied to CategoryArticleList.  The previous TagPage
// Server Component awaited `searchParams` in its function body, which caused
// Next.js 15 to opt the entire /tag/[slug] route out of the Full Route Cache
// (ISR).  Moving pagination logic here allows the Server Component (page.tsx)
// to read only `params` and be freely ISR-cached.
//
// The parent Server Component wraps this component in a <Suspense> boundary,
// which is mandatory: without it, useSearchParams() in a subtree opts the
// whole page route back into dynamic rendering (Next.js 15 requirement).
//
// LINK HOISTING: <link> elements rendered here are hoisted to <head>
// automatically by React 19.
//
// ─── Finding 7 fix: History-API navigation ───────────────────────────────────
//
// PROBLEM: The previous implementation used <Link href="/tag/[slug]?page=…">
// for pagination controls.  <Link> performs a full Next.js navigation, which
// means Cloudflare sees a new cache key for every page click — fragmenting the
// ISR cache across every page number and eliminating the cache-hit ratio
// benefit of ISR for /tag/* routes.
//
// FIX: All pagination interactions now use router.push() instead of <Link>.
// router.push() performs a client-side navigation:
// - The browser address bar and URL update (bookmarking, back/forward work).
// - useSearchParams() in this component re-reads the new params synchronously.
// - NO new HTTP request is sent to Cloudflare or the origin.
//
// The net effect: Cloudflare's cache key for /tag/[slug] is always the bare
// path.  Every visitor, regardless of their current page number, is served
// from a single cached ISR entry.

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { absoluteUrl } from "@/lib/site";
import type { PublicArticle } from "@/types";

const PAGE_SIZE = 9;
const MAX_PAGE = 1_000;

function parsePage(raw: string | null): number {
  const n = parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > MAX_PAGE) return MAX_PAGE;
  return n;
}

interface TagArticleListProps {
  slug: string;
  label: string;
  articles: PublicArticle[];
}

export function TagArticleList({ slug, label, articles }: TagArticleListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const page = parsePage(searchParams.get("page"));

  // Navigate client-side — no new HTTP request is issued to Cloudflare/origin.
  // The ISR HTML shell stays in the browser; only the URL and rendered slice change.
  const navigate = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      router.push(`/tag/${slug}?${params.toString()}`, { scroll: false });
    },
    [router, slug]
  );

  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = articles.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const isFirstPage = safePage <= 1;

  return (
    <>
      {/* Canonical consolidation for paginated views.
          rel="next" helps non-Google crawlers follow the pagination chain.
          React 19 hoists these <link> elements to <head> automatically. */}
      {!isFirstPage && (
        <link rel="canonical" href={absoluteUrl(`/tag/${slug}`)} />
      )}
      {safePage < totalPages && (
        <link
          rel="next"
          href={absoluteUrl(`/tag/${slug}?page=${safePage + 1}`)}
        />
      )}

      {/* Articles grid */}
      {paginated.length === 0 ? (
        <div className="py-20 text-center">
          <p className="font-serif text-2xl text-ink-secondary dark:text-zinc-400 mb-2">
            No stories tagged &ldquo;{label}&rdquo; yet
          </p>
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
              onClick={() => navigate(safePage - 1)}
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
              onClick={() => navigate(p)}
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
              onClick={() => navigate(safePage + 1)}
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
