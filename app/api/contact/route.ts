import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { checkContactRateLimit, getClientIp, hashIp, redactEmail } from "@/lib/rateLimit";
import { isValidCsrfOrigin } from "@/lib/csrf";
import { checkForBot } from "@/lib/botDetection";
import { verifyTurnstileToken } from "@/lib/turnstile";
// Validates that RESEND_API_KEY, CONTACT_EMAIL, and RESEND_AUDIENCE_ID are
// present on first request — deferred so `next build` succeeds without secrets.
import { getEnv, isRealProduction } from "@/lib/env";
import { getDb } from "@/lib/db";
// H-2 fix: Upstash presence check so we can hard-fail in production rather than
// silently degrade.  hasUpstash() is cheap (cached after first call) and has
// no runtime side-effects.  See H-2 fix comment in the POST handler below.
import { hasUpstash } from "@/lib/upstash";
// M-2 fix: escapeHtml moved to lib/sanitize.ts so app/api/newsletter/route.ts
// can reuse the same implementation instead of re-deriving it locally.
import { escapeHtml, sanitizeText } from "@/lib/sanitize";
// M-2 fix: streaming body-size guard — see lib/readBody.ts for why
// request.text() alone is not a sufficient cap on a self-hosted deployment.
import { readBodyWithLimit } from "@/lib/readBody";

// ─── DB-3 PII / GDPR Retention ──────────────────────────────────────────────
// Contact submissions contain PII: name, email address, and free-text message.
// GDPR Article 17 (right to erasure) and Article 5(1)(e) (storage limitation)
// apply for any EU users.
//
// This is enforced at the DB layer via a TTL index (created by createIndexes()
// in lib/db.ts):
//   await db.collection("contact_submissions").createIndex(
//     { createdAt: 1 },
//     { expireAfterSeconds: 90 * 24 * 60 * 60 }   // 90 days
//   );
//
// MongoDB's TTL thread runs ~every 60 seconds and auto-purges expired documents
// with no application code required.
//
// For on-demand erasure requests (GDPR Art. 17), implement:
//   DELETE /api/admin/contact-submissions/:id
// protected by an admin-only auth check, logging all deletions with timestamp
// and the requestor's admin user ID.
//
// The Privacy Policy at /privacy already mentions data handling in general
// terms.  Before going live, add a specific statement:
//   "Contact form submissions are deleted after 90 days.  You may request
//    earlier deletion by emailing [address]."
// ────────────────────────────────────────────────────────────────────────────

// Instantiated lazily on the first request — not at module load — so that
// `next build` can run without production secrets present in the environment.
// getEnv() validates all required variables and throws a descriptive Error if
// any are missing, rather than letting Resend fail with an opaque 502.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(getEnv().RESEND_API_KEY);
  return _resend;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

// M-4 fix: sanitizeText is now imported from @/lib/sanitize (uses sanitize-html
// with a strict allowlist, much stronger than the previous regex stripper).
// Length caps are applied inline at the call site with .slice(0, maxLen).

/**
 * HTML-encode the five characters that are meaningful in HTML contexts.
 *
 * sanitizeText() strips tags, but after stripping, residual characters like
 * `&`, `<`, `>`, `"`, and `'` can still appear in the cleaned string (e.g.
 * the user typed "AT&T" or "1 < 2").  If those characters land verbatim in
 * the HTML email body they are technically valid — but we encode them anyway
 * so the email HTML is unambiguous and immune to any future mis-handling by
 * a mail client that re-parses the body as HTML.
 *
 * M-2 fix: implementation moved to lib/sanitize.ts (imported above) so
 * app/api/newsletter/route.ts can share it instead of re-deriving its own
 * copy. Kept this comment here since it explains *why* this route needs it.
 */

