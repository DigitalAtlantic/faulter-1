import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { checkRateLimitCspReport, checkRateLimitCspReportForward, getClientIp, hashIp } from "@/lib/rateLimit";
import { validateWebhookUrl, safeFetch } from "@/lib/webhookSafe";
// M-2 fix: streaming body-size guard — see lib/readBody.ts for why
// request.text() alone is not a sufficient cap on a self-hosted deployment.
import { readBodyWithLimit } from "@/lib/readBody";

/**
 * POST /api/csp-report
 *
 * Receives Content Security Policy violation reports from browsers and logs
 * them server-side.  Referenced by the `report-uri /api/csp-report` directive
 * in the production CSP (middleware.ts).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Without a report endpoint, CSP violations are silently swallowed by the
 * browser.  That means:
 *   • Injection attempts (XSS probes) go completely undetected.
 *   • Legitimate breakage from a new Next.js version or third-party script
 *     injecting an inline tag silently blocks functionality for users.
 *
 * This endpoint makes both visible in your deployment platform's log stream
 * immediately after they occur.
 *
 * ── Security design ──────────────────────────────────────────────────────────
 * The endpoint is intentionally minimal and safe:
 *
 *   1. Rate-limited (10 reports / IP / minute) so it cannot be used to flood
 *      application logs.  Browsers batch and throttle CSP reports natively, so
 *      10/min is generous for any real browser and tight for a log-flood bot.
 *
 *   2. Only `application/csp-report` bodies are accepted.  Any other
 *      Content-Type is rejected with 415 before the body is read.
 *
 *   3. Body size is capped at 8 KB before parsing.  A real CSP report is
 *      typically under 1 KB; 8 KB gives headroom while blocking oversized
 *      payloads that could cause memory pressure.
 *
 *   4. Only a safe subset of the report fields is logged — never the full raw
 *      body, which could contain user-entered text from the page (e.g. a
 *      blocked inline handler containing form input).
 *
 *   5. The IP is hashed before logging (same pattern as contact / newsletter
 *      routes) so no PII is written to the log stream.
 *
 *   6. The response is always 204 No Content — browsers do not retry on 2xx,
 *      and there is nothing useful to return.
 *
 * ── M-3 fix: external forwarding before per-IP rate-limit drops ─────────────
 * PROBLEM: The per-IP rate limit (10/min) caps local log writes correctly for
 * bots, but CSP report IPs are the browsers of real end-users — not the
 * attacker's IP.  A widespread XSS probe that loads a malicious script on many
 * users' browsers can generate a burst of reports from many different IPs,
 * each within their own 10/min window.  However, if a single user's browser
 * sends more than 10 reports/min (e.g. a page that loops and re-triggers a
 * violation), legitimate reports after the 11th will be silently dropped from
 * local logs.
 *
 * To ensure NO valid report is ever lost even if local logging is throttled,
 * this endpoint forwards the raw report body to an external CSP reporting
 * service BEFORE the per-IP rate-limit check.  External forwarding is:
 *   • Non-blocking on the critical path — the 204 response is sent without
 *     waiting for the forward to complete.
 *   • Kept alive via waitUntil() (@vercel/functions, M-2 fix) so the forward
 *     still completes on Vercel even after the response has been sent —
 *     see forwardToExternalReporter() below for details.
 *   • Non-blocking — a failed forward never prevents a 204 response.
 *   • Gated on CSP_REPORT_URI being set — if absent, only local logging runs.
 *
 * ── Issue #3 fix: global forward rate limit ───────────────────────────────
 * PROBLEM: Forwarding before the per-IP check created an amplification path —
 * a distributed attacker with N IPs could drive 10N unchecked outbound
 * fetch() calls/min to the external reporter (DoS / bandwidth exhaustion).
 *
 * FIX: checkRateLimitCspReportForward() (lib/rateLimit.ts) uses a single
 * shared key to cap total outbound forwards at 500/min site-wide, regardless
 * of source-IP count.  Forwarding only proceeds when that global budget allows.
 * Local logging continues below under the existing per-IP limiter.
 *
 * To enable external forwarding:
 *   1. Create a free account at https://report-uri.com (or use Sentry, etc.)
 *   2. Copy your CSP report URI from the dashboard.
 *   3. Add to your deployment environment:
 *        CSP_REPORT_URI=https://xxxx.report-uri.com/r/d/csp/enforce
 *
 * When CSP_REPORT_URI is set:
 *   • Every well-formed report is forwarded externally before rate-limit.
 *   • Local logging continues unchanged after the rate-limit check.
 *   • The external service retains the full report history regardless of
 *     how many local log writes are throttled.
 *
 * When CSP_REPORT_URI is unset (default / local dev):
 *   • No external forwarding occurs — same behaviour as before this fix.
 *   • Local logging with rate-limiting continues to work as before.
 *
 * ── Report shape (browser-sent) ──────────────────────────────────────────────
 * Browsers POST a JSON body shaped like:
 *   {
 *     "csp-report": {
 *       "document-uri": "https://faulter.news/news/...",
 *       "violated-directive": "script-src",
 *       "blocked-uri": "https://evil.com/xss.js",
 *       "original-policy": "...",
 *       "effective-directive": "script-src",
 *       "source-file": "https://...",
 *       "line-number": 42,
 *       "column-number": 7,
 *       "status-code": 200
 *     }
 *   }
 *
 * ── Interpreting the logs ─────────────────────────────────────────────────────
 * A single report for "eval" or "inline" on a new deploy usually means a
 * Next.js upgrade injected a new inline script pattern — check whether the
 * Next.js version changed and whether the new pattern needs an additional
 * CSP allowance in middleware.ts.
 *
 * Repeated reports for an external `blocked-uri` (not 'self', 'inline', or
 * 'eval') are a signal of an active injection attempt and should be
 * investigated immediately.
 *
 * ── Future hardening ─────────────────────────────────────────────────────────
 * The `report-to` directive (paired with a `Reporting-Endpoints` header) is
 * the modern successor to `report-uri` and supports batching — add it once
 * browser support is sufficient for your audience.
 */

