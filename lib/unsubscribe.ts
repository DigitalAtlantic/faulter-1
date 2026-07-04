// Prevent this module from being imported in Client Components.
// lib/unsubscribe.ts reads UNSUBSCRIBE_SECRET and uses Web Crypto —
// server-only utilities that must never reach the browser bundle.
import "server-only";
import { siteUrl } from "@/lib/site";

// ---------------------------------------------------------------------------
// H-2 fix: HMAC-SHA256 token helpers for the unsubscribe endpoint.
//
// Kept in lib/ (not in the route file) because:
//   1. Next.js route files may only export HTTP method handlers (GET, POST, …)
//      plus a small allowlist of framework exports (revalidate, dynamic, …).
//      Any other named export causes a build-time type error.
//   2. The token generator needs to be importable from other server-side code
//      (e.g. the future welcome-email sender) without importing the route.
//
// SECURITY CONTRACT
// ─────────────────
// The token is HMAC-SHA256(UNSUBSCRIBE_SECRET, email.toLowerCase() + ":" + ts),
// where `ts` is the Unix timestamp (seconds) at which the token was minted.
// It is bound to both the specific email address (alice@example.com's token
// cannot unsubscribe bob@example.com) AND the timestamp it was issued at.
//
// Audit finding H-2: the previous design signed only the email, with no `ts`
// component. That made every issued token permanent and deterministic — the
// same token was valid forever for a given address, with no way to expire a
// link that leaked (e.g. via a forwarded email or a scraped newsletter
// archive) short of rotating UNSUBSCRIBE_SECRET, which would also invalidate
// every other still-wanted unsubscribe link already sitting in inboxes.
//
// Fix: bind the token to an issue time and enforce a maximum age window
// (TOKEN_MAX_AGE_SECONDS below) on verification. A leaked link self-expires
// instead of remaining a permanent, irrevocable "unsubscribe this address"
// lever. See the M-5 fix comment on TOKEN_MAX_AGE_SECONDS below for the
// current window (90 days) and why it was reduced from the original 365.
//
// Verification uses crypto.subtle.verify() which performs a constant-time
// comparison internally, preventing timing-oracle attacks.  safeEqual()
// adds a second constant-time string comparison as belt-and-suspenders.
//
// REQUIRED ENV VAR
// ─────────────────
// UNSUBSCRIBE_SECRET — a 32-byte (256-bit) random secret.
// Generate with:  openssl rand -hex 32
// Add to .env.local and your deployment environment variables.
// If absent in production, getUnsubscribeSecret() throws so the
// misconfiguration is immediately visible in logs rather than silently
// accepting or rejecting all tokens.
// ---------------------------------------------------------------------------

// M-5 fix: maximum age, in seconds, that an issued unsubscribe token remains
// valid.
//
// Previously 365 days. A leaked unsubscribe link — forwarded in an email
// thread, archived by a third-party newsletter scraper, cached by a browser
// history sync, etc. — was therefore a usable "delete this subscriber"
// lever for a full year after it was minted. Reduced to 90 days: CAN-SPAM
// only requires that opt-out requests be honoured within 10 business days
// of being submitted, so a 90-day link lifetime is still more than generous
// for any real subscriber who finally gets around to clicking an old email,
// while cutting the leak-exposure window by roughly 4x. Rotating
// UNSUBSCRIBE_SECRET remains the only way to revoke a token before its
// natural expiry.
export const TOKEN_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

