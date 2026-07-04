/**
 * Finding 8 fix: /search is now a static Server Component — force-dynamic removed.
 *
 * CRITICAL CONSTRAINT: To achieve static pre-rendering, this component must
 * NOT access `searchParams` at all — in Next.js App Router, any access to
 * `searchParams` in a page component or its generateMetadata opts the route
 * into dynamic rendering, defeating the fix entirely.
 *
 * Architecture:
 *   • This file renders a static shell: breadcrumb, search bar, sidebar layout.
 *     It is pre-rendered at build time and cached at the CDN edge.
 *   • All query-dependent rendering (results, empty state, "N results for X")
 *     is delegated to <SearchResults> — a "use client" component that reads
 *     ?q= via useSearchParams() in the browser.
 *   • sanitizeText() (which carries `import "server-only"`) cannot run in
 *     a Client Component. SearchResults applies a lightweight client-side
 *     length cap instead; full sanitization is no longer needed here because
 *     React auto-escapes JSX text children and the query never reaches a
 *     non-JSX context in the client rendering path.
 *
 * Cache behaviour:
 *   /search (no query)  → static CDN hit, zero origin load
 *   /search?q=foo       → same static shell from CDN, results rendered
 *                         client-side — still zero origin load for the page
 *
 * Metadata: static ("Search | Faulter") because:
 *   1. Search pages carry robots: noindex — Google never indexes them, so
 *      a dynamic title like "Search: 'foo'" provides no SEO value.
 *   2. Accessing searchParams in generateMetadata also opts the route into
 *      dynamic rendering, which we must avoid.
 *
 * vercel.json: No /search rule exists in vercel.json (the `CDN-Cache-Control:
 * no-store` rule that previously targeted /search has been removed). The
 * CDN-Cache-Control headers set by next.config.mjs for /search are therefore
 * applied without being overridden by Vercel's routing layer.
 */

import type { Metadata } from "next";
import { MAX_QUERY_LENGTH } from "@/lib/search-constants";
import { Sidebar } from "@/components/layout/Sidebar";
import { SearchResults } from "@/components/ui/SearchResults";
import Link from "next/link";
import { siteName } from "@/lib/site";
import { Suspense } from "react";

// Static metadata — search pages are noindex so dynamic titles provide no value,
// and accessing searchParams here would opt the route into dynamic rendering.
export const metadata: Metadata = {
  title: `Search`,
  description: `Search ${siteName} stories`,
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  // No searchParams access here — that would force dynamic rendering.
  // All query handling is in <SearchResults> (client-side via useSearchParams()).
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8">
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-6"
        aria-label="Breadcrumb"
      >
        <Link href="/" className="hover:text-accent transition-colors">
          Home
        </Link>
        <span>/</span>
        <span>Search</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
        <div>
          {/* Search bar — static shell, always visible.
              defaultValue is empty here; SearchResults pre-fills it client-side
              by reading the ?q= param via useSearchParams(). */}
          <div className="mb-8">
            <form
              method="GET"
              action="/search"
              className="flex items-center border-b-2 border-ink dark:border-zinc-100"
            >
              <span className="pl-1 text-ink-tertiary dark:text-zinc-400">
                <svg
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </span>
              <input
                type="text"
                name="q"
                placeholder="Search stories, topics, authors…"
                autoFocus
                maxLength={MAX_QUERY_LENGTH}
                className="flex-1 px-4 py-4 text-xl bg-transparent text-ink dark:text-zinc-100
                           placeholder-ink-muted dark:placeholder-zinc-600 focus:outline-none font-sans"
                aria-label="Search query"
              />
              <button
                type="submit"
                className="px-5 py-4 bg-accent hover:bg-accent-dark text-white text-xs font-bold uppercase tracking-widest transition-colors whitespace-nowrap"
              >
                Search
              </button>
            </form>
          </div>

          {/*
           * SearchResults is a "use client" component that reads ?q= via
           * useSearchParams(), sanitizes the query, and renders results.
           * Suspense is required by Next.js for any component using
           * useSearchParams() inside a statically rendered page.
           */}
          <Suspense fallback={null}>
            <SearchResults />
          </Suspense>
        </div>

        {/* Sidebar */}
        <div className="hidden lg:block">
          <div className="sticky top-28">
            <Sidebar />
          </div>
        </div>
      </div>
    </div>
  );
}
