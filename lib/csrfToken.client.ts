/**
 * Shared CSRF token cache for client components.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Multiple components (NewsletterSignup × 2, FooterNewsletter, contact page,
 * subscribe page) each used to fire their own `fetch("/api/csrf")` on mount.
 * In production that is fine — real users don't have React StrictMode and
 * don't navigate dozens of times per minute.  In development, React 18's
 * StrictMode intentionally unmounts and remounts every component to surface
 * missing cleanup, which doubles every mount-time effect.  On a page like
 * the home page (two NewsletterSignup instances + one FooterNewsletter) that
 * produces 6 rapid-fire requests per page load.  A few quick navigations
 * during testing accumulates enough requests to trip the 20 req/min rate
 * limit on /api/csrf, returning 429 and breaking form CSRF protection for
 * the rest of that minute.
 *
 * THE FIX
 * ───────
 * Module-level (singleton) state.  Because Next.js bundles each "use client"
 * module once per browser session, variables declared at module scope are
 * shared across all component instances for the lifetime of the tab.
 *
 *   • In-flight deduplication  — if one component fires the fetch while
 *     another is already waiting, both components receive the same Promise.
 *     Only one HTTP request is ever in flight at a time.
 *
 *   • Resolved-token cache     — once the token arrives it is stored.
 *     Subsequent calls resolve immediately from the cache with no network
 *     request, provided the token is not stale.
 *
 *   • Expiry                   — the server sets the csrf_token cookie with
 *     maxAge = 1800 s (30 min, see lib/csrf.ts).  We expire the client cache
 *     at TOKEN_TTL_MS (25 min) so we always refetch before the cookie dies,
 *     guaranteeing the header and cookie stay in sync.
 *
 * SECURITY PROPERTIES (unchanged from before)
 * ────────────────────────────────────────────
 * The token itself, the cookie, and the server-side validation logic are
 * completely untouched.  This module only controls *when* the client asks for
 * a new token — not how the token is validated.  A cross-origin attacker
 * still cannot read our cookies and therefore cannot reconstruct the
 * header + cookie pair required by the double-submit check.
 *
 * This file must NOT be imported from Server Components or middleware.
 * The module-level variables only exist in the browser bundle; Next.js
 * never executes them during SSR.
 */

/** Expire the cache 5 minutes before the server cookie expires (30 min). */
const TOKEN_TTL_MS = 25 * 60 * 1000;

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

/**
 * The resolved CSRF token, or null if we have not fetched one yet (or if the
 * cached token has expired).
 */
let cachedToken: string | null = null;

/**
 * The timestamp (Date.now()) at which `cachedToken` was stored.
 * Used to decide when to refetch.
 */
let cachedAt: number = 0;

/**
 * The in-flight fetch Promise, present from the moment the first component
 * calls `fetchCsrfToken()` until the fetch resolves or rejects.
 * All callers that arrive while this is non-null receive the same Promise,
 * ensuring only one HTTP request is ever in flight.
 */
let pendingPromise: Promise<string> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a Promise that resolves to the current CSRF token.
 *
 * - If a valid cached token exists, resolves immediately (no network).
 * - If a fetch is already in-flight, returns that same Promise (dedup).
 * - Otherwise, fires a new fetch against /api/csrf.
 *
 * Never rejects — on network error it resolves to `""` (empty string).
 * Components treat an empty token as "unavailable" and omit the header;
 * Origin/Referer validation is still the primary CSRF guard and covers the
 * vast majority of browsers.
 */
export function fetchCsrfToken(): Promise<string> {
  // 1. Valid cached token — return immediately without any network activity.
  if (cachedToken !== null && Date.now() - cachedAt < TOKEN_TTL_MS) {
    return Promise.resolve(cachedToken);
  }

  // 2. Fetch already in-flight — return the shared Promise so this caller
  //    waits for the same request rather than firing a duplicate.
  if (pendingPromise !== null) {
    return pendingPromise;
  }

  // 3. No token and no in-flight request — start a new fetch.
  pendingPromise = fetch("/api/csrf")
    .then((r) => r.json())
    .then((data: { token?: string }) => {
      const token = data.token ?? "";
      // Store in cache only if we got a real token back.
      if (token) {
        cachedToken = token;
        cachedAt = Date.now();
      }
      pendingPromise = null;
      return token;
    })
    .catch(() => {
      // Non-fatal: clear in-flight state so a later attempt can retry.
      // Resolve to "" — the component treats this as "token unavailable"
      // and omits the header.  Origin/Referer is still the primary guard.
      pendingPromise = null;
      return "";
    });

  return pendingPromise;
}

/**
 * Discard the cached token immediately.
 *
 * Call this after any server response that indicates the token is no longer
 * valid (e.g. a 403 on a form submission), so the next fetchCsrfToken() call
 * goes back to the server for a fresh one.
 */
export function invalidateCsrfToken(): void {
  cachedToken = null;
  cachedAt = 0;
  // Do not clear pendingPromise — if a fetch is in-flight, let it complete
  // and then the caller can decide whether to call fetchCsrfToken() again.
}