export async function POST(request: NextRequest) {
  // H-2 fix: Hard-fail in production if Upstash Redis is not configured.
  //
  // Without Upstash, the rate limiter falls back to an in-process Map.  On any
  // serverless or multi-replica deployment (Vercel, Netlify, Lambda, Fly.io)
  // each cold-start instance has its own isolated Map, so the "3 submissions
  // per IP per hour" limit is entirely per-instance and effectively unenforced:
  // a bot that spreads requests across 10 instances faces no practical limit.
  //
  // This guard converts the silent degradation into a visible 503 in production.
  // It fires on the first request to this endpoint after a misconfigured deploy,
  // making the problem impossible to miss in monitoring or manual testing — as
  // opposed to the previous behaviour where the route appeared healthy but
  // silently accepted unlimited submissions.
  //
  // Why 503 (Service Unavailable) rather than 500 (Internal Server Error)?
  //   503 signals a configuration / dependency problem rather than a bug.
  //   It is correct to retry after fixing the environment, and it is the
  //   appropriate status for "this service is intentionally not serving right now
  //   because a required backend is absent".  Returning 200 with spam going
  //   through is a worse outcome than a clear 503 that alerts the operator.
  //
  // Why NODE_ENV check?
  //   In local development the in-process Map is intentional — no Redis setup
  //   required locally.  The guard only applies in real production deployments,
  //   where serverless cold-starts make the Map fallback completely ineffective.
  //   The same NEXT_PUBLIC_SITE_URL heuristic used in middleware.ts and
  //   rateLimit.ts ("real production = NODE_ENV=production AND a non-localhost
  //   https:// site URL") distinguishes the two.
  // M-3 fix: use the single canonical isRealProduction() from lib/env.ts
  // rather than inlining the heuristic here.
  if (isRealProduction() && !hasUpstash()) {
    console.error(
      "[contact] MISCONFIGURATION: Upstash Redis is not configured.\n" +
      "  The contact rate limit (3 req/IP/hr) is ineffective on this deployment.\n" +
      "  Set UPSTASH_REDIS_REST_URL (https://) and UPSTASH_REDIS_REST_TOKEN\n" +
      "  in your deployment environment, then redeploy.\n" +
      "  Returning 503 until Upstash is configured."
    );
    return NextResponse.json(
      {
        error:
          "Service temporarily unavailable. " +
          "The contact form is not accepting submissions until a " +
          "required configuration issue is resolved.",
      },
      { status: 503, headers: { "Retry-After": "3600" } }
    );
  }

  // Content-Type validation: only accept JSON bodies.
  // Rejecting non-JSON requests prevents CSRF via form submission
  // (application/x-www-form-urlencoded or multipart/form-data) since
  // browsers can send those cross-origin without a preflight.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      { error: "Unsupported Media Type. Expected application/json." },
      { status: 415 }
    );
  }

  // Body size guard: stream the body and enforce a hard byte cap while
  // reading, rather than buffering the whole thing first.
  //
  // Content-Length is client-supplied and forgeable — an attacker can omit it
  // or set it to 0 while streaming a large body.  The previous check on the
  // header alone left a gap between the intended 12 KB limit and Next.js's
  // 4 MB default body parser limit.
  //
  // M-2 fix: request.text() unconditionally buffers the ENTIRE body into
  // memory before any length check can run — a client that streams a large
  // chunked body forces that full allocation before a 12 KB check would ever
  // get a chance to reject it. readBodyWithLimit() (lib/readBody.ts) reads
  // the body as a stream and aborts the moment the running byte total
  // exceeds the cap, so an oversized body is never fully buffered. See
  // README.md → "Reverse-Proxy Body Size Limits" for the matching
  // self-hosted reverse-proxy configuration this still relies on.
  //
  // 12 KB ceiling:
  //   name (200) + email (254) + subject (300) + message (5000) + overhead ≈ 6 KB
  //   12 KB gives 2× headroom while staying well below the framework default.
  const MAX_BODY_BYTES = 12_000;
  const bodyResult = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.reason === "too_large") {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const rawBody = bodyResult.text;

  // CSRF: reject requests that did not originate from our own site.
  // This blocks cross-origin form submissions from malicious third-party pages.
  if (!isValidCsrfOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden." },
      { status: 403 }
    );
  }

  const ip = getClientIp(request.headers);

  if (!await checkContactRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many submissions. Try again later." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  let body: {
    name?: unknown;
    email?: unknown;
    subject?: unknown;
    message?: unknown;
    /** Honeypot — must be absent or empty. Bots fill it; humans never see it. */
    _hp?: unknown;
    /** ISO timestamp set when the form first rendered, used for timing check. */
    _loadedAt?: unknown;
    /**
     * M-3 fix: Cloudflare Turnstile challenge response token.
     * The frontend Turnstile widget sets this after the invisible challenge
     * completes.  Verified server-side in lib/turnstile.ts.
     * Add the widget to the form:
     *   import { Turnstile } from "@marsidev/react-turnstile";
     *   <Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
     *              onSuccess={(t) => setTurnstileToken(t)}
     *              options={{ appearance: "execute" }} />
     * Then include `turnstileToken` in the POST body.
     */
    turnstileToken?: unknown;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // M-3 fix: Cloudflare Turnstile — stops headless-browser bots that pass
  // honeypot + timing checks by rendering the page and waiting MIN_HUMAN_MS.
  // Verification is skipped when TURNSTILE_SECRET_KEY is unset (local dev).
  // See lib/turnstile.ts for setup instructions.
  //
  // L-2 fix: Turnstile is verified BEFORE the honeypot/timing check below,
  // and its result is passed in as turnstileVerified. See the matching
  // comment in app/api/newsletter/route.ts and lib/botDetection.ts for the
  // full rationale — a slow invisible-challenge round trip should never
  // cause a real, Turnstile-verified human to be rejected by the timing
  // heuristic.
  // M-2 fix: pass a "contact" action label so verifyTurnstileToken() can
  // confirm (via Cloudflare's returned `action` field) that this token was
  // actually solved on the contact form's widget — and not, say, replayed
  // from the newsletter form, which shares the same Turnstile site key and
  // would otherwise be accepted here too within Cloudflare's token-validity
  // window. See the matching "contact"/"newsletter" action set on the
  // <Turnstile> widget in app/contact/page.tsx and lib/turnstile.ts for the
  // full mechanism.
  const turnstileResult = await verifyTurnstileToken(
    typeof body.turnstileToken === "string" ? body.turnstileToken : null,
    ip,
    "contact"
  );
  if (!turnstileResult.success) {
    console.warn("[Contact] Turnstile challenge failed:", {
      errorCodes: turnstileResult.errorCodes,
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Bot detection: honeypot, timing, and URL-density checks.
  // Return a generic 400 — do not tell bots which signal tripped.
  //
  // turnstileVerified requires both a successful Turnstile result AND an
  // actual token string in the body — see the matching comment in
  // app/api/newsletter/route.ts for why the local-dev fallback case must
  // NOT be treated as verified.
  const turnstileVerified =
    turnstileResult.success && typeof body.turnstileToken === "string";
  const botCheck = checkForBot(
    body._hp,
    body._loadedAt,
    [typeof body.message === "string" ? body.message : ""],
    turnstileVerified
  );
  if (!botCheck.ok) {
    console.warn("[Contact] Bot/spam submission rejected:", {
      reason: botCheck.reason,
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { name, email, subject, message } = body;

  // Server-side validation — never trust client-supplied values.
  if (!name || !email || !subject || !message) {
    return NextResponse.json(
      { error: "All fields are required." },
      { status: 400 }
    );
  }
  if (typeof email !== "string" || !isValidEmail(email)) {
    return NextResponse.json(
      { error: "Invalid email address." },
      { status: 400 }
    );
  }

  const safeName    = sanitizeText(typeof name === "string" ? name : "").slice(0, 200);
  const safeMessage = sanitizeText(typeof message === "string" ? message : "").slice(0, 5000);

  // M-3 fix: validate subject against the known allowlist of dropdown values.
  // The client renders a <select> so real users always send one of these
  // strings.  An API client (curl, Postman, bot) can send anything, but
  // there is no reason to accept free-text subjects — it would only appear
  // in the email subject line and potentially look confusing or be abused
  // for header injection if a future mail library handles it less carefully.
  // sanitizeText() still runs on the matched value as a belt-and-suspenders
  // measure against any future changes to the allowlist strings themselves.
  const VALID_SUBJECTS = new Set([
    "editorial", "tip", "correction", "advertising", "technical", "other",
  ]);
  const rawSubject = typeof subject === "string" ? subject.trim() : "";
  if (!VALID_SUBJECTS.has(rawSubject)) {
    return NextResponse.json(
      { error: "Invalid subject. Please select a subject from the list." },
      { status: 400 }
    );
  }
  const safeSubject = sanitizeText(rawSubject).slice(0, 300);

  if (safeName.length < 2) {
    return NextResponse.json(
      { error: "Name must be at least 2 characters." },
      { status: 400 }
    );
  }
  if (safeMessage.length < 10) {
    return NextResponse.json(
      { error: "Please provide a complete message (at least 10 characters)." },
      { status: 400 }
    );
  }

  // HTML-encode all user-supplied values before interpolating into the email
  // body.  sanitizeText() has already stripped tags, but characters like &, <,
  // >, ", and ' can still appear in the cleaned text (e.g. "AT&T", "x < y").
  const htmlName    = escapeHtml(safeName);
  const htmlEmail   = escapeHtml(email);
  const htmlMessage = escapeHtml(safeMessage).replace(/\n/g, "<br>");

  // ── DB-3: Persist submission to MongoDB (PII-aware, TTL-purged) ───────────
  //
  // The contact_submissions collection has a TTL index on createdAt (90 days),
  // created by createIndexes() in lib/db.ts.  MongoDB auto-purges documents
  // after 90 days, satisfying GDPR Article 5(1)(e) (storage limitation).
  //
  // We persist BEFORE calling Resend so that:
  //   1. A Resend failure does not lose the submission.
  //   2. There is an audit trail for erasure requests (GDPR Art. 17).
  //
  // If DATABASE_URL is not set, getDb() throws and the catch below returns
  // a 502.  The email is not sent in this case — we prefer a visible error
  // over silently losing the submission record.

  let submissionId: string | undefined;
  try {
    const db = await getDb();
    const result = await db.collection("contact_submissions").insertOne({
      name: safeName,
      email: email.toLowerCase(), // normalised — erasure queries must match reliably (GDPR Art. 17)
      subject: safeSubject,
      message: safeMessage,
      ipHash: await hashIp(ip),
      createdAt: new Date(), // TTL index operates on this field
    });
    submissionId = result.insertedId.toString();
  } catch (err) {
    console.error("[Contact] DB insert failed:", {
      error: err instanceof Error ? err.message : String(err),
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: "Failed to send message. Please try again later." },
      { status: 502 }
    );
  }

  // ── Resend: deliver the submission by email ────────────────────────────────

  // M-1 fix: explicitly strip CR/LF/tab before using the user-supplied email
  // as the Reply-To header value, rather than relying solely on isValidEmail()'s
  // regex to reject header-injection characters.
  //
  // isValidEmail() already rejects whitespace (including \r and \n) via its
  // [^\s@]+ pattern, and the Resend SDK applies its own encoding — so this is
  // not exploitable today. But the protection here is implicit: it depends
  // entirely on that regex never being loosened (e.g. to permit RFC 5321
  // quoted-string local parts) and on Resend's internal handling of malformed
  // addresses, neither of which this codebase controls or can audit. An
  // explicit strip makes the defence unconditional and obvious to future
  // readers, regardless of how the regex or the Resend SDK evolve.
  //
  // The strip also covers \t (horizontal tab): RFC 2822 §3.2.3 classifies
  // tab as "folded whitespace" in header field bodies, and some legacy
  // MTA/MUA implementations treat a bare \t as a header-line continuation
  // character — the same injection vector as \r\n, just via a different
  // whitespace-folding path in older parsers.
  const safeReplyTo = email.replace(/[\r\n\t]/g, "");

  try {
    await getResend().emails.send({
      // D-5: sender address is read from RESEND_FROM_EMAIL so the verified
      // domain in Resend matches the live deployment domain.  A hardcoded
      // address causes silent domain_not_verified failures if the live domain
      // differs from what was baked in at write time.
      from: getEnv().RESEND_FROM_EMAIL,
      to: getEnv().CONTACT_EMAIL,
      replyTo: safeReplyTo,
      subject: `[Contact] ${safeSubject}`,
      text: `From: ${safeName} <${email}>\n\n${safeMessage}`,
      html: `<p><strong>From:</strong> ${htmlName} &lt;${htmlEmail}&gt;</p><p>${htmlMessage}</p>`,
    });
  } catch (err) {
    // Log internally but return a generic error to the client — never expose
    // Resend error details (which can include API keys, endpoint URLs, or
    // internal message IDs) in the response body.
    //
    // The submission is already in MongoDB (submissionId above), so the data
    // is not lost — it can be resent manually from the DB if needed.
    console.error("[Contact] Resend delivery failed:", {
      error: err instanceof Error ? err.message : String(err),
      submissionId,
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: "Failed to send message. Please try again later." },
      { status: 502 }
    );
  }

  console.log("[Contact] Message sent", {
    name: safeName,
    email: redactEmail(email),
    subject: safeSubject,
    submissionId,
    ipHash: await hashIp(ip),
    ts: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}
