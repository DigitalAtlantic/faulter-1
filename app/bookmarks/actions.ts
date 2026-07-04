"use server";

import { cookies, headers } from "next/headers";
import { getPublishedArticles } from "@/lib/articles";
import { getClientIp } from "@/lib/rateLimit";
import { checkRateLimit } from "@/lib/upstash";
import { isValidCsrfOriginFromParts } from "@/lib/csrf";
import { PublicArticle } from "@/types";

/**
 * Maximum number of bookmark IDs accepted per request.
 * Prevents DoS via unbounded array — especially important before the
 * MongoDB phase where this becomes a `$in` query against the DB.
 */
const MAX_BOOKMARK_IDS = 100;

/**
 * Resolve a list of bookmark IDs into safe public articles.
 *
 * This Server Action is the only code path that touches the articles
 * data store from the Bookmarks client component.  It returns PublicArticle[]
 * directly — author.email is structurally absent from the type (see H-1 fix).
 *
 * ── H-1 fix: raw `articles` export removed ────────────────────────────────
 * This action previously imported the raw `articles: Article[]` export and
 * called toPublicArticle() manually. The raw export has been replaced with
 * typed accessor functions — getPublishedArticles() returns PublicArticle[]
 * directly, making it structurally impossible for author.email to appear in
 * the result regardless of whether any stripping is applied here.
 *
 * ── M-3 fix: CSRF origin check now applied ────────────────────────────────
 * getBookmarkedArticles is a "use server" action reachable via a POST to
 * /_next/action. Every other mutating endpoint in this codebase calls
 * isValidCsrfOrigin() before doing any work; this action did not, so a
 * cross-origin page could embed a hidden form/fetch that drives this action
 * using the visitor's browser as an anonymous relay.
 *
 * Current impact was low — this action only reads from the in-memory article
 * list and returns PublicArticle[]; no writes occur — but the gap was real,
 * and it becomes a much bigger problem once this is backed by MongoDB: an
 * unauthenticated, un-CSRF-checked action that fans out into a
 * `db.collection("articles").find({ _id: { $in: safeIds } })` query is a
 * denial-of-wallet vector (up to 60 DB lookups/minute/victim IP — see the
 * rate-limit comment below). Closing this now, before the migration,
 * establishes the same habit every other route already follows.
 *
 * Server Actions never receive a NextRequest — only the headers()/cookies()
 * helpers from next/headers — so this calls isValidCsrfOriginFromParts(),
 * the Server-Action-compatible entry point added to lib/csrf.ts, rather than
 * isValidCsrfOrigin() (which requires a NextRequest and is used by every
 * route handler). Validation order (Origin/Referer first, double-submit
 * cookie fallback second) is identical to every other route; see lib/csrf.ts
 * for the full rationale.
 *
 * This action is invoked directly from a Client Component — app/bookmarks/
 * page.tsx calls `getBookmarkedArticles(ids)` as a plain async function, not
 * via a <form action> — so the browser's own fetch sets Origin on the
 * underlying POST to /_next/action for any normal browser. No client-side
 * header needs to be wired up for that common case. The double-submit
 * cookie fallback below remains available for the proxy-stripping scenarios
 * documented in lib/csrf.ts.
 *
 * ── H-2 fix: per-IP rate limiting now applied ─────────────────────────────
 * getBookmarkedArticles is a "use server" action (a POST to /_next/action).
 * Server Actions are not automatically covered by the route-level limits in
 * middleware.ts or the per-route wrappers in lib/rateLimit.ts.
 *
 * Without a rate limit, an attacker could spam this endpoint at whatever rate
 * Next.js allows. Against the current in-memory array the compute cost is
 * low, but the gap in the defence model is real: all other mutation endpoints
 * are rate-limited, and this one was not.
 *
 * More critically: this limit MUST be in place before the MongoDB migration.
 * The natural translation of the in-memory `.filter()` below is a
 * `find({ _id: { $in: safeIds }, status: "published" })` query. Without a
 * rate limit and an index, this becomes a denial-of-wallet vector: up to 100
 * arbitrary DB lookups per call, driven entirely by client-supplied IDs, with
 * no auth and no throttle.
 *
 * Limit: 60 req / IP / 60 s. This is generous for legitimate use (a user
 * loading their bookmarks page once per minute) and tight enough to make
 * automated flooding economically unattractive. Server Actions receive
 * NextRequest-equivalent headers via next/headers; getClientIp() extracts the
 * real client IP from those headers using the same trusted-header logic as
 * every other rate-limited endpoint in this codebase.
 *
 * REQUIRED before the MongoDB migration (in addition to this rate limit):
 *   1. A hard index on `articles._id` (or `articles.id`, whichever the
 *      migration uses as the lookup field) — an unindexed `$in` over a
 *      100-element array is a collection scan per element in the worst case.
 *
 * @param ids - Article IDs previously persisted in localStorage.
 * @returns Matching published articles with author email removed.
 */
export async function getBookmarkedArticles(
  ids: string[]
): Promise<PublicArticle[]> {
  // ── M-3 fix: CSRF origin check ──────────────────────────────────────────
  // Must run before the rate-limit check below — otherwise a cross-origin
  // attacker's forged calls would consume the victim's rate-limit budget
  // even though they'd never pass this check.  See docstring above and
  // lib/csrf.ts for the full rationale.
  const requestHeaders = await headers();
  const requestCookies = await cookies();
  if (!isValidCsrfOriginFromParts(requestHeaders, requestCookies)) {
    // Mirror the rate-limit branch below: return an empty array rather than
    // throwing, since a thrown error from a Server Action surfaces as an
    // unhandled error in the React component tree instead of a graceful
    // empty bookmarks list.
    return [];
  }

  // ── H-2 fix: per-IP rate limit ─────────────────────────────────────────────
  // Server Actions receive the same headers as a NextRequest; next/headers
  // exposes them via the async headers() helper.
  const ip = getClientIp(requestHeaders);
  const rateLimitKey = `bookmarks:${ip}`;
  const allowed = await checkRateLimit(rateLimitKey, 60, 60 * 1000, "[bookmarks]");
  if (!allowed) {
    // Return an empty array rather than throwing — the client treats an empty
    // bookmarks list gracefully, and a 429-style error response from a Server
    // Action would surface as an unhandled error in the React component tree.
    // The rate limit is logged by checkRateLimit via "[bookmarks]" prefix.
    return [];
  }

  if (!Array.isArray(ids) || ids.length === 0) return [];

  // Cap array length and strip any non-string / non-slug-safe values.
  // A valid article ID contains only alphanumeric characters and hyphens.
  // Enforced here so the same guard holds when this becomes a MongoDB $in query.
  const safeIds = ids
    .slice(0, MAX_BOOKMARK_IDS)
    .filter((id) => typeof id === "string" && /^[a-z0-9-]+$/.test(id));

  if (safeIds.length === 0) return [];

  // ── H-1 fix: getPublishedArticles() returns PublicArticle[] — no raw
  // Article objects are involved and toPublicArticle() is not needed here.
  // author.email is structurally absent from PublicArticle.
  return getPublishedArticles().filter((a) => safeIds.includes(a.id));
}