// H-2 fix: replaced the isRealProduction() heuristic (which gated on
// NEXT_PUBLIC_SITE_URL being an https:// origin) with a direct
// NODE_ENV === "production" check.
//
// The heuristic allowed a staging or preview deployment running
// NODE_ENV=production but without NEXT_PUBLIC_SITE_URL to silently fall back
// to the well-known placeholder string from public source — anyone who reads
// the repo can generate valid unsubscribe tokens for arbitrary email addresses
// against that environment.
//
// check-env.mjs already enforces NEXT_PUBLIC_SITE_URL at build time for
// genuine production builds, making the two-layer heuristic redundant.  The
// security check should be the simpler and stricter one:
//
//   • Local dev (NODE_ENV=development)           → placeholder returned (expected)
//   • Staging/preview (NODE_ENV=production)       → throws immediately (correct:
//       staging environments must have the var set; the old code silently
//       allowed forgery here)
//   • Production without secret (NODE_ENV=production) → throws (correct)
//   • Production with real secret                 → returns secret (correct)
//   • Production with secret literally set to the placeholder string below
//     (NODE_ENV=production) → throws (L-1 fix, see below)
//
// L-1 fix: this module has the same class of dev-fallback constant as
// middleware.ts's SEARCH_COOKIE_SECRET / _PLACEHOLDER_SECRET (see that
// file's M-1 fix, lines ~79-96), but previously only checked whether
// UNSUBSCRIBE_SECRET was entirely absent — not whether it had been set
// verbatim to this literal. Anyone who reads the public source can mint
// valid unsubscribe tokens for arbitrary email addresses against any
// deployment that copies this string into its env vars, so the check now
// mirrors middleware.ts: absent OR equal to the placeholder both throw in
// production, and both fall back to the placeholder (with a one-time
// warning) outside production.
const _UNSUB_PLACEHOLDER =
  "dev-insecure-unsubscribe-placeholder-do-not-use-in-production";

/** Guards the one-time UNSUBSCRIBE_SECRET warning so it only logs once. */
let _unsubscribeSecretWarnedOnce = false;

export function getUnsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret || secret === _UNSUB_PLACEHOLDER) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        !secret
          ? "UNSUBSCRIBE_SECRET is not set. " +
              "Generate one with `openssl rand -hex 32` and add it to your " +
              "deployment environment variables."
          : "UNSUBSCRIBE_SECRET is set to the insecure placeholder value " +
              "from the public source. Generate a real secret with " +
              "`openssl rand -hex 32` and replace the placeholder in your " +
              "deployment environment variables."
      );
    }
    // Non-production fallback — allows local testing without secrets configured.
    if (!_unsubscribeSecretWarnedOnce) {
      _unsubscribeSecretWarnedOnce = true;
      console.error(
        "[unsubscribe] UNSUBSCRIBE_SECRET is not set (or is the insecure " +
        "placeholder). Using an insecure fallback — DO NOT deploy without a " +
        "real secret. Generate one with: openssl rand -hex 32"
      );
    }
    return _UNSUB_PLACEHOLDER;
  }
  return secret;
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getUnsubscribeSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Produce a URL-safe HMAC-SHA256 token for the given email address, bound to
 * a specific issue time.
 *
 * The email is normalised to lowercase before signing so that
 * Alice@Example.com and alice@example.com produce the same token —
 * matching how the address is stored in MongoDB (email.toLowerCase()).
 *
 * H-2 fix: the signed message is now `${email}:${ts}` rather than just
 * `${email}`. This binds the token to the moment it was minted, which lets
 * the verifier (in app/api/unsubscribe/route.ts) reject tokens older than
 * TOKEN_MAX_AGE_SECONDS — closing the "permanent token" gap from the audit.
 *
 * ⚠️  CALLERS: do NOT build the unsubscribe link yourself.
 * Use `buildUnsubscribeLink()` below instead — it centralizes the token
 * minting (HMAC + timestamp binding) and the origin/domain resolution
 * (shared with the rest of the app via `lib/site.ts` — see the HIGH-1
 * correction on buildUnsubscribeLink() itself for why this is a single
 * build-time value, not a per-request one).
 *
 * @param email - The subscriber's email address (will be normalised to lowercase).
 * @param ts - Unix timestamp in seconds the token is bound to. Defaults to
 *             the current time when minting a fresh link. The route handler
 *             passes the `ts` value parsed from the incoming URL so it can
 *             re-derive the *same* expected token for comparison — verifying
 *             a token therefore means recomputing it at the timestamp the
 *             caller claims, then checking that timestamp isn't too old.
 */
