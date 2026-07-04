import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { checkNewsletterRateLimit, getClientIp, hashIp, redactEmail } from "@/lib/rateLimit";
import { isValidCsrfOrigin } from "@/lib/csrf";
import { checkForBot } from "@/lib/botDetection";
import { verifyTurnstileToken } from "@/lib/turnstile";
// Validates that RESEND_API_KEY, CONTACT_EMAIL, and RESEND_AUDIENCE_ID are
// present on first request — deferred so `next build` succeeds without secrets.
import { getEnv, isRealProduction } from "@/lib/env";
import { getDb } from "@/lib/db";
import { buildUnsubscribeLink } from "@/lib/unsubscribe";
import { siteUrl } from "@/lib/site";
// H-2 fix: Upstash presence check so we can hard-fail in production rather than
// silently degrade.  hasUpstash() is cheap (cached after first call) and has
// no runtime side-effects.  See H-2 fix comment in the POST handler below.
import { hasUpstash } from "@/lib/upstash";
// M-2 fix: POSTAL_ADDRESS is operator-supplied (env var), not user-supplied,
// but it is still concatenated directly into raw HTML below. An address with
// `<` or `>` (e.g. a suite number pasted from a CRM export) would otherwise
// produce malformed HTML in the welcome email. escapeHtml() is the same
// helper app/api/contact/route.ts uses for user-submitted fields, now shared
// from lib/sanitize.ts.
import { escapeHtml } from "@/lib/sanitize";
// M-2 fix: streaming body-size guard — see lib/readBody.ts for why
// request.text() alone is not a sufficient cap on a self-hosted deployment.
import { readBodyWithLimit } from "@/lib/readBody";

// ---------------------------------------------------------------------------
// DB-2: Duplicate-key error helper
// ---------------------------------------------------------------------------

/**
 * Returns true if `err` is a MongoDB duplicate-key error (code 11000).
 * Written without importing MongoServerError so this file does not pull in
 * the full driver type tree.
 */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 11000
  );
}

// ---------------------------------------------------------------------------
// Resend client (lazy singleton)
// ---------------------------------------------------------------------------

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