/** Maximum accepted body size in bytes.
 *  Real single CSP reports are < 1 KB; the Reporting API may batch several
 *  reports in one POST, so 16 KB gives headroom while blocking oversized
 *  payloads that could cause memory pressure.
 */
const MAX_BODY_BYTES = 16_384;

/**
 * M-3 fix: Forward the raw report body to an external CSP reporting service
 * (e.g. Report URI, Sentry) BEFORE the per-IP rate-limit check.
 *
 * This ensures no valid report is ever silently lost when local logging is
 * throttled — critical because CSP report IPs are end-user browsers, not the
 * attacker, so a single user's browser can exceed 10/min if a page repeatedly
 * triggers the same violation.
 *
 * C-1 fix: The URL is now validated by validateWebhookUrl() before fetch().
 * This enforces https:// (no cleartext transmission of violation details) and
 * blocks private/link-local IP ranges (SSRF guard).  A null return means the
 * variable is absent, malformed, non-HTTPS, or a private IP — all of which
 * mean "skip the forward".
 *
 * Implementation notes:
 *  - Fire-and-forget (not awaited) so it never blocks the 204 response.
 *  - Errors are silently swallowed — a failed forward must never prevent the
 *    204 from being returned (browsers retry on 5xx).
 *  - Only runs when CSP_REPORT_URI is set in the environment.
 *  - The raw body text is forwarded as-is; the external service receives the
 *    same payload the browser sent.
 */

// M-1 + C-1 fix: validate once at module load (now async — DNS resolution).
// validateWebhookUrl() now performs a DNS lookup to reject hostnames that
// resolve to private/link-local IPs (e.g. "localhost" → 127.0.0.1).
// The Promise is cached so the DNS lookup fires exactly once per cold start.
const _safeReportUrlPromise: Promise<URL | null> = validateWebhookUrl(
  process.env.CSP_REPORT_URI,
  "CSP_REPORT_URI"
);

