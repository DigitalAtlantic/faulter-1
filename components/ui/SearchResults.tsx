"use client";

/**
 * Finding 8 fix: client-side search results + input pre-fill component.
 *
 * The parent page.tsx is now a fully static Server Component (no force-dynamic,
 * no searchParams access). This component handles everything query-dependent:
 *
 *   1. Reads ?q= from the URL via useSearchParams() (client-side only).
 *   2. Sanitizes the query client-side (length cap + trim). Full server-side
 *      sanitizeText() is not available here (it carries `import "server-only"`).
 *      Client-side sanitization is sufficient because React auto-escapes all JSX
 *      text children and the query never reaches a non-JSX context here.
 *   3. Pre-fills the search input with the current query so navigating directly
 *      to /search?q=foo shows the query in the box (the static shell renders
 *      the input empty; this component updates it after mount).
 *   4. Fetches /api/search?q= to run searchArticles() server-side (it cannot be
 *      called here because lib/articles.ts carries `import "server-only"`).
 *
 * Suspense boundary: the parent wraps this component in <Suspense> as required
 * by Next.js when useSearchParams() is used inside a statically rendered page.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { MAX_QUERY_LENGTH } from "@/lib/search-constants";
import type { PublicArticle } from "@/types";
import { ArticleCard } from "@/components/articles/ArticleCard";
import Link from "next/link";

/** Client-safe query sanitization: length cap + whitespace trim only.
 *  HTML escaping is handled by React's JSX renderer. Full sanitizeText()
 *  (HTML tag stripping) runs server-side in /api/search. */
function sanitizeClientQuery(raw: string | null): string {
  if (!raw) return "";
  return raw.trim().slice(0, MAX_QUERY_LENGTH);
}

export function SearchResults() {
  const searchParams = useSearchParams();
  const query = sanitizeClientQuery(searchParams.get("q"));

  const [results, setResults] = useState<PublicArticle[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Pre-fill the input rendered by the static shell (page.tsx) with the
  // current query. The shell renders the input empty; we update it after mount
  // so users see the right value when navigating directly to /search?q=foo.
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('input[name="q"]');
    if (input && query && input.value !== query) {
      input.value = query;
    }
  }, [query]);

  // Fetch search results from the server-side /api/search route.
  useEffect(() => {
    if (!query) {
      setResults(null);
      return;
    }
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((data: PublicArticle[]) => {
        setResults(data);
        setLoading(false);
      })
      .catch(() => {
        setResults([]);
        setLoading(false);
      });
  }, [query]);

  // Loading state while fetch is in flight
  if (loading) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-ink-muted dark:text-zinc-500 animate-pulse">Searching…</p>
      </div>
    );
  }

  // Empty state — no query entered
  if (!query) {
    return (
      <div className="py-16 text-center border border-dashed border-border dark:border-border-dark">
        <svg
          className="w-12 h-12 mx-auto text-ink-muted dark:text-zinc-600 mb-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <p className="font-serif text-xl text-ink-secondary dark:text-zinc-400 mb-2">
          Search Stories
        </p>
        <p className="text-sm text-ink-muted dark:text-zinc-500 max-w-sm mx-auto">
          Search across all stories, categories, authors, and topics.
        </p>
      </div>
    );
  }

  // Results not yet loaded (shouldn't normally be visible due to loading state above)
  if (results === null) return null;

  return (
    <>
      {/* Results header */}
      <div className="mb-6">
        <p className="font-serif text-2xl font-bold text-ink dark:text-zinc-100">
          {results.length > 0 ? (
            <>
              {results.length} {results.length === 1 ? "result" : "results"} for{" "}
              <span className="text-accent">&ldquo;{query}&rdquo;</span>
            </>
          ) : (
            <>
              No results for{" "}
              <span className="text-accent">&ldquo;{query}&rdquo;</span>
            </>
          )}
        </p>
      </div>

      {/* No results */}
      {results.length === 0 && (
        <div className="py-16 text-center border border-dashed border-border dark:border-border-dark">
          <svg
            className="w-12 h-12 mx-auto text-ink-muted dark:text-zinc-600 mb-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <p className="font-serif text-xl text-ink-secondary dark:text-zinc-400 mb-2">
            No stories found
          </p>
          <p className="text-sm text-ink-muted dark:text-zinc-500 mb-6">
            Try a different search term or browse by category.
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {["World", "Politics", "Technology", "Business", "Health"].map((cat) => (
              <Link
                key={cat}
                href={`/category/${cat.toLowerCase()}`}
                className="text-xs font-sans font-semibold uppercase tracking-widest px-4 py-2
                           border border-border dark:border-border-dark text-ink-secondary dark:text-zinc-400
                           hover:border-accent hover:text-accent transition-colors"
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Results list */}
      {results.length > 0 && (
        <div className="space-y-0">
          {results.map((article) => (
            <div
              key={article.id}
              className="border-b border-border dark:border-border-dark py-6 last:border-b-0"
            >
              <ArticleCard article={article} variant="horizontal" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
