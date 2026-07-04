/**
 * Edge-runtime-safe rate limiting for middleware.ts.
 *
 * ── H-1 fix: duplication eliminated ─────────────────────────────────────────
 * Before H-1, this file was a hand-maintained copy of the Upstash REST helpers
 * from lib/rateLimit.ts.  The duplication was forced by rateLimit.ts having
 * `import "server-only"`, which crashes in the Next.js Edge Runtime.
 *
 * The fix is lib/upstash.ts — a shared module that contains only the Upstash
 * REST logic with no Node.js imports.  Both this file and rateLimit.ts now
 * import from upstash.ts.  There is no duplicated logic anywhere.
 *
 * This file intentionally has NO `import "server-only"` — it is imported by
 * middleware.ts which runs in the Edge Runtime.
 *
 * ── H-3 fix: HTTPS enforcement ──────────────────────────────────────────────
 * hasUpstash() in lib/upstash.ts now validates that UPSTASH_REDIS_REST_URL
 * starts with https://.  If it doesn't, Upstash is disabled and the in-process
 * Map fallback is used, with a warning logged on boot.
 *
 * ── H-3 fix: IP spoofing via X-Forwarded-For ─────────────────────────────────
 * getClientIp() now prefers x-real-ip over X-Forwarded-For.  XFF is kept only
 * as a last-resort fallback because it is trivially forged by HTTP clients on
 * any deployment without Cloudflare or a properly configured reverse proxy.
 * See the getClientIp() JSDoc below and lib/rateLimit.ts for full details.
 *
 * ── H-8 fix: IP spoofing via X-Real-IP on non-Vercel deployments ────────────
 * The generic x-real-ip check below previously had NO trust flag at all — it
 * was accepted unconditionally regardless of platform, unlike CF-Connecting-IP
 * (TRUST_CLOUDFLARE) and X-Forwarded-For (TRUST_PROXY). Any client could send
 * `X-Real-IP: 1.2.3.4` and bypass the /search rate limit on any deployment
 * that isn't Vercel. getClientIp() now mirrors lib/rateLimit.ts exactly: a
 * Vercel-gated branch trusts x-real-ip unconditionally (Vercel's edge sets it
 * to the true client address and does not let clients control it), and a
 * separate generic branch checks x-real-ip then X-Forwarded-For, both gated
 * behind TRUST_PROXY=true. This also resolves the old L-4 finding, which
 * noted that this file collapsed the Vercel-gated and generic x-real-ip
 * branches into one unconditional check "because the behaviour is
 * identical" — that was true of the *unconditional-trust* behaviour, but the
 * unconditional trust itself was the H-8 vulnerability. The two files are
 * unified again here, this time with the correct trust gating preserved.
 */

import { checkRateLimit } from "@/lib/upstash";

// ---------------------------------------------------------------------------
// Public API — used by middleware.ts only
// ---------------------------------------------------------------------------

/**
 * Returns the real client IP from request headers.
 *
 * ── H-3 fix: IP spoofing via X-Forwarded-For ─────────────────────────────────
 * The previous implementation fell back to X-Forwarded-For[0] on
 * non-Cloudflare deployments.  That header is trivially forged by any HTTP
 * client, letting an attacker rotate IPs and bypass the middleware search
 * rate limit entirely.
 *
 * ── H-8 fix: IP spoofing via X-Real-IP ───────────────────────────────────────
 * The generic x-real-ip check used to be accepted unconditionally, with no
 * trust flag — unlike CF-Connecting-IP (TRUST_CLOUDFLARE) and X-Forwarded-For
 * (TRUST_PROXY). On any non-Vercel deployment a client could send
 * `X-Real-IP: 1.2.3.4` and bypass the /search rate limit entirely. The fix
 * splits this into a Vercel-gated step (trusted unconditionally — Vercel's
 * edge sets the header, the client cannot) and a generic step gated behind
 * TRUST_PROXY=true, matching lib/rateLimit.ts exactly.
 *
 * This is the Edge-Runtime mirror of the same fixes in lib/rateLimit.ts.
 * The logic must be duplicated here because the Edge Runtime cannot import
 * Node.js-only modules.  Any change to the IP resolution priority must
 * be applied to BOTH files.
 *
 * ── Platform priority ────────────────────────────────────────────────────────
 *
 *   1. CF-Connecting-IP  — trusted ONLY when TRUST_CLOUDFLARE=true asserts
 *      that all traffic transits Cloudflare.  Without this guard, a client
 *      that bypasses Cloudflare can forge CF-Connecting-IP and rotate IPs,
 *      defeating the middleware search rate limit entirely.
 *
 *   2. x-real-ip         — trusted unconditionally ONLY when the VERCEL env
 *      var is present.  Vercel's edge network sets this to the true
 *      socket-level client address and does not allow clients to control it.
 *
 *   3. x-real-ip, then X-Forwarded-For — gated behind TRUST_PROXY=true.  For
 *      non-Vercel deployments (nginx, Caddy, etc.) neither header is
 *      trustworthy unless the operator's reverse proxy overwrites it, which
 *      TRUST_PROXY=true is the explicit assertion of.  ⚠️  Both are forgeable
 *      unless your reverse proxy strips client-supplied values before
 *      appending its own entry.  Never set TRUST_PROXY=true on a deployment
 *      where the origin is reachable without a trusted proxy.
 *
 *   4. "unknown"         — returned when none of the above are present/trusted.
 *
 * Accepts a `Request` (or `NextRequest`) — both expose `.headers` as a
 * standard `Headers` object, so this works in the Edge Runtime without
 * importing anything from next/server.
 *
 * See lib/rateLimit.ts getClientIp() for full deployment guidance.
 */
