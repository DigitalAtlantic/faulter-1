"use client";

/**
 * Archive-page Error Boundary (Next.js App Router).
 *
 * Catches errors thrown while rendering `app/archive/page.tsx` — for example
 * a failure sorting or slicing the articles array, or a crash in the date
 * grouping logic.  Without this file the error bubbles to the root layout.
 *
 * The surrounding layout remains fully functional; only the archive listing
 * is replaced by this recovery UI.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function ArchiveError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ArchiveError]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-5">
      <div className="max-w-md text-center">
        <div className="w-12 h-1 bg-accent mx-auto mb-6" />

        <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink dark:text-zinc-100 mb-3">
          Unable to load the archive
        </h1>

        <p className="font-sans text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed mb-8">
          We ran into a problem loading the article archive. Please try again,
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
