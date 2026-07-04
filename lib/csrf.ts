// Prevent this module from being imported in Client Components.
// lib/csrf.ts handles CSRF token generation and validation — server-only
// logic that reads cookies and sets response headers.
import "server-only";

import type { NextRequest } from "next/server";
import { siteUrl } from "@/lib/site";

/**
 * CSRF protection: Origin/Referer validation + double-submit cookie fallback.
 *
 * Why two layers?
 * ───────────────
 * Origin/Referer validation is the primary defence.  It rejects cross-origin
 * form submissions from malicious pages because browsers enforce the same-
 * origin policy on those headers.
 *
 * However, corporate proxies, Brave Shields (aggressive mode), certain VPNs,
 * and ISP-level caches strip both headers.  Legitimate users behind those
 * tools would silently receive a 403 with no helpful error message.
 *
 * The double-submit cookie pattern handles that case:
 *   1. The server sets a short-lived `csrf_token` cookie (HttpOnly: false so
 *      JS can read it).
 *   2. The client reads the cookie value, includes it as a request header
 *      (`X-CSRF-Token`).
 *   3. The server verifies that the header value matches the cookie value.
 *
 * An attacker on evil.com cannot read a cookie scoped to our domain (same-
 * origin policy prevents it), so they cannot set the matching header even if
 * they can forge a form submission.  The double-submit pattern is therefore
 * safe without a server-side session.
 *
 * Validation order:
 *   • If Origin or Referer is present → validate it (fast path).
 *   • If both are absent → fall back to double-submit cookie check.
 *   • If neither passes → reject (403).
 *
 * ── H-5: XSS → CSRF escalation path — READ BEFORE CHANGING THIS FILE ────────
 *
 * `httpOnly: false` on `csrf_token` is NOT a mistake — the double-submit
 * pattern structurally requires JS to read the cookie.  The security property
 * we rely on is that a cross-origin attacker cannot read our cookies due to
 * the browser same-origin policy.  `sameSite: "strict"` blocks cross-site
 * request forgery even without the double-submit check, but we keep the
 * double-submit layer for the proxy-stripping case described above.
 *
 * The known weakness of this design: any XSS vulnerability on our own origin
 * can read the cookie (same-origin JS is not blocked by SameSite) and forge
 * a valid X-CSRF-Token header, bypassing CSRF protection entirely.  This is
 * an accepted trade-off for the double-submit pattern — it is documented in
 * OWASP's CSRF prevention cheatsheet as a known limitation.
 *
 * DEPENDENCY: this design is only safe while same-origin XSS is prevented.
 * The current XSS defence is the sanitize-html allowlist in lib/sanitize.ts
 * (sanitizeArticleContent + sanitizeText).  If you add any of the following,
 * re-evaluate this CSRF strategy before shipping:
 *
 *   • A Markdown renderer that outputs raw HTML (e.g. marked, remark-html,
 *     showdown) — these produce unsanitized output unless you pipe it through
 *     the sanitizer.
 *   • `dangerouslySetInnerHTML` with CMS-sourced content outside the sanitizer
 *     pipeline.
 *   • A rich-text editor (Tiptap, Quill, Slate) that stores HTML in the DB
 *     and re-renders it without sanitization on load.
 *   • A third-party embed or widget script loaded from an external domain —
 *     if the external domain is compromised, the script runs on our origin.
 *
 * If any of the above is added and introduces a realistic XSS path, switch
 * to the `Synchronizer Token Pattern` (server-side session + hidden form
 * field) or adopt a framework-level CSRF library that uses HttpOnly cookies
 * with a separate signed token in the response body — neither of which
 * requires JS to read a cookie.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/** Byte length of the CSRF token.  128 bits = 16 bytes = 22 base64url chars. */
const TOKEN_BYTES = 16;

/** Cookie name for the CSRF token.  Must match what the client reads. */
export const CSRF_COOKIE_NAME = "csrf_token";

/** Header name the client must send the token in. */
export const CSRF_HEADER_NAME = "x-csrf-token";

/** TTL for the CSRF cookie in seconds (30 minutes). */
export const CSRF_COOKIE_MAX_AGE = 1800;

/**
 * Generate a cryptographically random CSRF token as a base64url string.
 *
 * Uses `crypto.getRandomValues` (Web Crypto, available in both Edge Runtime
 * and Node.js ≥ 19) rather than `crypto.randomBytes` (Node-only) so this
 * function works in middleware and route handlers alike.
 */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // base64url encode: standard base64 with + → -, / → _, = stripped
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/**
 * Minimal cookie-reader shape both `NextRequest.cookies` (route handlers) and
 * the awaited return value of `cookies()` from `next/headers` (Server
 * Actions / Server Components) satisfy. Narrowing to this shape — instead of
 * requiring a full `NextRequest` — is what lets `isValidCsrfOrigin` and
 * `isValidCsrfOriginFromParts` share one implementation.
 */
