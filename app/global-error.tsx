"use client";

/**
 * Global Error Boundary (Next.js App Router).
 *
 * This file is the last line of defence in the component tree.  It catches
 * errors thrown inside `app/layout.tsx` itself — for example a crash in
 * ThemeProvider, Header, Footer, or the font / metadata setup — which cannot
 * be caught by any nested error.tsx because those all live *inside* the root
 * layout.
 *
 * Because it completely replaces the root layout when it renders, it must
 * supply its own <html> and <body> tags.  Tailwind classes still work because
 * Next.js bundles globals.css into a static chunk (/_next/static/…) that is
 * fetched by the browser independently of the layout render.
 *
 * The font CSS variables (--font-playfair, --font-source-sans) are injected
 * by localFont inside layout.tsx, which is not running at this point, so
 * we intentionally fall back to the system-font stack.  That is correct
 * behaviour — the fallbacks are declared in tailwind.config.ts.
 *
 * No inline style= attributes are used here so the production
 * `style-src 'self'` CSP is respected (see middleware.ts, H-2 fix).
 */

import { useEffect } from "react";
import Link from "next/link";
import { FooterYear } from "@/components/layout/FooterYear";
import { STATIC_ASSET_VERSION } from "@/lib/site";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // H-1 fix: log only the digest, never the full Error object.
    //
    // global-error.tsx is a "use client" component — this useEffect runs in
    // the browser.  Passing `error` directly to console.error prints the full
    // Error object (message + stack trace) in the DevTools console, surfacing
    // file paths, component names, and Next.js internal details to anyone with
    // DevTools open.  The digest is a short, opaque hash that is already shown
    // to the user on screen; it is safe to log and lets you correlate browser
    // reports with server-side log entries without leaking implementation detail.
    //

    // L-6 fix: always log the digest locally so it appears in platform log drains
    // (Vercel, Railway, Fly.io) even before an external tracker is configured.
    console.error("[GlobalError]", error?.digest ?? "no-digest");

    // L-6 fix: forward a minimal, non-sensitive payload to the server so errors
    // are visible in production regardless of whether Sentry is configured.
    //
    // Only digest + message are sent — never stack, never component tree.
    // The endpoint can forward to any observability platform server-side.
    //
    // Option A — Sentry (recommended, zero additional API route needed):
    //   1. npm install @sentry/nextjs
    //   2. Add NEXT_PUBLIC_SENTRY_DSN to your environment
    //   3. Uncomment the two lines below and remove the fetch block
    //
    // import * as Sentry from "@sentry/nextjs";
    // Sentry.captureException(error);
    //
    // Option B (active) — custom /api/error-report route (no extra package):
    fetch("/api/error-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digest: error?.digest ?? null,
        // message is safe to forward server-side; it never reaches the console
        message: error?.message ?? null,
        // do NOT include error.stack — too large and too sensitive
      }),
    }).catch(() => {
      // Non-fatal: the user already sees the error UI.
      // A failed report must never cause a secondary crash.
    });
  }, [error]);

  return (
    <html lang="en">
      <head>
        {/*
         * Minimal favicon — avoids a broken-image icon in the tab even when
         * the layout is fully offline.
         */}
        <link rel="icon" href={`/icon.svg?v=${STATIC_ASSET_VERSION}`} type="image/svg+xml" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something went wrong — Faulter</title>
      </head>
      <body className="bg-paper dark:bg-zinc-950 text-ink dark:text-zinc-100 min-h-screen flex flex-col items-center justify-center px-5">
        <div className="max-w-md w-full text-center">

          {/* Editorial accent bar */}
          <div className="w-12 h-1 bg-accent mx-auto mb-8" />

          <h1 className="text-3xl font-bold text-ink dark:text-zinc-100 mb-4">
            Something went wrong
          </h1>

          <p className="text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed mb-4">
            An unexpected error occurred while loading the page. This is likely
            a temporary issue — please try again.
          </p>

          {/*
           * The digest is a deterministic hash Next.js derives from the error
           * on the server.  It lets you correlate what you see in the browser
           * with the corresponding server-side log entry without leaking the
           * full stack trace to the client.
           */}
          {error.digest && (
            <p className="font-mono text-xs text-ink-muted dark:text-zinc-600 mb-8">
              Error ID: {error.digest}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
            <button
              onClick={reset}
              className="inline-flex items-center justify-center px-5 py-2.5
                         bg-accent text-white text-sm font-semibold
                         hover:bg-accent/90 transition-colors
                         focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-5 py-2.5
                         border border-border dark:border-border-dark
                         text-ink dark:text-zinc-100 text-sm font-semibold
                         hover:border-accent hover:text-accent transition-colors"
            >
              Return to homepage
            </Link>
          </div>
        </div>

        {/* Minimal footer — keeps brand present without needing the layout */}
        <footer className="mt-16 text-xs text-ink-muted dark:text-zinc-600">
          {/*
           * FINDING 2 fix: use the same FooterYear component as Footer.tsx
           * instead of calling new Date().getFullYear() directly during SSR.
           * global-error.tsx is "use client" but Next.js still server-renders
           * it, so a raw server clock call here has the same New Year's
           * staleness risk that FooterYear already solves for Footer.tsx.
           */}
          &copy; <FooterYear /> Faulter
        </footer>
      </body>
    </html>
  );
}
