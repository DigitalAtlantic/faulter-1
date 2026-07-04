"use client";

/**
 * Tag-page Error Boundary (Next.js App Router).
 *
 * Catches errors thrown while rendering any `app/tag/[slug]/page.tsx` —
 * for example a failure in getArticlesByTag or a crash in ArticleCard.
 * Without this file the error would bubble to the root layout and take down
 * the entire site for that request. Mirrors app/category/[slug]/error.tsx.
 *
 * The surrounding layout (header, footer, nav) remains fully functional;
 * only the tag listing area is replaced by this recovery UI.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function TagError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[TagError]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-5">
      <div className="max-w-md text-center">
        <div className="w-12 h-1 bg-accent mx-auto mb-6" />

        <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink dark:text-zinc-100 mb-3">
          Unable to load this tag
        </h1>

        <p className="font-sans text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed mb-8">
          We couldn't fetch the articles for this tag right now. Please try
          again, or browse a category from the homepage.
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
