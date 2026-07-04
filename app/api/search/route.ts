/**
 * Finding 8 fix: /api/search — server-side search endpoint for the client-side
 * <SearchResults> component.
 *
 * Why this route exists:
 *   lib/articles.ts carries `import "server-only"`, which prevents it from being
 *   imported in Client Components. <SearchResults> is a Client Component (it uses
 *   useSearchParams()), so it cannot call searchArticles() directly. This route
 *   acts as a thin adapter: it accepts a ?q= query parameter, calls searchArticles()
 *   server-side, and returns the results as JSON.
 *
 * Cache headers:
 *   Search results are user-query-dependent and must not be cached at the CDN
 *   level. `Cache-Control: no-store` prevents Cloudflare and Vercel from caching
 *   responses. Individual result sets may be identical for the same query but
 *   the query space is unbounded and the cost of caching is not worth the
 *   complexity of a cache-key strategy here.
 *
 * Rate limiting:
 *   The middleware-level IP rate limiter applies to this route (middleware
 *   isSearch = pathname === "/api/search"). The cookie-based per-client window
 *   also runs here via enforceSearchRateLimit(). Both checks run before this
 *   handler is reached. No additional rate limiting is added here.
 *
 * Input validation:
 *   • Query param is trimmed and truncated to MAX_QUERY_LENGTH before reaching
 *     searchArticles() — matching the sanitization previously done in page.tsx.
 *   • sanitizeText() (from lib/sanitize.ts) is applied to strip HTML tags and
 *     decode entities, matching the M-4 fix previously in page.tsx.
 *   • Empty or missing ?q= returns an empty array (not an error).
 */

import { NextRequest, NextResponse } from "next/server";
import { searchArticles } from "@/lib/articles";
import { MAX_QUERY_LENGTH } from "@/lib/search-constants";
import { sanitizeText } from "@/lib/sanitize";

export const runtime = "nodejs"; // articles.ts uses server-only; Node runtime required

export function GET(request: NextRequest): NextResponse {
  const raw = request.nextUrl.searchParams.get("q") ?? "";
  // Sanitize: trim, cap length, strip HTML tags (mirrors the M-4 fix from page.tsx)
  const query = raw ? sanitizeText(raw.trim().slice(0, MAX_QUERY_LENGTH)) : "";

  if (!query) {
    return NextResponse.json([], {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const results = searchArticles(query);
  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
