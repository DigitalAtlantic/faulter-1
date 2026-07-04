import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { checkRateLimitUnsubscribe, getClientIp, hashIp, redactEmail } from "@/lib/rateLimit";
import { getEnv } from "@/lib/env";
import { getDb, logGdprErasure } from "@/lib/db";
import crypto from "node:crypto";
import { absoluteUrl, siteName } from "@/lib/site";
import { escapeHtml } from "@/lib/sanitize";
import { isValidCsrfOrigin } from "@/lib/csrf";
import {
  generateUnsubscribeToken,
  safeEqual,
  getUnsubscribeSecret,
  TOKEN_MAX_AGE_SECONDS,
} from "@/lib/unsubscribe";

// ─── H-2 fix: Unsubscribe endpoint ──────────────────────────────────────────
//
// WHY THIS EXISTS
// ───────────────
// Newsletter subscribers are stored in MongoDB and added to a Resend audience.
// Without this endpoint there is no way to honour:
//   • GDPR Article 17 — right to erasure (EU subscribers)
//   • CAN-SPAM Act    — functional unsubscribe mechanism required in every
//                       commercial email sent to US recipients
//
// The Privacy Policy at /privacy already states users may request deletion.
// This endpoint makes that promise technically enforceable.
//
// SECURITY DESIGN
// ───────────────
// Unsubscribe links in emails must work without the user being logged in,
// so the link cannot require a session.  We use HMAC-SHA256 signed tokens
// instead — see lib/unsubscribe.ts for the full design and usage notes.
//
// M-6 fix: GET MUST NOT MUTATE — TWO-STEP CONFIRM FLOW
// ──────────────────────────────────────────────────────
// PROBLEM: the original implementation performed the actual subscriber
// deletion directly inside the GET handler. Email clients and security
// gateways routinely prefetch every link in an email before the user ever
// clicks anything:
//   • Gmail's image/link proxying and "Open in new tab" prefetch behaviour
//   • Outlook Safe Links (rewrites and pre-fetches every URL to scan it)
//   • Corporate email security gateways that crawl links for malware scanning
// Any of these following a one-step GET unsubscribe link silently deletes
// the subscriber before the human ever sees the email — the opposite of
// what they asked for, and a real-world cause of "I never unsubscribed
// myself!" support tickets.
//
// FIX: GET now performs validation only (rate limit, parameter shape, HMAC,
// expiry) and renders a plain HTML confirmation page with a <form> whose
// hidden fields carry the same (email, ts, token) triple. No deletion
// happens on GET — a prefetch just renders harmless static HTML. The actual
// deletion has moved to the POST handler below, which only runs when a human
// submits the form by clicking the button. Prefetchers fetch links via GET;
// they do not submit forms.
//
// NOTE: only GET, POST (and framework-reserved exports) may be exported from
// a Next.js route file.  All HMAC helpers live in lib/unsubscribe.ts so
// they can be imported by other server code without triggering the
// Next.js route-export type check.
//
// M-7 fix: BUILDING UNSUBSCRIBE LINKS
// ────────────────────────────────────
// When the welcome-email sender is built, use buildUnsubscribeLink() from
// lib/unsubscribe.ts — NOT a manually assembled template string — to produce
// the URL that goes inside the email body:
//
//   import { buildUnsubscribeLink } from "@/lib/unsubscribe";
//   const link = await buildUnsubscribeLink(subscriberEmail);
//
// buildUnsubscribeLink() resolves the domain from `siteUrl` (lib/site.ts),
// which is itself derived from NEXT_PUBLIC_SITE_URL. That value is inlined
// at build time everywhere it's referenced in source — including
// server-only code — so there is no "call time vs. build time" difference
// between reading process.env.NEXT_PUBLIC_SITE_URL directly here and
// importing siteUrl: both resolve to the identical build-time value. (An
// earlier version of this comment claimed the opposite; see the HIGH-1
// correction directly above buildUnsubscribeLink() in lib/unsubscribe.ts
// for why that reasoning was wrong, and why this function now imports
// siteUrl rather than re-reading the env var.)
//
// The actual reason to always go through buildUnsubscribeLink(), rather than
// assembling a link by hand, is that it also mints and embeds the HMAC
// token + `ts` timestamp that the route handler below verifies — a
// hand-built link would be missing those and would simply fail
// verification (403), regardless of which domain it pointed at. The link
// still points at this same GET endpoint — it now lands on the confirmation
// page rather than triggering deletion directly.
//
// RATE LIMITING (H-5 fix)
// ─────────────────────────────────────────────────────────────────────────
// Token entropy (2^256 HMAC values) makes brute-force infeasible and
// safeEqual() prevents timing oracles on individual requests.  However,
// without a per-IP rate limit two real attack surfaces remain:
//
//   1. DB amplification: every well-formed POST request — valid or not —
//      reaches MongoDB for the deleteOne() call.  An attacker can flood the
//      endpoint with syntactically valid but token-mismatched requests, each
//      costing a DB round-trip.  At scale this is a cheap, targeted DoS
//      against the subscribers collection.
//
//   2. Aggregate timing oracle: safeEqual() is constant-time per request, but
//      a network-level attacker aggregating thousands of response latencies
//      can recover statistical signal even from individually constant-time ops.
//      Rate-limiting caps the number of samples an attacker can collect.
//
// Fix: 10 requests / IP / minute, applied to BOTH GET (confirmation page) and
// POST (actual deletion) independently.  A human unsubscribing is one GET
// (load the page) followed by one POST (click the button) — 10/min on each
// is generous for any real user (covers accidental double-clicks, retries
// after a browser crash, and link-preview fetches by email clients) while
// making both attack vectors economically unattractive.
//
// The same Upstash/in-process backend used by contact + newsletter limiters
// ensures this works correctly on serverless deployments when Upstash is set.
//
// External-audit M-5 fix: CSRF ORIGIN CHECK ON POST
// ─────────────────────────────────────────────────────────────────────────
// Every other mutating endpoint in this codebase (contact, newsletter,
// error-report) calls isValidCsrfOrigin() before doing any work — this one
// didn't. Added as step 0 of the POST handler below, mirroring the
// `error-report` route's ordering (CSRF check first, before the rate limit
// or any parsing), since it is the cheapest possible rejection: synchronous,
// no I/O, no DB round-trip, no rate-limit budget spent.
//
// On its own, the (email, ts, token) HMAC already prevents a forged request
// from unsubscribing an *arbitrary* address the caller doesn't already have
// a valid signed link for — knowing UNSUBSCRIBE_SECRET is required to mint
// one. So this is not "the only thing stopping mass unsubscribes." What it
// closes is the narrower gap: without it, any third-party page can embed a
// hidden auto-submitting form (or a `fetch(..., { mode: "no-cors" })`) that
// uses a visitor's own browser as an anonymous relay to fire arbitrary
// requests at this endpoint — consuming the visitor's rate-limit budget,
// generating DB round-trips and Resend API calls under their IP, and making
// the traffic harder to attribute, all without the visitor's knowledge.
// Requiring the request to actually originate from our own confirmation
// page (Origin/Referer match, with the double-submit cookie as a fallback
// for proxies that strip both — see lib/csrf.ts) closes that off, for the
// same reason it's worth having on contact/newsletter/error-report even
// though none of those have a server-side session to "hijack" either.
//
// Deliberately reuses the exact same 403 response (status + body) as the
// token-mismatch branch in validateUnsubscribeParams() below, rather than a
// distinct "Forbidden" message — so a forged-origin POST is indistinguishable
// from a tampered-token POST to anyone probing the endpoint for behavioural
// differences. Scoped to POST only: GET (confirmation page) performs no
// mutation after the M-6 fix above, so there is nothing here for CSRF to
// protect on that path.
//

