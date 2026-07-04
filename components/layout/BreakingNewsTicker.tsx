"use client";

/**
 * BreakingNewsTicker — Client Component
 *
 * Finding 4 fix (Option A): converted from a Server Component to a Client
 * Component that fetches /api/breaking on mount.
 *
 * Previously this was a Server Component rendered directly in app/layout.tsx.
 * getBreakingArticles() was called at ISR render time, which baked the ticker
 * content into every route's HTML snapshot. This caused two problems:
 *
 *   1. Staleness window: a newly-published or retracted breaking story would
 *      not appear (or disappear) from a route's ticker until that route was
 *      next re-rendered — which could be up to the full max-age (1 hour) away,
 *      even after the CMS webhook fired and revalidatePath() cleared the origin
 *      cache.
 *
 *   2. Cross-route inconsistency: different routes cached at different times
 *      showed different ticker content. A breaking story could appear on the
 *      homepage but not on a category page until ISR regenerated both routes.
 *
 * With the Option A fix:
 *   • The HTML snapshot produced by the root layout contains only the ticker
 *     shell (the "Breaking" label + a placeholder). Actual article titles load
 *     fresh from /api/breaking on every page visit, after hydration.
 *   • /api/breaking has a short s-maxage=60 edge TTL and is explicitly purged
 *     by POST /api/revalidate on every article update.
 *   • ISR route HTML no longer encodes ticker content — nothing to become
 *     inconsistent across cached routes.
 *
 * sanitizeText: lib/sanitize.ts has `import "server-only"` so it cannot be
 * imported in a Client Component. A lightweight inline implementation is used
 * here instead. The client-side sanitization is intentionally minimal because:
 *   a) Data comes from our own /api/breaking endpoint (not user input).
 *   b) React's JSX renderer already HTML-escapes the string before rendering it
 *      into the DOM — there is no dangerouslySetInnerHTML anywhere in this tree.
 * The strip-tags regex is therefore defensive belt-and-suspenders only.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

/** Minimal shape returned by GET /api/breaking. */
interface BreakingItem {
  title:    string;
  slug:     string;
  category: { slug: string };
}

/** Expected response envelope from GET /api/breaking. */
interface BreakingResponse {
  articles: BreakingItem[];
}

/**
 * Strip HTML tags and decode common HTML entities from a plain-text string.
 *
 * Replaces lib/sanitize.ts#sanitizeText() for client-side use.
 * lib/sanitize.ts uses `sanitize-html` (Node.js) and is marked `server-only`;
 * this minimal version uses a regex tag-strip + entity decode that is safe in
 * browser contexts for our use case (React JSX escaping prevents XSS regardless).
 */
function stripHtmlTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")                     // strip all HTML tags
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, "\u00a0");
}

export function BreakingNewsTicker() {
  const [articles, setArticles] = useState<BreakingItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/breaking")
      .then((res) => {
        if (!res.ok) throw new Error(`/api/breaking returned ${res.status}`);
        return res.json() as Promise<BreakingResponse>;
      })
      .then((data) => {
        if (!cancelled) setArticles(data.articles ?? []);
      })
      .catch((err) => {
        // Ticker is non-critical; silently suppress fetch errors so a
        // /api/breaking outage doesn't surface anything to the user.
        if (!cancelled) {
          console.warn("[BreakingNewsTicker] fetch failed:", err);
          setArticles([]); // render nothing rather than staying in skeleton state
        }
      });

    return () => { cancelled = true; };
  }, []);

  // Skeleton: same height as the ticker bar; reserves vertical space so the
  // Header below doesn't jump when the ticker text loads.
  if (articles === null) {
    return (
      <div
        className="bg-accent h-8"
        aria-hidden="true"
        aria-label="Loading breaking news"
      />
    );
  }

  if (articles.length === 0) return null;

  const tickerText = articles.map((a) => `● ${stripHtmlTags(a.title)}`).join("    ");
  const lead = articles[0];

  return (
    <div className="bg-accent text-white text-xs font-sans font-medium overflow-hidden h-8 flex items-center">
      <div className="flex-shrink-0 bg-accent-dark px-4 h-full flex items-center uppercase tracking-widest text-[10px] font-bold whitespace-nowrap">
        Breaking
      </div>
      <div className="overflow-hidden flex-1 relative">
        <Link
          href={`/news/${lead.category.slug}/${lead.slug}`}
          className="ticker-content hover:underline px-6 inline-block"
        >
          {tickerText}
        </Link>
      </div>
    </div>
  );
}
