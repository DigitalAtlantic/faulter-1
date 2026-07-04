"use client";

/**
 * Search-page Error Boundary (Next.js App Router).
 *
 * Catches errors thrown while rendering `app/search/page.tsx` — for example
 * a throw from Sidebar's getMostReadArticles() call.  The search page is a
 * fully static Server Component (force-dynamic was removed as part of the
 * High-severity /search cache fix); errors here are rare but possible if the
 * in-memory article store is in a bad state on a cold Vercel function start.
 *
 * Note: errors inside <SearchResults> (the "use client" component that fetches
 * /api/search) are caught by its own try/catch inside the useEffect and
 * rendered as an empty results list — they do NOT propagate to this boundary.
 *
 * The surrounding layout remains fully functional; only the search content
 * area is replaced by this recovery UI.  The user retains access to the
 * header search input so they can try a new query immediately.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[SearchError]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-5">
      <div className="max-w-md text-center">
        <div className="w-12 h-1 bg-accent mx-auto mb-6" />

        <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink dark:text-zinc-100 mb-3">
          Search isn't available right now
        </h1>

        <p className="font-sans text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed mb-8">
          Something went wrong while processing your search. Please try again
          or browse the latest stories from the homepage.
        </p>

        {error.digest && (
          <p className="font-mono text-xs text-ink-muted dark:text-zinc-600 mb-8">
            Error ID: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center px-5 py-2.5 bg-accent text-white
                       font-sans text-sm font-semibold hover:bg-accent/90 transition-colors
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-accent"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 border border-border
                       dark:border-border-dark text-ink dark:text-zinc-100 font-sans text-sm
                       font-semibold hover:border-accent hover:text-accent transition-colors"
          >
            Return to homepage
          </Link>
        </div>
      </div>
    </div>
  );
}
