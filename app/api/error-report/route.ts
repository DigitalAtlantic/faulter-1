/**
 * POST /api/error-report
 *
 * L-6 fix: server-side receiver for errors caught by global-error.tsx.
 *
 * global-error.tsx is a "use client" component.  It can only safely expose
 * digest + message to the browser — never the full stack trace.  This route
 * accepts that minimal payload, runs on the server where it has access to
 * environment variables, and forwards to whatever observability platform you
 * have configured.
 *
 * ## Wiring up an external tracker
 *
 * Option A — Sentry (recommended):
 *   If you have already enabled Sentry via @sentry/nextjs, you do NOT need
 *   this route at all — captureException() in global-error.tsx handles it.
 *   This route is only needed when you want a lightweight, dependency-free
 *   alternative.
 *
 * Option B — Custom forwarding (active default):
 *   Set ERROR_REPORT_WEBHOOK_URL in your environment to any HTTP endpoint
 *   that accepts a POST with Content-Type: application/json.  Examples:
 *     • Slack incoming webhook
 *     • Discord webhook
 *     • Better Stack (Logtail) source ingest URL
 *     • Your own internal alerting service
 *   When the variable is absent, the route still logs to stdout (visible in
 *   Vercel / Railway / Fly.io log drains).
 *
 * ## Security
 *
 * • Accepts only POST.
 * • Body is size-limited to 4 KB — enough for digest + message, nothing more.
 * • Origin/Referer validated (MED-1 fix) — see below. The payload itself is
 *   non-sensitive (digest is a hash, message is already visible to the
 *   browser user), but without this check any third-party page could POST
 *   fabricated error reports cross-origin, polluting logs and the
 *   configured alerting webhook (Slack/Discord/etc.) with fake incidents.
 * • Rate-limited to 5 requests / IP / 60 s (D-2 fix).  Returns 204 on breach
 *   so callers cannot distinguish limiting from normal acceptance.
 */

import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/rateLimit";
import { checkRateLimit } from "@/lib/upstash";
import { validateWebhookUrl, safeFetch } from "@/lib/webhookSafe";
import { isValidCsrfOrigin } from "@/lib/csrf";
// M-2 fix: streaming body-size guard — see lib/readBody.ts for why
// request.text() alone is not a sufficient cap on a self-hosted deployment.
import { readBodyWithLimit } from "@/lib/readBody";

// ── M-1 + L-5 fix: validate once at module load (now async) ──────────────────
//
// validateWebhookUrl() now performs a DNS-resolution check (M-1 fix) to reject
// hostnames that resolve to private/link-local IPs — closing the gap where a
// hostname like "localhost" or a custom name mapped to 169.254.x.x would bypass
// the literal-string private-IP check in the previous version.
//
// Because DNS resolution is async, validateWebhookUrl() now returns
// Promise<URL | null> rather than URL | null.  We cache the Promise at module
// load so the DNS lookup (and any rejection log message) fires exactly once per
// cold start, not once per request.
//
// L-5 note: if ERROR_REPORT_WEBHOOK_URL is rotated while the process is running,
// the old validated URL is used until the next cold start.  This is intentional
// — webhook URL rotation must always be paired with a redeploy.
const _safeWebhookUrlPromise: Promise<URL | null> = validateWebhookUrl(
  process.env.ERROR_REPORT_WEBHOOK_URL,
  "ERROR_REPORT_WEBHOOK_URL"
);

