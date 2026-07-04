"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Article-level Error Boundary (Next.js App Router).
 *
 * This file is co-located with the article page so that errors thrown during
 * rendering are caught here rather than propagating to the root layout, which
 * would crash the entire site. The user sees a helpful recovery UI instead of
 * a white screen, and the rest of the site remains functional.
 *
 * `reset` re-renders the route segment in place — useful for transient
 * fetch/data errors without losing the surrounding layout.
 */
export default function ArticleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to your error tracking service (Sentry, Datadog, etc.)
    console.error("[ArticleError]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-5">
      <div className="max-w-md text-center">
        {/* Editorial-style separator */}
        <div className="w-12 h-1 bg-accent mx-auto mb-6" />

        <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink dark:text-zinc-100 mb-3">
          Something went wrong
        </h1>

        <p className="font-sans text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed mb-8">
          We encountered an unexpected error while loading this article. Our
          team has been notified. Please try again, or return to the homepage.
        </p>

        {/* Digest helps correlate client errors with server logs */}
        {error.digest && (
          <p className="font-mono text-xs text-ink-muted dark:text-zinc-600 mb-8">
            Error ID: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center px-5 py-2.5 bg-accent text-white
                       font-sans text-sm font-semibold hover:bg-accent/90 transition-colors focus-visible:outline
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 border border-border
                       dark:border-border-dark text-ink dark:text-zinc-100 font-sans text-sm font-semibold
                       hover:border-accent hover:text-accent transition-colors"
          >
            Return to homepage
          </Link>
        </div>
      </div>
    </div>
  );
}