export async function POST(request: NextRequest) {
  // H-2 fix: Hard-fail in production if Upstash Redis is not configured.
  //
  // Without Upstash, the rate limiter falls back to an in-process Map that does
  // NOT share state across serverless instances.  A bot splitting requests across
  // Vercel function instances sees no effective "3 req/IP/hr" limit at all,
  // enabling newsletter subscription spam and Resend cost inflation.
  //
  // This guard converts the silent failure into a visible 503 in production
  // deployments (identified by NODE_ENV=production + a non-localhost https:// site
  // URL).  Local development with the in-process Map fallback is unaffected.
  // See the parallel guard in /api/contact/route.ts for full commentary.
  // M-3 fix: use the single canonical isRealProduction() from lib/env.ts
  // rather than inlining the heuristic here.
  if (isRealProduction() && !hasUpstash()) {
    console.error(
      "[newsletter] MISCONFIGURATION: Upstash Redis is not configured.\n" +
      "  The newsletter rate limit (3 req/IP/hr) is ineffective on this deployment.\n" +
      "  Set UPSTASH_REDIS_REST_URL (https://) and UPSTASH_REDIS_REST_TOKEN\n" +
      "  in your deployment environment, then redeploy.\n" +
      "  Returning 503 until Upstash is configured."
    );
    return NextResponse.json(
      {
        error:
          "Service temporarily unavailable. " +
          "Newsletter sign-up is not accepting submissions until a " +
          "required configuration issue is resolved.",
      },
      { status: 503, headers: { "Retry-After": "3600" } }
    );
  }

  // Content-Type validation: only accept JSON bodies.
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
  // The newsletter form only submits an email + two bot-check fields; 12 KB
  // is a generous ceiling with no legitimate use case near the limit.
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
  if (!isValidCsrfOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden." },
      { status: 403 }
    );
  }

  const ip = getClientIp(request.headers);

  if (!await checkNewsletterRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  let body: {
    email?: string;
    /** Honeypot — must be absent or empty. Bots fill it; humans never see it. */
    _hp?: unknown;
    /** ISO timestamp set when the form first rendered, used for timing check. */
    _loadedAt?: unknown;
    /**
     * M-3 fix: Cloudflare Turnstile challenge response token.
     * See lib/turnstile.ts and app/api/contact/route.ts for setup instructions.
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
  // See lib/turnstile.ts for full setup instructions.
  //
  // L-2 fix: Turnstile is verified BEFORE the honeypot/timing check below,
  // and its result is passed in as turnstileVerified. Turnstile's invisible
  // challenge can itself add latency before the client ever submits, so
  // checking timing first (as before) risked rejecting a legitimately slow
  // — but Turnstile-verified — submission. checkForBot() now skips its
  // timing-floor rejection whenever turnstileVerified is true, since a valid
  // Turnstile pass is strictly stronger proof of humanity than the heuristic.
  // M-2 fix: pass a "newsletter" action label so verifyTurnstileToken() can
  // confirm (via Cloudflare's returned `action` field) that this token was
  // actually solved on a newsletter widget — and not, say, replayed from the
  // contact form, which shares the same Turnstile site key and would
  // otherwise be accepted here too within Cloudflare's token-validity
  // window. See the matching "newsletter" action set on the <Turnstile>
  // widgets in components/ui/NewsletterSignup.tsx, components/layout/
  // FooterNewsletter.tsx, and app/subscribe/page.tsx, and lib/turnstile.ts
  // for the full mechanism.
  const turnstileResult = await verifyTurnstileToken(
    typeof body.turnstileToken === "string" ? body.turnstileToken : null,
    ip,
    "newsletter"
  );
  if (!turnstileResult.success) {
    console.warn("[Newsletter] Turnstile challenge failed:", {
      errorCodes: turnstileResult.errorCodes,
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Bot detection: honeypot and timing checks.
  // Return a generic 400 — do not tell bots which signal tripped.
  //
  // turnstileVerified requires both a successful Turnstile result AND an
  // actual token string in the body — verifyTurnstileToken() also returns
  // { success: true } as its local-dev fallback when TURNSTILE_SECRET_KEY is
  // unset, in which case there is no real token and the timing check should
  // still apply exactly as it did before this fix.
  const turnstileVerified =
    turnstileResult.success && typeof body.turnstileToken === "string";
  const botCheck = checkForBot(
    body._hp,
    body._loadedAt,
    [],
    turnstileVerified
  );
  if (!botCheck.ok) {
    console.warn("[Newsletter] Bot/spam submission rejected:", {
      reason: botCheck.reason,
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  // ── DB-2: Persist subscriber to MongoDB before calling Resend ─────────────
  //
  // MongoDB is the source of truth for subscriptions.  Resend is the delivery
  // mechanism only.  This order means:
  //   1. We have a local record even if Resend is temporarily down.
  //   2. The unique index on subscribers.email (case-insensitive, strength: 2)
  //      is the deduplication safety net — atomic at the DB layer, not in
  //      application code where a race window would exist.
  //
  // On duplicate-key error (code 11000) we return a 200-like success response
  // to avoid confirming whether an email is already subscribed (email
  // enumeration mitigation).  Resend is not called in this case.
  //
  // If DATABASE_URL is not set, getDb() throws with a descriptive message
  // and the catch below returns a 502.  Set DATABASE_URL before going live
  // (see .env.example).

  try {
    const db = await getDb();
    await db.collection("subscribers").insertOne({
      email: email.toLowerCase(), // normalise for consistent storage
      createdAt: new Date(),
      source: "newsletter_form",
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Already subscribed — return success without calling Resend again.
      // Do not reveal the duplicate to avoid email enumeration.
      console.log("[Newsletter] Duplicate subscriber (no-op)", {
        email: redactEmail(email),
        ipHash: await hashIp(ip),
        ts: new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    }

    // Any other DB error: log internally and return a generic 502.
    // Do not call Resend — if DB persistence failed, we have no local record.
    console.error("[Newsletter] DB insert failed:", {
      error: err instanceof Error ? err.message : String(err),
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: "Failed to subscribe. Please try again later." },
      { status: 502 }
    );
  }

  // ── Resend: add to audience for email delivery ─────────────────────────────
  //
  // Called after the DB write succeeds.  A Resend failure at this point means
  // the subscriber is in our DB but may not receive the welcome email.
  // We log the failure for follow-up but return success to the client — the
  // subscription itself succeeded at the data layer.

  try {
    await getResend().contacts.create({
      // M-6 fix: normalise to lowercase so Resend audience casing matches
      // MongoDB (which stores email.toLowerCase()).  Using the original-casing
      // `email` here would create a Resend contact with a different case from
      // the DB record, causing audience duplication if the same address is
      // re-submitted with different casing.
      email: email.toLowerCase(),
      audienceId: getEnv().RESEND_AUDIENCE_ID,
    });
  } catch (err) {
    // Log internally but do NOT return early — the subscriber is persisted in
    // MongoDB and we still need to send the welcome email with the unsubscribe
    // link below.  Returning here would leave new subscribers without their
    // CAN-SPAM / GDPR Art. 17 unsubscribe mechanism whenever the Resend
    // audience API has a transient failure.  Resend contact creation can be
    // retried out-of-band; the welcome email send is the compliance-critical step.
    console.error("[Newsletter] Resend contact creation failed:", {
      error: err instanceof Error ? err.message : String(err),
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
  }

  console.log("[Newsletter] New subscriber", {
    email: redactEmail(email),
    ipHash: await hashIp(ip),
    ts: new Date().toISOString(),
  });

  // H-9 fix: send welcome email with unsubscribe link.
  //
  // CAN-SPAM requires a functional unsubscribe mechanism in every commercial
  // email.  GDPR Article 17 (right to erasure) requires an easy unsubscribe
  // path for EU subscribers.  This is the first email we send, so it must
  // carry the link.
  //
  // buildUnsubscribeLink() resolves the link domain from `siteUrl`
  // (lib/site.ts), a single build-time-inlined value from
  // NEXT_PUBLIC_SITE_URL. HIGH-1 correction: this is NOT re-resolved per
  // request/deployment-environment the way an earlier comment here claimed —
  // see the full explanation in lib/unsubscribe.ts.
  //
  // A failure here is non-fatal: the subscription already succeeded at both
  // the DB layer and in the Resend audience.  We log the failure and return
  // success — the subscriber is subscribed, just without a welcome email.
  // A follow-up job can re-send welcome emails to subscribers missing one.
  try {
    const unsubscribeLink = await buildUnsubscribeLink(email);
    const env = getEnv();
    // HIGH-1 correction: use the shared, trailing-slash-stripped `siteUrl`
    // instead of re-reading process.env.NEXT_PUBLIC_SITE_URL directly —
    // both resolve to the identical build-time value, so the direct read
    // provided no benefit and risked a malformed URL if the env var had a
    // trailing slash.
    const siteOrigin = siteUrl;
    const siteName = siteOrigin
      ? new URL(siteOrigin).hostname
      : "Faulter";
    await getResend().emails.send({
      from: env.RESEND_FROM_EMAIL,
      // M-6 fix: normalise to lowercase so the envelope address matches
      // MongoDB and the Resend contact record.  The recipient's MTA preserves
      // display casing for the inbox — lowercasing the to: field here has no
      // visible effect on delivery or display, but keeps all three systems
      // (MongoDB, Resend audience, outbound envelope) consistent.
      to: email.toLowerCase(),
      subject: `Welcome to ${siteName}`,
      html: [
        "<p>Thanks for subscribing! You'll receive our latest stories directly in your inbox.</p>",
        // M-4 fix: CAN-SPAM Act §7704(a)(5) requires every commercial email to
        // include the sender's valid physical postal address.  §7704(a)(1) requires
        // clear identification that the message is an advertisement or solicitation
        // when it contains promotional content.  Omitting either can result in
        // per-email fines for US recipients.
        //
        // The unsubscribe link satisfies §7704(a)(3) (functional opt-out mechanism)
        // and §7704(a)(4) (notice of opt-out right).  The postal address below
        // satisfies §7704(a)(5).
        //
        // ⚠️  BEFORE LAUNCH: replace the placeholder address below with your
        // publisher's actual registered mailing address (P.O. box is acceptable
        // under CAN-SPAM).  A placeholder address does not satisfy the statute.
        "<hr style=\"border:none;border-top:1px solid #e5e7eb;margin:24px 0\">",
        "<p style=\"font-size:12px;color:#6b7280;line-height:1.6\">",
        "You are receiving this email because you subscribed to Faulter News.<br>",
        "If you ever want to stop receiving emails, ",
        `<a href="${unsubscribeLink}" style="color:#6b7280">unsubscribe here</a>.<br><br>`,
        // CAN-SPAM §7704(a)(5) — valid physical postal address (required in
        // every commercial email sent to US recipients).  The value is read
        // from the POSTAL_ADDRESS environment variable so the same codebase
        // works for any publisher and the address can be updated without
        // redeploying.  getEnv() throws at request time if the variable is
        // absent — the welcome email send is skipped and the subscription is
        // still recorded (see the outer try/catch).  A P.O. box is acceptable.
        //
        // M-2 fix: escapeHtml() applied. POSTAL_ADDRESS is operator-configured,
        // not attacker-controlled, but it is still free text concatenated
        // directly into raw HTML — an address containing `<` or `>` (e.g. a
        // suite number copied from a CRM export) would otherwise produce
        // malformed markup in the welcome email, or in the worst case let an
        // operator typo/paste inject arbitrary HTML into the email body.
        escapeHtml(env.POSTAL_ADDRESS),
        "</p>",
      ].join(""),
      text: [
        "Thanks for subscribing! You'll receive our latest stories directly in your inbox.",
        "",
        "---",
        "You are receiving this email because you subscribed to Faulter News.",
        `To unsubscribe at any time, visit: ${unsubscribeLink}`,
        "",
        // CAN-SPAM §7704(a)(5) — physical postal address (required).
        // M-2 note: NOT escaped here — this is the plain-text part of the
        // email (no HTML rendering involved), so HTML-entity-encoding would
        // incorrectly alter the address as displayed (e.g. turning "&" into
        // the literal characters "&amp;" in a plain-text reader).
        env.POSTAL_ADDRESS,
      ].join("\n"),
    });
  } catch (err) {
    // Non-fatal — subscription is persisted; welcome email can be retried.
    console.error("[Newsletter] Welcome email send failed:", {
      error: err instanceof Error ? err.message : String(err),
      ipHash: await hashIp(ip),
      ts: new Date().toISOString(),
    });
  }

  return NextResponse.json({ success: true });
}