// RESEND AUDIENCE REMOVAL
// ────────────────────────
// Resend's contacts.remove() call is best-effort.  If it fails the
// MongoDB deletion is still the source-of-truth success and we log
// the Resend failure for manual follow-up.
// ────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Resend client (lazy singleton — mirrors newsletter route pattern)
// ---------------------------------------------------------------------------

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(getEnv().RESEND_API_KEY);
  return _resend;
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

/** Plain-text error response — used by both GET and POST for malformed/
 *  invalid requests, before any HTML page would make sense to render. */
function textError(body: string, status: number, extraHeaders?: Record<string, string>): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

type ValidationResult =
  | { ok: true; email: string; ts: number; token: string }
  | { ok: false; response: NextResponse };

/**
 * Validate the (email, ts, token) triple shared by both the GET
 * confirmation page and the POST deletion handler.
 *
 * M-6 fix: this is the exact validation the old single-step GET handler ran
 * before deleting — parameter shape, timestamp format, token expiry
 * (TOKEN_MAX_AGE_SECONDS), and HMAC verification (safeEqual). Extracted here
 * so GET (render confirmation) and POST (perform deletion) both reject
 * malformed, expired, or tampered links identically and a future change to
 * the validation logic cannot accidentally apply to only one of the two
 * handlers.
 *
 * Does NOT perform the per-IP rate-limit check — callers do that first,
 * before even reading parameters, so a flood of requests is rejected as
 * cheaply as possible.
 */