async function forwardToExternalReporter(rawBody: string): Promise<void> {
  // Await the cached validation promise — resolves instantly after cold start.
  const _safeReportUrl = await _safeReportUrlPromise;
  if (!_safeReportUrl) return;

  // M-2 fix (resolved): the forward is now wrapped in waitUntil() from
  // @vercel/functions, so Vercel keeps the function instance alive until the
  // fetch settles even though the 204 response has already been sent to the
  // browser. Previously this fetch() was purely fire-and-forget; on
  // Vercel/Lambda the process could be frozen immediately after the response
  // was sent, silently dropping an in-flight request before its first byte —
  // breaking the "no valid report is ever lost" guarantee documented above.
  //
  // waitUntil() is a no-op outside the Vercel runtime (e.g. local `next dev`,
  // other hosts), so this is safe everywhere — it just doesn't extend
  // anything off Vercel, where the process generally isn't frozen mid-request
  // anyway.
  //
  // Note this only guarantees the request is *sent*; an external reporting
  // service that is itself slow or down still relies on the 3 s timeout below
  // and the swallowed .catch(). For zero server-side dependency, Option A is
  // still worth considering: configure both report-uri and report-to in the
  // CSP so the browser posts directly to the external service.
  //
  // M-1 fix: safeFetch() re-resolves the hostname at call time and pins the
  // TCP connection to the validated IP via a custom https.Agent lookup
  // override — closing the DNS-rebinding window between module load and the
  // actual request.
  const forwardPromise = safeFetch(_safeReportUrl, {
    method: "POST",
    headers: { "Content-Type": "application/csp-report" },
    body: rawBody,
    // CSP reports are real-time push events; a cached POST response would be
    // meaningless. No runtime effect today — safeFetch() (lib/webhookSafe.ts)
    // issues the request via raw node:https, which has no concept of a
    // fetch cache — but this becomes load-bearing if safeFetch() is ever
    // rebuilt on top of native fetch(). See the matching note in
    // app/api/error-report/route.ts.
    cache: "no-store",
    // M-2 fix: hard timeout so a slow or unresponsive reporting endpoint never
    // holds a reference that delays GC or consumes a connection-pool slot
    // indefinitely.  error-report/route.ts already applies this; parity here
    // closes the gap.  3 s matches the error-report route's timeout.
    signal: AbortSignal.timeout(3000),
    // H-3 fix: a reporting endpoint should never redirect a POST; following
    // one could silently exfiltrate the report body to an unvalidated
    // destination, bypassing the SSRF guard in validateWebhookUrl(). In
    // practice this is guaranteed by safeFetch()'s implementation, NOT by
    // this option: safeFetch() (lib/webhookSafe.ts) issues the request via
    // raw node:https (nodeHttpsRequestAsFetch()), which never reads
    // `init.redirect` at all and simply hands back any 3xx response as a
    // normal Response — node:https does not auto-follow redirects
    // regardless of what's passed here. `redirect: "error"` is kept as a
    // documented statement of intent / harmless safety net in case
    // safeFetch() is ever reimplemented on top of native fetch(), where
    // this option would become load-bearing again. See the matching note
    // in app/api/error-report/route.ts.
    redirect: "error",
  }).catch(() => {
    // Swallow all errors — a failed external forward must never surface
    // as a 5xx to the browser (which would trigger a retry storm).
  });

  waitUntil(forwardPromise);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Accept both the legacy CSP report content type and the modern Reporting API
  // batch content type sent by Chromium/Edge when `report-to` is configured.
  //
  // M-4 fix: middleware.ts enables `report-to csp-endpoint` which causes modern
  // Chromium/Edge browsers to use the Reporting API (application/reports+json)
  // instead of the legacy report-uri path (application/csp-report).  Without
  // accepting both types, Reporting API posts are rejected with 415 and CSP
  // violation reporting silently stops working for those browsers.
  //
  // Content types:
  //   application/csp-report     — legacy format (Firefox, older browsers)
  //   application/reports+json   — Reporting API batch envelope (modern Chromium/Edge)
  const ct = request.headers.get("content-type") ?? "";
  const isLegacyCsp = ct.includes("application/csp-report");
  const isReportingApi = ct.includes("application/reports+json");
  if (!isLegacyCsp && !isReportingApi) {
    return new NextResponse(null, { status: 415 });
  }

  // Body-size cap — enforced while streaming the body, not via Content-Length.
  //
  // Relying on the Content-Length header as the primary guard is unreliable:
  //   • Chunked-encoded requests carry no Content-Length at all (the header is
  //     absent or "0"), so a pre-read check on it silently passes for chunked
  //     bodies regardless of their actual size.
  //   • Even when present, Content-Length is client-supplied and forgeable —
  //     an attacker can send a small header value then stream a large body.
  //
  // M-2 fix: a plain `await request.text()` unconditionally buffers the
  // ENTIRE body into memory before any length check can run — a client that
  // streams a large chunked body forces that full allocation before the
  // 16 KB check below would ever get a chance to reject it.
  // readBodyWithLimit() (lib/readBody.ts) reads the body as a stream and
  // aborts the moment the running byte total exceeds the cap, so an
  // oversized body is never fully buffered. See README.md →
  // "Reverse-Proxy Body Size Limits" for the matching self-hosted
  // reverse-proxy configuration this still relies on.
  //
  // Real CSP reports are < 1 KB; the Reporting API may batch multiple reports
  // so 16 KB gives headroom while rejecting oversized payloads.
  const bodyResult = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.reason === "too_large") {
      return new NextResponse(null, { status: 413 });
    }
    return new NextResponse(null, { status: 204 });
  }
  const text = bodyResult.text;

  // Issue #3 fix: Gate external forwarding behind a global (IP-independent)
  // rate limiter BEFORE calling forwardToExternalReporter().
  //
  // M-3 fix rationale (preserved): forwarding runs before the per-IP local
  // log limiter so no valid report is silently lost when a single browser
  // exceeds 10/min.  However, that design creates an amplification path: a
  // distributed attacker controlling N IPs can each contribute up to 10
  // reports/min, generating 10N unchecked outbound fetch() calls per minute
  // to the external reporter — a DoS against the reporting service or a
  // bandwidth exhaustion attack.
  //
  // checkRateLimitCspReportForward() uses a single shared key
  // (`csp-report-forward:global`) to bound total outbound forwards at
  // 500/min site-wide, regardless of how many source IPs are involved.
  //
  // On false (global budget exhausted): skip the external forward.  Local
  // logging continues below, gated by the per-IP limiter as before.
  // On true: forward proceeds as before.
  if (await checkRateLimitCspReportForward()) {
    forwardToExternalReporter(text).catch(() => {
      // forwardToExternalReporter is fire-and-forget; swallow any rejection
      // so an unhandled Promise rejection doesn't crash the handler.
    });
  }

  // Rate limit — applied to LOCAL logging only (after external forward).
  // Return 204 even on rate-limit breach: browsers retry on 4xx/5xx, which
  // would amplify the very flood we are trying to stop.
  const ip = getClientIp(request.headers);
  if (!await checkRateLimitCspReport(ip)) {
    return new NextResponse(null, { status: 204 });
  }

  // Parse the report body.  The two content types use different shapes:
  //
  //   application/csp-report (legacy):
  //     { "csp-report": { "document-uri": "...", "violated-directive": "...", ... } }
  //
  //   application/reports+json (Reporting API, modern Chromium/Edge):
  //     An array of report objects, each with type "csp-violation":
  //     [
  //       {
  //         "type": "csp-violation",
  //         "url": "https://...",
  //         "body": {
  //           "documentURL": "...",
  //           "violatedDirective": "...",
  //           "blockedURL": "...",
  //           "effectiveDirective": "...",
  //           "originalPolicy": "...",
  //           "sourceFile": "...",
  //           "lineNumber": 42,
  //           "columnNumber": 7,
  //           "statusCode": 200
  //         }
  //       }
  //     ]
  //
  // M-4 fix: normalise both shapes into a flat report object before logging.

  // Collect one or more normalised report objects to log.
  const reportsToLog: Array<Record<string, unknown>> = [];

  try {
    const parsed = JSON.parse(text);

    if (isReportingApi && Array.isArray(parsed)) {
      // Reporting API batch envelope — extract each CSP violation report.
      for (const item of parsed as Array<Record<string, unknown>>) {
        if (item["type"] !== "csp-violation") continue; // skip non-CSP entries
        const body = (item["body"] as Record<string, unknown>) ?? {};
        // Normalise Reporting API field names to the legacy hyphenated names
        // so the logging block below is shared between both formats.
        reportsToLog.push({
          "document-uri":       body["documentURL"],
          "violated-directive": body["violatedDirective"],
          "effective-directive":body["effectiveDirective"],
          "blocked-uri":        body["blockedURL"],
          "source-file":        body["sourceFile"],
          "line-number":        body["lineNumber"],
          "column-number":      body["columnNumber"],
          "status-code":        body["statusCode"],
          "original-policy":    body["originalPolicy"],
        });
      }
    } else {
      // Legacy application/csp-report shape — single report wrapped in
      // "csp-report" key, or (defensively) the body itself.
      const legacyParsed = parsed as Record<string, unknown>;
      const report = (legacyParsed["csp-report"] as Record<string, unknown>) ?? legacyParsed;
      reportsToLog.push(report);
    }
  } catch {
    // Malformed JSON — log nothing, return 204 so the browser does not retry.
    return new NextResponse(null, { status: 204 });
  }

  // Log each normalised report using the safe field extraction helpers.
  for (const report of reportsToLog) {

    // Log only the fields that are useful for diagnosis — never the full raw
    // body, which may contain user-entered text from the violating page context.
    console.warn("[csp-report] Violation", {
      documentUri:         safeStr(report["document-uri"]),
      violatedDirective:   safeStr(report["violated-directive"]),
      effectiveDirective:  safeStr(report["effective-directive"]),
      blockedUri:          safeStr(report["blocked-uri"]),
      sourceFile:          safeStr(report["source-file"]),
      lineNumber:          safeNum(report["line-number"]),
      columnNumber:        safeNum(report["column-number"]),
      statusCode:          safeNum(report["status-code"]),
      // IP is hashed — same pattern as contact / newsletter routes.
      ipHash:              await hashIp(ip),
      ts:                  new Date().toISOString(),
    });
  }

  return new NextResponse(null, { status: 204 });
}

/**
 * Safely extract a string field from an untrusted object.
 *
 * Issue fix: CSP report fields (document-uri, blocked-uri, source-file, etc.)
 * are entirely attacker/browser-controlled strings. Truncating to 500 chars
 * alone does not stop log-line injection — a value containing "\n" or "\r"
 * can forge what looks like additional, fake log entries in the deployment
 * platform's log stream (e.g. injecting a fabricated "[csp-report]" line or
 * spoofing other log output), and embedded tabs can break log-line column
 * alignment. Stripping \r, \n, and \t (replacing each with a single space)
 * before truncating guarantees the field can never span more than the one
 * intended log line.
 */
function safeStr(val: unknown): string {
  if (typeof val !== "string") return "";
  return val.replace(/[\r\n\t]/g, " ").slice(0, 500);
}

/** Safely extract a numeric field from an untrusted object. */
function safeNum(val: unknown): number | undefined {
  return typeof val === "number" ? val : undefined;
}