export function getClientIp(headers: Headers): string {
  // Step 1 — Cloudflare: CF-Connecting-IP is only trusted when
  // TRUST_CLOUDFLARE=true asserts that ALL traffic transits Cloudflare.
  // Without this guard, a client that bypasses Cloudflare and hits the
  // origin directly can forge CF-Connecting-IP, rotating through arbitrary
  // IPs and defeating the middleware search rate limit entirely.
  // The Edge Runtime exposes process.env, so this env-var check works here.
  const cf = headers.get("cf-connecting-ip");
  const trustCf = process.env.TRUST_CLOUDFLARE === "true";
  if (cf && trustCf) return cf.trim();

  // Step 2 — Vercel: x-real-ip is set by Vercel's edge to the socket-level
  // client address and cannot be forged by the client. Trusted unconditionally
  // — no TRUST_PROXY needed — because Vercel's infrastructure (not the
  // client) controls this header's value whenever VERCEL is present.
  const isVercel = process.env.VERCEL === "1" || !!process.env.VERCEL;
  if (isVercel) {
    const xri = headers.get("x-real-ip");
    if (xri) return xri.trim();
  }

  // Step 3 — Generic reverse proxy (nginx, Caddy, etc.): x-real-ip, then
  // X-Forwarded-For's first entry as a fallback.
  //
  // H-8 fix: BOTH headers require TRUST_PROXY=true here. Previously x-real-ip
  // was read unconditionally on every platform with no trust flag at all —
  // any client could send `X-Real-IP: 1.2.3.4` and bypass the /search rate
  // limit on a non-Vercel deployment.
  // ⚠️  FORGEABLE: only trust these when TRUST_PROXY=true asserts that your
  // reverse proxy strips any client-supplied X-Real-IP / X-Forwarded-For
  // header before appending its own entry.  Without that guarantee any
  // client can rotate through arbitrary IPs and bypass all IP-based rate
  // limits.  The Edge Runtime exposes process.env, so this env-var check
  // works here.
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const xri = headers.get("x-real-ip");
    if (xri) return xri.trim();

    const xff = headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }

  return "unknown";
}

/**
 * IP-based rate limit for the /search route (cookieless-request defence).
 *
 * Limit: 30 req / IP / 60 s — matches the limit in rateLimit.ts.
 * This runs in middleware (Edge Runtime) and guards cookieless clients
 * that bypass the signed rl_search cookie window by omitting cookies.
 *
 * Uses the shared checkRateLimit from lib/upstash.ts — identical behaviour
 * to the Node.js path, with no duplicated implementation.
 *
 * L-7 — INTENTIONAL SHARED KEY PREFIX:
 * The `search:${ip}` key below is the same key prefix used by
 * checkSearchIpRateLimit() in lib/rateLimit.ts. This is deliberate: both
 * files implement this exact function for the exact same purpose (capping
 * /search requests per IP) against the exact same Upstash backend (via
 * lib/upstash.ts, imported by both). Sharing the key means a request
 * counted by either code path counts against one combined 30-req/60s budget
 * per IP for /search — not two independent budgets an attacker could use to
 * double their effective allowance by hitting both call paths.
 *
 * This function is duplicated here (rather than imported from
 * lib/rateLimit.ts) only because lib/rateLimit.ts has `import "server-only"`,
 * which throws in the Edge Runtime that middleware.ts runs in. lib/upstash.ts
 * underneath is the real shared implementation; this is a thin
 * runtime-compatibility wrapper, not independently-drifted logic.
 *
 * If you ever change the key prefix, the window, or the limit here, make
 * the identical change in lib/rateLimit.ts's checkSearchIpRateLimit() — see
 * the matching comment there.
 */
export async function checkSearchIpRateLimit(ip: string): Promise<boolean> {
  return checkRateLimit(`search:${ip}`, 30, 60 * 1000, "[rateLimitEdge]");
}