async function validateUnsubscribeParams(
  params: { email: string | null; ts: string | null; token: string | null },
  ip: string
): Promise<ValidationResult> {
  const rawEmail = params.email ?? "";
  const rawTs = params.ts ?? "";
  const rawToken = params.token ?? "";

  if (!rawEmail || !rawTs || !rawToken) {
    return {
      ok: false,
      response: textError(
        "Invalid unsubscribe link — missing parameters. " +
          "Please use the link from your email.",
        400
      ),
    };
  }

  // Normalise email the same way it was normalised on write.
  const email = rawEmail.trim().toLowerCase();

  // Basic email shape check — not a substitute for the HMAC verification below,
  // but catches obviously malformed values before touching the DB.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return {
      ok: false,
      response: textError("Invalid unsubscribe link — malformed email address.", 400),
    };
  }

  // `ts` must be a plain non-negative integer (Unix seconds) before it's
  // trusted as input to the HMAC re-derivation below. Reject anything else
  // (empty, non-numeric, negative, fractional, scientific notation, leading
  // "+", etc.) rather than coercing it — Number()/parseInt() accept all of
  // those silently, which would let a forged `ts` slip through as some
  // unintended numeric value instead of failing closed.
  if (!/^\d+$/.test(rawTs)) {
    return {
      ok: false,
      response: textError("Invalid unsubscribe link — malformed timestamp.", 400),
    };
  }
  const tokenTs = Number(rawTs);
  if (!Number.isSafeInteger(tokenTs)) {
    return {
      ok: false,
      response: textError("Invalid unsubscribe link — malformed timestamp.", 400),
    };
  }

  // Reject tokens older than TOKEN_MAX_AGE_SECONDS. This is the expiry check
  // that closes the audit's "permanent token" finding — a link that leaked
  // long ago (forwarded email, scraped newsletter archive, etc.) stops being
  // a usable unsubscribe lever once it ages out, without requiring
  // UNSUBSCRIBE_SECRET rotation to revoke it.
  //
  // `Math.abs` (rather than a one-sided check) also rejects a `ts` claiming
  // to be in the future, which can only mean a forged or clock-skewed value
  // since buildUnsubscribeLink() always mints `ts` as "now".
  const tokenAgeSeconds = Math.abs(Date.now() / 1000 - tokenTs);
  if (tokenAgeSeconds > TOKEN_MAX_AGE_SECONDS) {
    console.warn("[Unsubscribe] Token expired:", {
      email: redactEmail(email),
      ipHash: await hashIp(ip),
      ageSeconds: Math.round(tokenAgeSeconds),
      ts: new Date().toISOString(),
    });
    return {
      ok: false,
      response: textError(
        "This unsubscribe link has expired. Please request a fresh one from " +
          "the most recent email we've sent you, or contact us directly to " +
          "be removed from our mailing list.",
        403
      ),
    };
  }

  // Verify HMAC token. generateUnsubscribeToken() re-derives the expected
  // HMAC for (email, tokenTs) — the same timestamp embedded in the URL, not
  // the current time. The age check above already bounds how old tokenTs
  // may legitimately be; this step confirms the token actually matches that
  // specific (email, ts) pair rather than having been forged or copied from
  // a different link. safeEqual() then compares the expected token against
  // the one supplied using a constant-time algorithm to prevent
  // timing-oracle attacks.
  let expectedToken: string;
  try {
    // Call getUnsubscribeSecret() eagerly so a missing-secret error is caught
    // here and returns 503 rather than propagating as an unhandled rejection.
    getUnsubscribeSecret();
    expectedToken = await generateUnsubscribeToken(email, tokenTs);
  } catch (err) {
    console.error("[Unsubscribe] Secret misconfiguration:", {
      error: err instanceof Error ? err.message : String(err),
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return {
      ok: false,
      response: textError(
        "Unsubscribe service temporarily unavailable. Please try again later.",
        503
      ),
    };
  }

  if (!safeEqual(rawToken, expectedToken)) {
    // Log at warn — a mismatch can mean a tampered link or a probing attacker.
    // Do not reveal which part was wrong to the caller.
    console.warn("[Unsubscribe] Token mismatch:", {
      email: redactEmail(email),
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return {
      ok: false,
      response: textError(
        "Invalid unsubscribe link — the link may have been modified. " +
          "Please use the link exactly as it appears in your email.",
        403
      ),
    };
  }

  return { ok: true, email, ts: tokenTs, token: rawToken };
}

/**
 * Render the M-6 fix confirmation page: a minimal, self-contained HTML form
 * (no inline <script>, no external requests) that POSTs the same (email,
 * ts, token) triple back to this same route as hidden fields.
 *
 * Deliberately not styled with the site's Tailwind build — this is a
 * standalone document served directly from an API route, not a Next.js
 * page, so it carries its own tiny <style> block. The existing CSP
 * (`style-src 'self' 'unsafe-inline'`, set in middleware.ts) already permits
 * this; there is no inline <script> here, so `script-src` is untouched.
 */
function renderConfirmationPage(email: string, ts: number, token: string): NextResponse {
  const safeEmail = escapeHtml(email);
  const safeSiteName = escapeHtml(siteName);
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confirm unsubscribe — ${safeSiteName}</title>
<meta name="robots" content="noindex, nofollow">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         background: #f7f5f0; color: #1a1a1a; margin: 0; padding: 0; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 64px 24px; text-align: center; }
  h1 { font-size: 28px; font-weight: 800; margin: 0 0 16px; }
  p { font-size: 16px; line-height: 1.6; color: #4a4a4a; margin: 0 0 28px; }
  .email { font-weight: 600; color: #1a1a1a; }
  button { background: #1a1a1a; color: #fff; border: none; font-size: 14px;
           font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
           padding: 14px 32px; cursor: pointer; }
  button:hover { opacity: 0.85; }
  a { color: #1a1a1a; text-decoration: underline; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Unsubscribe from ${safeSiteName}?</h1>
    <p>You're about to unsubscribe <span class="email">${safeEmail}</span> from
    all Faulter newsletter emails. Click below to confirm.</p>
    <form method="POST" action="${absoluteUrl("/api/unsubscribe")}">
      <input type="hidden" name="email" value="${safeEmail}">
      <input type="hidden" name="ts" value="${ts}">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button type="submit">Confirm unsubscribe</button>
    </form>
    <p style="margin-top: 28px;"><a href="${absoluteUrl("/")}">Changed your mind? Return to ${safeSiteName}</a></p>
  </div>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Never cache this page — it embeds a one-time-use token.
        "Cache-Control": "no-store",
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/unsubscribe?email=<address>&ts=<unix-seconds>&token=<hmac>
 *
 * M-6 fix: renders an HTML confirmation page rather than performing the
 * deletion directly. Validates the HMAC token and expiry first so that an
 * invalid or expired link still fails fast with a plain-text error — the
 * confirmation page is only ever shown for a link that, if confirmed, would
 * actually succeed.
 *
 * The actual subscriber deletion now happens only in the POST handler below,
 * triggered by a human submitting the form rendered here.
 *
 * Query parameters:
 *   email — the subscriber's email address (URL-encoded)
 *   ts    — Unix timestamp (seconds) the token was minted at, as embedded by
 *           buildUnsubscribeLink() in lib/unsubscribe.ts. Re-derives the
 *           expected token and bounds its lifetime.
 *   token — the HMAC-SHA256 signature produced by generateUnsubscribeToken()
 *            in lib/unsubscribe.ts, computed over (email, ts)
 *
 * Response codes:
 *   200 — confirmation page rendered (no deletion has occurred yet)
 *   400 — missing or malformed parameters (including a non-numeric `ts`)
 *   403 — token does not match (email, ts), OR `ts` is older than
 *         TOKEN_MAX_AGE_SECONDS (tampered, expired, or wrong-address link)
 *   429 — rate limited
 *   503 — server misconfiguration (UNSUBSCRIBE_SECRET not set)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request.headers);

  // H-5 fix: per-IP rate limit — 10 req / IP / 60 s. Placed before parameter
  // parsing and HMAC verification so that even syntactically invalid
  // requests (missing params, wrong token format) are gated. Without this,
  // an attacker pays only a URL-fetch cost per probe; with it, they exhaust
  // their window on the first 10 tries per minute.
  if (!await checkRateLimitUnsubscribe(ip)) {
    return textError(
      "Too many requests. Please wait a moment before trying again.",
      429,
      { "Retry-After": "60" }
    );
  }

  const { searchParams } = request.nextUrl;
  const result = await validateUnsubscribeParams(
    {
      email: searchParams.get("email"),
      ts: searchParams.get("ts"),
      token: searchParams.get("token"),
    },
    ip
  );

  if (!result.ok) return result.response;

  return renderConfirmationPage(result.email, result.ts, result.token);
}

/**
 * POST /api/unsubscribe
 *
 * M-6 fix: performs the actual deletion. Only reached when a human submits
 * the confirmation form rendered by GET above — email prefetchers and link
 * scanners issue GET requests, never POSTs with a matching form body, so
 * they can no longer trigger an unsubscribe by simply visiting the link.
 *
 * Re-runs the exact same validation as GET (rate limit, parameter shape,
 * HMAC, expiry) rather than trusting that a prior GET already validated
 * this request — the two are independent HTTP requests and an attacker
 * could POST directly without ever loading the confirmation page.
 *
 * Body (application/x-www-form-urlencoded, from the rendered <form>):
 *   email, ts, token — same meaning and validation as the GET query params.
 *
 * Response codes:
 *   200 — successfully unsubscribed (idempotent — safe to call twice)
 *   400 — missing or malformed parameters, or unparsable form body
 *   403 — token does not match (email, ts), OR `ts` is older than
 *         TOKEN_MAX_AGE_SECONDS (tampered, expired, or wrong-address link)
 *   415 — Content-Type is not application/x-www-form-urlencoded
 *         (external-audit M-5 fix — see the check above)
 *   429 — rate limited
 *   502 — MongoDB deletion failed
 *   503 — server misconfiguration (UNSUBSCRIBE_SECRET not set)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 0. CSRF: Origin/Referer check (external-audit M-5 fix) ──────────────
  // See the "External-audit M-5 fix" note in the file header above for the
  // full rationale. Checked first — before the rate limit, before reading
  // the form body — because it's the cheapest possible rejection: no I/O,
  // no DB hit, no rate-limit budget spent on a request that didn't even
  // come from our own confirmation page.
  //
  // Reuses the identical 403 response used by the token-mismatch branch in
  // validateUnsubscribeParams() so a forged-origin POST can't be
  // distinguished from a tampered-token POST by an external prober.
  if (!isValidCsrfOrigin(request)) {
    return textError(
      "Invalid unsubscribe link — the link may have been modified. " +
        "Please use the link exactly as it appears in your email.",
      403
    );
  }

  const ip = getClientIp(request.headers);

  // Same per-IP rate limit as GET, checked independently — see the M-6 fix
  // rate-limiting note in the header comment for why GET and POST are each
  // gated at 10/min rather than sharing a single combined budget.
  if (!await checkRateLimitUnsubscribe(ip)) {
    return textError(
      "Too many requests. Please wait a moment before trying again.",
      429,
      { "Retry-After": "60" }
    );
  }

  // ── Content-Type validation (external-audit M-5 fix) ────────────────────
  // The confirmation page's <form> always submits as
  // application/x-www-form-urlencoded (the browser default for a plain
  // <form> with no enctype override — see the comment below). That is the
  // ONLY content type a legitimate request will ever use here, so it's also
  // the only one we accept.
  //
  // Why this matters even with isValidCsrfOrigin() already checked above:
  // request.formData() happily parses both application/x-www-form-urlencoded
  // AND multipart/form-data bodies. Both of those, plus text/plain, are
  // "simple" content types that a cross-origin <form> or a `no-cors` fetch
  // can send without triggering a CORS preflight — and isValidCsrfOrigin()
  // is the only thing standing between such a request and this handler.
  // Most real browsers send Origin on a cross-site POST, which
  // isValidCsrfOrigin() catches, but a client that omits Origin AND Referer
  // (an aggressive proxy-stripping scenario — see lib/csrf.ts) falls through
  // to the double-submit cookie check, which this route does not require.
  // Pinning Content-Type to exactly what our own form sends removes
  // multipart/form-data and text/plain as viable encodings for that residual
  // path, narrowing it instead of relying on the HMAC token as the only
  // remaining backstop. (The HMAC token in the body still independently
  // requires a valid signed link from the server either way — see the
  // module header.)
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return textError(
      "Invalid unsubscribe request — unexpected content type.",
      415
    );
  }

  // The confirmation page's <form> submits as
  // application/x-www-form-urlencoded (the browser default for a plain
  // <form> with no enctype override) — deliberately not JSON, so the page
  // works with JavaScript disabled. request.formData() parses both
  // urlencoded and multipart bodies, but the Content-Type check above
  // already restricts us to the urlencoded case.
  let email: string | null;
  let ts: string | null;
  let token: string | null;
  try {
    const form = await request.formData();
    email = form.get("email")?.toString() ?? null;
    ts = form.get("ts")?.toString() ?? null;
    token = form.get("token")?.toString() ?? null;
  } catch (err) {
    console.error("[Unsubscribe] Failed to parse form body:", {
      error: err instanceof Error ? err.message : String(err),
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return textError("Invalid unsubscribe request — could not read form data.", 400);
  }

  const result = await validateUnsubscribeParams({ email, ts, token }, ip);
  if (!result.ok) return result.response;

  return performUnsubscribe(result.email, ip);
}

/**
 * Perform the actual subscriber deletion (MongoDB), GDPR erasure logging,
 * and best-effort Resend audience removal.
 *
 * M-6 fix: this is the body of the old single-step GET handler, unchanged
 * in behaviour, now invoked only from POST after validateUnsubscribeParams()
 * has already confirmed the (email, ts, token) triple.
 */
async function performUnsubscribe(email: string, ip: string): Promise<NextResponse> {
  // ── Delete from MongoDB ─────────────────────────────────────────────────
  //
  // MongoDB is the source of truth.  We delete first so the subscriber is
  // gone from our system even if the Resend call below fails.

  try {
    const db = await getDb();
    // deleteOne is idempotent — if the document does not exist (already
    // deleted, never subscribed) it succeeds silently with deletedCount: 0.
    await db.collection("subscribers").deleteOne({ email });
  } catch (err) {
    console.error("[Unsubscribe] MongoDB delete failed:", {
      error: err instanceof Error ? err.message : String(err),
      email: redactEmail(email),
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return textError("Failed to process unsubscribe request. Please try again later.", 502);
  }

  // ── Write GDPR Art. 5(2) accountability record (best-effort) ───────────
  //
  // The subscriber has been deleted.  Log the erasure to the gdpr_erasure_log
  // collection so there is an auditable record that demonstrates compliance.
  // Only hashes are stored — never the raw email or IP.
  // Non-fatal: if logging fails the subscriber is already gone; we log the
  // failure to stderr for manual follow-up but still return 200 to the user.
  //
  // L-6 fix: previously these were plain crypto.createHash("sha256") digests
  // — unkeyed, so anyone who later sees a leaked hash can dictionary/rainbow-
  // table it back to the source email or IP (email address space is far from
  // uniformly random, and IPv4 space is only 2^32). Switched to
  // crypto.createHmac("sha256", SECRET) using the existing UNSUBSCRIBE_SECRET
  // (already imported above as getUnsubscribeSecret() for token signing) so
  // the accountability record stays non-reversible without that secret,
  // rather than introducing a second secret to provision and rotate.
  {
    const secret = getUnsubscribeSecret();
    const emailHash = crypto.createHmac("sha256", secret).update(email).digest("hex");
    const ipHashFull =
      ip !== "unknown"
        ? crypto.createHmac("sha256", secret).update(ip).digest("hex")
        : "unknown";
    await logGdprErasure(emailHash, ipHashFull, "unsubscribe-link").catch(() => {
      console.error(
        "[Unsubscribe] GDPR erasure log failed — subscriber was deleted but audit record not written"
      );
    });
  }

  // ── Remove from Resend audience (best-effort) ───────────────────────────
  //
  // Failure here does not revert the MongoDB deletion.  The subscriber is
  // already gone from our system; the Resend audience is best-effort cleanup.
  //
  // Strategy: try email-based removal first (fast path, one API call).
  // If Resend confirms the contact still exists after that call, fall back to
  // the list-then-remove-by-id path (two API calls, canonical UUID interface).
  //
  // The list+id path is included because the Resend SDK v4 email-keyed removal
  // can return without throwing while silently leaving the contact in the
  // audience — a GDPR Art. 17 / CAN-SPAM compliance failure.  UUID-based
  // removal via contacts.remove({ audienceId, id }) is the stable, canonical
  // interface that is confirmed to actually delete the record.
  //
  // Idempotency: if the contact is not in the audience (already removed or
  // never added) both paths handle that gracefully and log the outcome.
  {
    const audienceId = getEnv().RESEND_AUDIENCE_ID;

    // ── Phase 1: email-based removal (fast path) ────────────────────────────
    let emailRemovalSucceeded = false;
    try {
      await getResend().contacts.remove({ audienceId, email });
      emailRemovalSucceeded = true;
      console.log("[Unsubscribe] Resend removal path: email-based call succeeded", {
        email: redactEmail(email),
        ipHash: await hashIp(ip),
        ts: new Date().toISOString(),
      });
    } catch (err) {
      // Email-based removal threw — proceed directly to the id-based fallback.
      console.warn("[Unsubscribe] Resend email-based removal threw (falling back to id-based):", {
        error: err instanceof Error ? err.message : String(err),
        email: redactEmail(email),
        ipHash: await hashIp(ip),
        ts: new Date().toISOString(),
      });
    }

    // ── Phase 2: verify + id-based fallback ────────────────────────────────
    //
    // Run even when Phase 1 did not throw: email-keyed removal can succeed
    // silently without actually deleting the contact.  We check whether the
    // contact is still present and, if so, remove by UUID.
    //
    // M-1 fix: use contacts.get({ audienceId, email }) — a single O(1)
    // lookup by email address — instead of contacts.list({ audienceId })
    // followed by a JS .find() scan.
    //
    // contacts.list() returns every contact in the audience in a single
    // unbounded payload.  At 100k+ subscribers the payload size and latency
    // grow without bound, and repeated calls from different IPs (still
    // individually rate-limited to 10/min, but parallelisable) could
    // time out the Vercel serverless function (default 10 s) and act as a
    // sustained DoS against this endpoint.
    //
    // contacts.get() maps to:
    //   GET /audiences/:audienceId/contacts/:email   (Resend REST v1)
    // and returns exactly one record or null — no pagination, no scanning.
    // GetContactOptions in Resend SDK v4 accepts { audienceId, email }.
    try {
      const getResult = await getResend().contacts.get({ audienceId, email });
      const contact = getResult?.data ?? null;

      if (!contact) {
        // Contact is not in the audience — either Phase 1 worked, or the
        // contact was already absent before this request.
        if (emailRemovalSucceeded) {
          console.log("[Unsubscribe] Resend audience verified: contact removed by email-based call", {
            email: redactEmail(email),
            ipHash: await hashIp(ip),
            ts: new Date().toISOString(),
          });
        } else {
          console.log("[Unsubscribe] Resend audience: contact not found (already removed or never added)", {
            email: redactEmail(email),
            ipHash: await hashIp(ip),
            ts: new Date().toISOString(),
          });
        }
      } else {
        // Contact is still present — email-based Phase 1 silently failed.
        // Remove by UUID (the canonical, reliable path).
        console.warn("[Unsubscribe] Resend email-based removal left contact in audience; using id-based fallback", {
          contactId: contact.id,
          email: redactEmail(email),
          ipHash: await hashIp(ip),
          ts: new Date().toISOString(),
        });
        try {
          await getResend().contacts.remove({ audienceId, id: contact.id });
          console.log("[Unsubscribe] Resend removal path: id-based fallback succeeded", {
            contactId: contact.id,
            email: redactEmail(email),
            ipHash: await hashIp(ip),
            ts: new Date().toISOString(),
          });
        } catch (removeErr) {
          console.error("[Unsubscribe] Resend id-based removal failed (non-fatal):", {
            error: removeErr instanceof Error ? removeErr.message : String(removeErr),
            contactId: contact.id,
            email: redactEmail(email),
            ipHash: await hashIp(ip),
            ts: new Date().toISOString(),
          });
        }
      }
    } catch (getErr) {
      // contacts.get() failed — we cannot verify whether Phase 1 worked.
      // Log and move on: MongoDB deletion is the source-of-truth success.
      console.error("[Unsubscribe] Resend contacts.get failed; cannot verify audience removal (non-fatal):", {
        error: getErr instanceof Error ? getErr.message : String(getErr),
        emailRemovalSucceeded,
        email: redactEmail(email),
        ipHash: await hashIp(ip),
        ts: new Date().toISOString(),
      });
    }
  }

  console.log("[Unsubscribe] Subscriber removed:", {
    email: redactEmail(email),
    ipHash: await hashIp(ip),
    ts: new Date().toISOString(),
  });

  // ── Confirm to the user ─────────────────────────────────────────────────
  //
  // Plain-text response — this is the POST response, not a page navigation
  // target a prefetcher would ever reach. The user already saw the HTML
  // confirmation page on GET; this is just the result of submitting it.

  return new NextResponse(
    "You have been successfully unsubscribed from Faulter emails.\n\n" +
      "You will not receive any further newsletter emails from us.\n\n" +
      "If you unsubscribed by mistake, you can re-subscribe at:\n" +
      // L-5 fix: use absoluteUrl() from lib/site.ts instead of raw
      // NEXT_PUBLIC_SITE_URL concatenation.  absoluteUrl() strips trailing
      // slashes and applies the same normalisation used everywhere else in
      // the codebase, so a malformed or trailing-slash env value no longer
      // produces a broken link in the success response.
      absoluteUrl("/subscribe"),
    {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        // Prevent caching — a stale 200 would mislead the user into thinking
        // they successfully unsubscribed when they hit a cached response.
        "Cache-Control": "no-store",
      },
    }
  );
}
