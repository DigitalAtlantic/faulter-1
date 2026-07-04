/**
 * lib/requestProtocol.ts
 *
 * Shared, runtime-agnostic "was this request served over HTTPS?" detector.
 *
 * ── Why this file exists (external-audit H-1 fix) ───────────────────────────
 * Before this fix, two different signals were used to decide whether a
 * connection was HTTPS, for two different cookies:
 *
 *   • middleware.ts's `rl_search` cookie used a tiered-trust check against
 *     `x-forwarded-proto` / `request.nextUrl.protocol` (correct — reflects
 *     the actual connection).
 *   • app/api/csrf/route.ts's `csrf_token` cookie used
 *     `process.env.NODE_ENV === "production"` (wrong — reflects the build
 *     mode, not the protocol of the request that's actually being served).
 *
 * Those two signals are NOT equivalent. A staging deployment that runs with
 * NODE_ENV=production but is served over plain HTTP (a direct-to-origin
 * health check, a staging URL without TLS, etc.) would get `Secure: true`
 * on the CSRF cookie while NODE_ENV-gated logic believed itself correct.
 * Browsers silently drop a `Secure` cookie sent over a plaintext response,
 * which breaks the double-submit CSRF check for every user on that
 * deployment — silently, with no error surfaced anywhere.
 *
 * The fix is to have exactly ONE implementation of "is this request HTTPS?"
 * and have every cookie-setting call site use it, so the two signals can
 * never drift apart again. This mirrors the existing lib/upstash.ts pattern
 * in this codebase (a single shared module with no `import "server-only"`,
 * importable from both the Edge Runtime middleware and Node.js route
 * handlers) rather than re-deriving or copy-pasting the trust logic.
 *
 * ── Tiered trust model ──────────────────────────────────────────────────────
 * `x-forwarded-proto` is only trustworthy when we know a trusted layer set
 * it — otherwise any client can send `X-Forwarded-Proto: https` over a bare
 * HTTP socket and lie about the connection.
 *
 *   Tier 1 — Cloudflare (TRUST_CLOUDFLARE=true):
 *     Cloudflare always connects to origins over HTTPS in proxy mode and
 *     sets x-forwarded-proto: https on every tunnelled request. Trusted only
 *     once the operator asserts ALL traffic transits Cloudflare.
 *
 *   Tier 2 — Vercel (VERCEL env var present):
 *     Vercel's edge network is HTTPS-only and sets x-forwarded-proto
 *     reliably; no unproxied HTTP path exists. VERCEL is set automatically
 *     in every Vercel environment — no operator action needed.
 *
 *   Tier 3 — TRUST_PROXY=true (explicit reverse-proxy assertion):
 *     On a VPS/container behind nginx/Caddy/HAProxy, the operator asserts
 *     that all traffic transits their proxy and that it strips any
 *     client-supplied x-forwarded-proto before setting its own.
 *
 *   Fallback — request.nextUrl.protocol:
 *     Derived by Next.js from the actual socket-level connection, so it is
 *     un-forgeable by the client. Always "https:" on Vercel; "http:" for a
 *     bare local dev server or an un-proxied direct-to-origin deployment.
 *
 * This is intentionally request-level, not env-level: it answers "was THIS
 * request HTTPS?" rather than "is this a production build?" — which is the
 * actual question a cookie's `secure` flag needs answered.
 *
 * Used by:
 *   • middleware.ts             — the `rl_search` rate-limit cookie
 *   • app/api/csrf/route.ts     — the `csrf_token` double-submit cookie
 *
 * No `import "server-only"` here — this file must stay importable from the
 * Edge Runtime (middleware.ts) as well as Node.js route handlers.
 */

import type { NextRequest } from "next/server";

export function detectHttps(request: NextRequest): boolean {
  const trustCf = process.env.TRUST_CLOUDFLARE === "true";
  const isVercel = process.env.VERCEL === "1" || !!process.env.VERCEL;
  const trustProxy = process.env.TRUST_PROXY === "true";
  const trustXfp = trustCf || isVercel || trustProxy;

  if (trustXfp) {
    // The infrastructure is trusted to set x-forwarded-proto correctly.
    // Fall back to the socket-level protocol if the header is absent for
    // any reason (e.g. a health check that doesn't go through the proxy).
    const xfp = request.headers.get("x-forwarded-proto");
    return xfp ? xfp === "https" : request.nextUrl.protocol === "https:";
  }

  // No trusted proxy is configured. Fall back to the URL's own protocol,
  // which Next.js derives from the socket-level connection — safe (the
  // client cannot forge it) and correct for direct-origin deployments.
  return request.nextUrl.protocol === "https:";
}