export async function generateUnsubscribeToken(
  email: string,
  ts: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const key = await getHmacKey();
  const message = `${email.toLowerCase()}:${ts}`;
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  // base64url encode: standard base64 with + → -, / → _, padding stripped
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Constant-time string comparison.
 *
 * crypto.subtle.verify() already performs constant-time comparison for the
 * HMAC check inside generateUnsubscribeToken(), but this helper adds a
 * second layer for the final base64url string comparison in the route.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// HIGH-1 correction (supersedes the original M-7 reasoning below, which was
// based on an incorrect premise):
//
// The original comment claimed that reading `process.env.NEXT_PUBLIC_SITE_URL`
// directly inside this function (instead of importing `siteUrl` from
// lib/site.ts) makes the value resolve "at call time" / "at runtime" rather
// than at build time, specifically to support a single build promoted
// across multiple environments (e.g. a Docker image built once and deployed
// to staging then production with different env vars).
//
// This is incorrect. Next.js inlines every `NEXT_PUBLIC_*` reference via a
// build-time string replacement, and it does this everywhere the literal
// `process.env.NEXT_PUBLIC_SITE_URL` text appears in source — including
// server-only code, not only code that ships to the browser. There is no
// runtime distinction between this function reading the env var directly
// and `lib/site.ts` reading it at module-import time: both occurrences get
// replaced with the identical literal value at build time. Duplicating the
// read here did not achieve anything beyond what importing `siteUrl` would
// have, and the "build once, promote through staging/production" scenario
// the comment was written to solve is NOT actually fixed by this pattern.
//
// This function now imports `siteUrl` from lib/site.ts directly (see below)
// rather than re-deriving it, since they are guaranteed to be the same
// value. If true single-build/multi-environment deploys are ever required,
// the fix is to derive the origin from a trusted request-time source
// instead (e.g. the validated Host/X-Forwarded-Host header already used
// elsewhere in this codebase's proxy-trust logic in middleware.ts), not
// from any `NEXT_PUBLIC_*` variable.
//
// buildUnsubscribeLink() still throws in production if `siteUrl` is empty,
// since an unsubscribe link with no domain would be a broken/illegal
// CAN-SPAM link — this behavior is preserved below.
// ---------------------------------------------------------------------------

/**
 * Build a complete, signed unsubscribe URL for `email`.
 *
 * The domain comes from `siteUrl` (lib/site.ts), which is itself derived
 * from `NEXT_PUBLIC_SITE_URL`. This is a single build-time-inlined value —
 * see the HIGH-1 correction above for why reading the env var directly here
 * instead of importing `siteUrl` would not have produced a different
 * result. Falls back to `http://localhost:3000` in development when the
 * variable is unset (same fallback `siteUrl` itself applies).
 *
 * H-2 fix: the returned URL now carries a `ts` query parameter alongside
 * `email` and `token`. `ts` is the Unix timestamp (seconds) the token was
 * minted at; the route handler uses it to re-derive the expected token and
 * to reject the link once it's older than TOKEN_MAX_AGE_SECONDS.
 *
 * @param email - The subscriber's email address (will be normalised to lowercase).
 * @returns An absolute URL string safe to embed in an outgoing email.
 */
export async function buildUnsubscribeLink(email: string): Promise<string> {
  // siteUrl is already trailing-slash-stripped and applies the same
  // dev-only localhost fallback this function previously re-implemented.
  const origin = siteUrl;

  if (!origin && process.env.NODE_ENV === "production") {
    // Surface the misconfiguration loudly rather than silently producing a
    // broken link.  The send path should gate on this before dispatching.
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is not set. " +
        "Unsubscribe links cannot be built without a base URL. " +
        "Set NEXT_PUBLIC_SITE_URL to the full public origin of this deployment " +
        "(e.g. https://faulter.news) before sending emails."
    );
  }

  // H-2 fix: mint the token bound to "now" and carry that same timestamp in
  // the URL as `ts`. The route handler re-derives the expected token from
  // (email, ts) and rejects the request if `ts` is older than
  // TOKEN_MAX_AGE_SECONDS — see lib/unsubscribe.ts header comment.
  const ts = Math.floor(Date.now() / 1000);
  const normalizedEmail = email.trim().toLowerCase();
  const token = await generateUnsubscribeToken(normalizedEmail, ts);
  return `${origin}/api/unsubscribe?email=${encodeURIComponent(normalizedEmail)}&ts=${ts}&token=${token}`;
}