interface CookieReader {
  get(name: string): { value: string } | undefined;
}

// ---------------------------------------------------------------------------
// Origin / Referer validation (primary check)
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the Origin or Referer header matches our allowed origin.
 */
function isValidOriginOrReferer(headers: Headers): boolean {
  const allowed = siteUrl.replace(/\/$/, "").toLowerCase();

  const origin = headers.get("origin");
  if (origin) {
    return origin.toLowerCase() === allowed;
  }

  const referer = headers.get("referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      return refUrl.origin.toLowerCase() === allowed;
    } catch {
      return false;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Double-submit cookie validation (fallback)
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the `X-CSRF-Token` request header matches the
 * `csrf_token` cookie value.
 *
 * Both must be present and non-empty.  The comparison is done with a
 * constant-time algorithm to prevent timing oracle attacks.
 *
 * ── MED-2 verification: fails closed when both header and cookie are absent ──
 * The scenario: Origin/Referer stripped by a proxy AND csrf_token cookie was
 * never set (user never fetched GET /api/csrf in this session).
 *
 * Trace:
 *   headerToken = headers.get("x-csrf-token") → null (no header sent)
 *   cookieToken = cookies.get("csrf_token")?.value → undefined (cookie absent)
 *   !headerToken → true → return false immediately   ← fails closed ✓
 *
 * The early-return on the first absent value means the cookie absence is
 * irrelevant: the function rejects before it even reads the cookie when the
 * header is absent.  Symmetrically, if the header is present but the cookie
 * is absent, !cookieToken is true and the same early return fires.
 *
 * isValidCsrfOriginCore therefore returns false in the MED-2 scenario:
 *   isValidOriginOrReferer → false (both headers absent)
 *   isValidDoubleSubmit    → false (header and/or cookie absent)
 *   → return false         ← caller (getBookmarkedArticles) returns []
 *
 * This is the correct fail-closed behaviour: an unauthenticated, cookie-less
 * request is rejected, not granted access.
 */
function isValidDoubleSubmit(headers: Headers, cookies: CookieReader): boolean {
  const headerToken = headers.get(CSRF_HEADER_NAME);
  const cookieToken = cookies.get(CSRF_COOKIE_NAME)?.value;

  if (!headerToken || !cookieToken) return false;
  if (headerToken.length !== cookieToken.length) return false;

  // Constant-time comparison — avoids early-exit timing oracle.
  let mismatch = 0;
  for (let i = 0; i < headerToken.length; i++) {
    mismatch |= headerToken.charCodeAt(i) ^ cookieToken.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` if `headers`/`cookies` pass CSRF validation.
 *
 * Validates via Origin/Referer first (fast path).  If both headers are absent
 * (stripped by a proxy or privacy tool), falls back to the double-submit
 * cookie check.
 *
 * This is the shared implementation behind both `isValidCsrfOrigin` (route
 * handlers, which hand us a `NextRequest`) and `isValidCsrfOriginFromParts`
 * (Server Actions, which only have `headers()`/`cookies()` from
 * `next/headers` — there is no `NextRequest` to read in that context).
 */
function isValidCsrfOriginCore(headers: Headers, cookies: CookieReader): boolean {
  // Primary: Origin / Referer check.
  if (isValidOriginOrReferer(headers)) return true;

  // M-2 fallback: double-submit cookie — handles users whose proxies strip
  // Origin and Referer.  See module-level comment for security rationale.
  if (isValidDoubleSubmit(headers, cookies)) return true;

  return false;
}

/**
 * Returns `true` if the request passes CSRF validation.
 *
 * Use this in API route handlers, where a `NextRequest` is available
 * directly (e.g. `export async function POST(request: NextRequest)`).
 */
export function isValidCsrfOrigin(request: NextRequest): boolean {
  return isValidCsrfOriginCore(request.headers, request.cookies);
}

/**
 * Returns `true` if the request passes CSRF validation.
 *
 * ── M-3 fix ──────────────────────────────────────────────────────────────
 * Use this in Server Actions (`"use server"` functions), which never receive
 * a `NextRequest` — only the `headers()` / `cookies()` helpers from
 * `next/headers`. Without this entry point, Server Actions had no way to
 * call into the same CSRF check that every route handler uses, which is how
 * `getBookmarkedArticles` in app/bookmarks/actions.ts ended up with no CSRF
 * check at all.
 *
 * Pass the *awaited* return values of `headers()` and `cookies()`:
 *
 *   import { headers, cookies } from "next/headers";
 *   import { isValidCsrfOriginFromParts } from "@/lib/csrf";
 *
 *   if (!isValidCsrfOriginFromParts(await headers(), await cookies())) {
 *     return ...;
 *   }
 */
export function isValidCsrfOriginFromParts(
  headers: Headers,
  cookies: CookieReader
): boolean {
  return isValidCsrfOriginCore(headers, cookies);
}
