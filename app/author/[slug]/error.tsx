"use client";

/**
 * Author-page Error Boundary (Next.js App Router).
 *
 * Catches errors thrown while rendering `app/author/[slug]/page.tsx` —
 * for example a failure fetching author metadata or a crash rendering the
 * article list.  Without this file the error bubbles to the root layout.
 *
 * The surrounding layout remains fully functional; only the author profile
 * area is replaced by this recovery UI.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function AuthorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AuthorError]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-5">
      <div className="max-w-md text-center">
        <div className="w-12 h-1 bg-accent mx-auto mb-6" />

        <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink dark:text-zinc-100 mb-3">
          Unable to load this author page
        </h1>

        <p className="font-sans text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed mb-8">
          We couldn't load the author profile or their articles right now.
          Please try again, or return to the homepage to keep reading.
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