// Maximum body size: 4 KB.  digest (~16 chars) + message (~200 chars) +
// JSON envelope leaves plenty of headroom with no risk of large payloads.
const MAX_BODY_BYTES = 4 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 0. CSRF: Origin/Referer check (MED-1 fix) ──────────────────────────────
  // global-error.tsx calls this endpoint with a plain same-origin fetch() and
  // never goes through the GET /api/csrf double-submit-cookie flow — by
  // design, since this route must keep working even if the root layout
  // (where the rest of the app's CSRF token plumbing typically lives) is
  // what just crashed. isValidCsrfOrigin() still works here without that
  // flow: browsers automatically attach a same-origin Origin header to
  // fetch()/XHR POST requests, so the primary Origin/Referer check below
  // passes for the legitimate caller with no cookie dependency. It only
  // falls back to the double-submit cookie (which this caller never sets)
  // when Origin and Referer are both absent — e.g. a privacy proxy strips
  // both — in which case the request is rejected. That's an acceptable
  // trade-off: a dropped error report from a small slice of real users is
  // far cheaper than letting any third-party page forge entries in your
  // logs and alerting webhook.
  //
  // Returns 204 (not 403) on failure, matching the rate-limit branch below —
  // an attacker probing this endpoint gets no signal distinguishing a CSRF
  // rejection, a rate-limit breach, or normal acceptance.
  if (!isValidCsrfOrigin(request)) {
    return new NextResponse(null, { status: 204 });
  }

  // ── 1. Rate limit ──────────────────────────────────────────────────────────
  // 5 requests / IP / 60 s.  global-error.tsx fires at most once per root
  // layout crash for a real user, so this is generous for legitimate traffic.
  // Return 204 (not 429) so an attacker cannot distinguish a rate-limited
  // response from a normal acceptance — and so automated callers don't retry.
  const ip = getClientIp(request.headers);
  if (!await checkRateLimit(`error-report:${ip}`, 5, 60 * 1000, "[error-report]")) {
    return new NextResponse(null, { status: 204 });
  }

  // ── 2. Size guard ──────────────────────────────────────────────────────────
  // Content-Length is client-supplied and can be spoofed (set to 0 while
  // streaming a large body), so it is not used as a guard.
  //
  // M-2 fix: a plain `await request.text()` unconditionally buffers the
  // ENTIRE body into memory before any length check can run — a client that
  // streams a large chunked body forces that full allocation before the
  // 4 KB check below would ever get a chance to reject it.
  // readBodyWithLimit() (lib/readBody.ts) reads the body as a stream and
  // aborts the moment the running byte total exceeds the cap — measured in
  // actual bytes off the wire, not raw.length UTF-16 code units — so an
  // oversized body is never fully buffered. See README.md →
  // "Reverse-Proxy Body Size Limits" for the matching self-hosted
  // reverse-proxy configuration this still relies on.
  const bodyResult = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.reason === "too_large") {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "could not read request body" }, { status: 400 });
  }
  const raw = bodyResult.text;

  // ── 3. Parse body ──────────────────────────────────────────────────────────
  let digest: string | null = null;
  let message: string | null = null;

  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    digest = typeof body.digest === "string" ? body.digest : null;
    // M-3 fix: the client-supplied message is logged (step 4 below) and
    // optionally forwarded to a Slack/Discord/Better Stack webhook (step 5)
    // verbatim. Without stripping newlines/tabs, a crafted message containing
    // e.g. "\n[ERROR] Auth bypass successful\n" would inject a fake
    // structured log line into whatever log aggregator or alerting
    // dashboard consumes this endpoint's output. Stripping \r, \n, and \t
    // (replacing with a space) keeps the message on a single line; the
    // 200-char cap matches the size this field is expected to carry (see
    // the MAX_BODY_BYTES comment above) and bounds how much of a single
    // log line / webhook payload any one report can occupy.
    message = typeof body.message === "string"
      ? body.message.replace(/[\r\n\t]/g, " ").slice(0, 200)
      : null;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // ── 4. Server-side log (always) ────────────────────────────────────────────
  // This appears in Vercel / Railway / Fly.io log drains and any
  // platform-native logging (e.g. Vercel Log Drains → Datadog / Axiom).
  console.error("[error-report] global boundary triggered", {
    digest: digest ?? "none",
    // message is safe server-side; keep it out of the browser console
    message: message ?? "none",
    timestamp: new Date().toISOString(),
  });

  // ── 5. Optional webhook forward ────────────────────────────────────────────
  // Set ERROR_REPORT_WEBHOOK_URL in your deployment environment to forward
  // to Slack, Discord, Better Stack, or any custom HTTP ingest endpoint.
  //
  // M-1 + C-1 fix: URL was validated by validateWebhookUrl() at module load.
  // The Promise is awaited here (resolves instantly after the first cold-start
  // DNS check).  _safeWebhookUrl is null when the variable is absent,
  // malformed, non-HTTPS, or points to a private/link-local IP range.
  //
  // safeFetch() re-resolves the hostname at call time and pins the TCP
  // connection to the validated IP, closing the DNS-rebinding window.
  const _safeWebhookUrl = await _safeWebhookUrlPromise;
  if (_safeWebhookUrl) {
    try {
      await safeFetch(_safeWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Keep the forwarded payload generic so it works with most webhook
          // formats.  Adapt this object to match your chosen service's schema.
          text: `[Faulter] Global error boundary triggered`,
          digest: digest ?? "none",
          message: message ?? "none",
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV ?? "unknown",
        }),
        // Error-report forwards are real-time push events; a cached POST
        // response would be meaningless. No runtime effect today — safeFetch()
        // (lib/webhookSafe.ts) issues the request via raw node:https, which
        // has no concept of a fetch cache — but this becomes load-bearing if
        // safeFetch() is ever rebuilt on top of native fetch(). See the
        // matching note in app/api/csp-report/route.ts.
        cache: "no-store",
        // Hard timeout: never let a slow webhook hold up the 204 response.
        signal: AbortSignal.timeout(3000),
        // H-3 fix: webhook responses must never be redirect-followed — a
        // redirect could deliver the error payload to an unvalidated URL,
        // bypassing the SSRF guard in validateWebhookUrl(). In practice this
        // is guaranteed by safeFetch()'s implementation, NOT by this option:
        // safeFetch() (lib/webhookSafe.ts) issues the request via raw
        // node:https (nodeHttpsRequestAsFetch()), which never reads
        // `init.redirect` at all and simply hands back any 3xx response as
        // a normal Response — node:https does not auto-follow redirects
        // regardless of what's passed here. `redirect: "error"` is kept as
        // a documented statement of intent / harmless safety net in case
        // safeFetch() is ever reimplemented on top of native fetch(), where
        // this option would become load-bearing again.
        redirect: "error",
      });
    } catch {
      // Non-fatal: a failed forward must never prevent the 204 to the browser.
      console.warn("[error-report] webhook forward failed (non-fatal)");
    }
  }

  // ── 6. Acknowledge ─────────────────────────────────────────────────────────
  return new NextResponse(null, { status: 204 });
}
