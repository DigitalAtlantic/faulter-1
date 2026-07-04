/**
 * Rate limiting + IP utilities for Node.js API route handlers.
 *
 * Strategy: Upstash Redis sliding window when credentials are present;
 * in-process Map sliding window otherwise.
 *
 * ── Upstash path (recommended for all production deployments) ───────────────
 * Set the following two environment variables to enable distributed rate
 * limiting that works correctly across serverless functions, auto-scaling
 * replicas, and multi-region deployments:
 *
 *   UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN=AXxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * Both values are available in the Upstash console under your database →
 * REST API tab.  They are safe to store in environment variables — the REST
 * token is scoped to this database only.
 *
 * ── H-1 fix: no more duplication ────────────────────────────────────────────
 * The Upstash REST helpers (hasUpstash, upstashIncr, checkRateLimit) now live
 * exclusively in lib/upstash.ts, which has no `import "server-only"` and is
 * therefore safe to import from both this file and lib/rateLimitEdge.ts.
 *
 * Previously those helpers were copy-pasted into both files with a comment
 * saying "mirror the change here manually" — a structural drift hazard.
 * Any bug fix or behaviour change now only needs to be made in upstash.ts.
 *
 * ── H-3 fix: HTTPS enforcement ──────────────────────────────────────────────
 * hasUpstash() in lib/upstash.ts now validates that UPSTASH_REDIS_REST_URL
 * starts with https://.  If it doesn't, Upstash is disabled and the in-process
 * Map fallback is used, with a loud error logged on every boot in production.
 *
 * ── H-3 fix: IP spoofing via X-Forwarded-For ─────────────────────────────────
 * The previous getClientIp() fell back to X-Forwarded-For[0] for all
 * non-Cloudflare deployments, which is trivially forged by any HTTP client.
 * The new implementation prefers x-real-ip (injected by Vercel's edge and most
 * well-configured reverse proxies) over XFF, with an optional TRUST_CLOUDFLARE
 * environment variable to assert that all traffic transits Cloudflare.
 * See the getClientIp() JSDoc below for per-platform guidance.
 *
 * ── H-8 fix: IP spoofing via X-Real-IP on non-Vercel deployments ────────────
 * H-3 above closed the X-Forwarded-For hole but left an identical one open in
 * the generic (non-Vercel) branch: x-real-ip was read unconditionally with no
 * trust flag at all — unlike CF-Connecting-IP (gated by TRUST_CLOUDFLARE) and
 * the XFF fallback (gated by TRUST_PROXY). Any client could send
 * `X-Real-IP: 1.2.3.4` (rotating it per request) on a bare VPS, a generic load
 * balancer, or any nginx config that doesn't explicitly overwrite the header,
 * and bypass every IP-based rate limit in the app. The generic x-real-ip
 * fallback is now gated behind TRUST_PROXY — the same flag that already
 * asserts "my reverse proxy strips client-supplied forwarding headers before
 * setting its own." The Vercel-specific branch (Step 2 below) is unaffected:
 * Vercel's edge sets x-real-ip to the true socket-level client address and
 * does not allow it to be client-controlled, so it remains trusted whenever
 * the VERCEL env var is present.
 *
 * ── In-process Map path (local dev / single-instance VPS) ─────────────────
 * When Upstash credentials are absent, the limiter falls back to an in-process
 * sliding-window Map.  This is intentional for local development (no Redis
 * setup required) and acceptable for a truly single-process deployment.
 *
 * ⚠️  WARNING: The Map path does NOT work on serverless platforms (Vercel,
 * Netlify, Lambda) or any deployment with more than one Node.js replica.
 * Each instance has its own counter, so a bot splitting requests across
 * instances sees no effective limit at all — the limiter silently fails open.
 *
 * Before going live on a serverless or auto-scaling host, set the Upstash
 * credentials above.  The HMAC-signed search cookie in middleware.ts is the
 * one exception; it correctly works per-client regardless of replica count.
 */

// Prevent this module from being imported in Client Components.
// lib/rateLimit.ts manages IP-based counters and reads Upstash credentials —
// server-only utilities that must never reach the browser bundle.
import "server-only";

// H-1 fix: Upstash REST helpers are now shared from lib/upstash.ts.
// upstash.ts has no `import "server-only"` so it can also be imported by
// lib/rateLimitEdge.ts (Edge Runtime) without crashing middleware.
import { hasUpstash, checkRateLimit as _checkRateLimit } from "@/lib/upstash";

// L-6 fix: hashIp() below now HMAC-keys its digest with a secret instead of
// using plain unkeyed SHA-256. Both this file and lib/unsubscribe.ts are
// Node-only (server-only), so this import is safe — no Edge Runtime path
// pulls lib/rateLimit.ts in a way that would drag this along into
// middleware.ts.
import { getUnsubscribeSecret } from "@/lib/unsubscribe";

// ---------------------------------------------------------------------------
// L-7 fix: dedicated log-IP-hash secret, decoupled from UNSUBSCRIBE_SECRET
// ---------------------------------------------------------------------------
//
// Previously hashIp() below HMAC-keyed its digest directly with
// getUnsubscribeSecret(). That coupled two unrelated concerns to the same
// secret value:
//   1. Signing/verifying one-click unsubscribe tokens (a security-critical,
//      user-facing credential).
//   2. Keying the IP hash used purely for log correlation (an internal,
//      non-credential convenience — "did these two log lines come from the
//      same IP").
//
// If UNSUBSCRIBE_SECRET ever needs rotation (e.g. suspected exposure), every
// previously-logged IP hash silently stops being correlatable with new ones
// — a side effect with no relationship to the actual reason for rotating an
// unsubscribe-token secret.
//
// LOG_IP_HASH_SECRET is an optional, dedicated secret for this one purpose.
// When it is set, hashIp() uses it directly and the two secrets can be
// rotated independently. When it is unset, this falls back to
// getUnsubscribeSecret() exactly as before — so existing deployments that
// have not added the new variable see no behavioural change at all.
function getLogIpHashSecret(): string {
  const dedicated = process.env.LOG_IP_HASH_SECRET;
  if (dedicated) return dedicated;
  return getUnsubscribeSecret();
}

// ---------------------------------------------------------------------------
// M-3 fix: startup guard for the LOG_IP_HASH_SECRET fallback
// ---------------------------------------------------------------------------
//
// LOG_IP_HASH_SECRET is intentionally absent from REQUIRED_VARS in lib/env.ts
// — it is an optional, additive secret, and requiring it would break existing
// deployments that have not added the new variable (see L-7 above).
//
// But "optional and silent" means an operator can ship to production without
// ever knowing the fallback engaged. That fallback is a deliberate trade-off
// (coupling log-IP-hash rotation to UNSUBSCRIBE_SECRET rotation, see L-7
// above) — it should be a trade-off the operator chooses, not one they
// inherit by omission. This mirrors the ATLAS_IP_RESTRICTED pattern in
// lib/db.ts: a one-time, loud, non-blocking log line at module load so the
// current state is visible in the deploy log tail instead of silent.
//
// This block does NOT throw and does NOT add LOG_IP_HASH_SECRET to
// REQUIRED_VARS — hashIp() already works correctly via getUnsubscribeSecret()
// when this is unset (UNSUBSCRIBE_SECRET is itself a required production var,
// see lib/env.ts). This is a visibility fix, not a hard dependency.
//
// NEXT_PHASE guard: suppressed during `next build`, same rationale as the
// Upstash guard below — secrets are injected at deploy time, not build time.
let _logIpHashWarnedOnce = false;
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !_logIpHashWarnedOnce &&
  !process.env.LOG_IP_HASH_SECRET
) {
  _logIpHashWarnedOnce = true;
  console.warn(
    `[rateLimit] LOG_IP_HASH_SECRET is not set.\n`
    + `  hashIp() is falling back to UNSUBSCRIBE_SECRET to key the IP hash\n`
    + `  written to logs. This works, but couples two unrelated secrets:\n`
    + `  rotating UNSUBSCRIBE_SECRET (e.g. after suspected exposure) will\n`
    + `  silently break log-IP correlation across the rotation boundary.\n`
    + `  To decouple them, set LOG_IP_HASH_SECRET to its own random value\n`
    + `  (e.g. \`openssl rand -hex 32\`) in your deployment environment.\n`
    + `  This is informational, not a hard requirement — the fallback is\n`
    + `  safe to run with indefinitely if independent rotation isn't needed.`
  );
}

// ---------------------------------------------------------------------------
// H-3 fix: production misconfiguration guard
// ---------------------------------------------------------------------------
//
// The in-process Map fallback is intentionally silent in development — no
// Redis setup required locally.  In production it is a silent failure: each
// serverless instance resets its own counter on every cold start, so the
// rate limits for /api/contact, /api/newsletter, and /api/csrf effectively
// do nothing on Vercel, Netlify, Lambda, Fly.io (>1 instance), or any
// auto-scaling host.
//
// This block runs ONCE at module load (not per-request) and writes a single
// loud error to stderr when the environment is production and Upstash is not
// configured.  The message appears in your deployment platform's log tail
// immediately on the first request after deploy, making the misconfiguration
// impossible to miss before real traffic arrives.
//
// It does NOT throw — a missing Upstash config is a degraded-mode problem,
// not a hard crash.  The site still works; only rate limiting is ineffective.
// Throwing here would take down every API route that imports rateLimit.ts,
// which is a worse outcome than running without rate limits.
//
// NEXT_PHASE guard: Next.js sets NEXT_PHASE=phase-production-build during
// `next build`. Upstash credentials are intentionally absent during the build
// step (secrets are injected only at deploy time). Suppressing the warning
// during build keeps the output clean; the misconfiguration is still surfaced
// on the first real request in a deployed environment.
let _rateLimitWarnedOnce = false;
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !_rateLimitWarnedOnce &&
  !hasUpstash()
) {
  _rateLimitWarnedOnce = true;
  console.error(
    `[rateLimit] MISCONFIGURATION: Upstash Redis is not configured or not using HTTPS.\n`
    + `  UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are both required\n`
    + `  in production, and the URL must start with https://.\n`
    + `  Without a valid Upstash config the in-process Map fallback is used, which\n`
    + `  does NOT work on serverless or multi-replica deployments — each instance\n`
    + `  resets its own counter on every cold start, making all rate limits\n`
    + `  (contact, newsletter, CSRF) completely ineffective.\n`
    + `  Get credentials at https://upstash.com and add UPSTASH_REDIS_REST_URL\n`
    + `  (https://) and UPSTASH_REDIS_REST_TOKEN to your deployment environment variables.`
  );
}

// ---------------------------------------------------------------------------
// IP-trust startup guard — warns once if no trusted header strategy is set
// ---------------------------------------------------------------------------
//
// getClientIp() has a well-defined priority chain:
//   1. CF-Connecting-IP  when TRUST_CLOUDFLARE=true
//   2. x-real-ip         on Vercel (VERCEL env var present) — always trusted
//   3. x-real-ip, then X-Forwarded-For   when TRUST_PROXY=true (generic reverse proxy)
//   4. "unknown"         (fallback — rate limiting degrades)
//
// "unknown" buckets ALL requests without a recognised header together, which
// means every user looks like the same IP.  On a shared rate limit this either:
//   • blocks legitimate users when one user burns the shared budget, or
//   • never blocks abusers because "unknown" is the only key and it fills with
//     legitimate traffic first.
//
// This guard fires ONCE at module load in production (same timing as the
// Upstash guard above) when none of the three trusted-header strategies can
// possibly yield a real IP: TRUST_CLOUDFLARE is not "true", VERCEL is not set,
// and TRUST_PROXY is not "true".  It does NOT throw — the site still works,
// rate limiting just degrades.  The message is actionable: it tells the
// operator exactly which env var to set for their deployment platform.
//
// This guard is intentionally module-level (not inside getClientIp()) so it
// fires once on cold start and appears in the deployment log tail immediately,
// rather than being buried inside per-request output.

let _ipTrustWarnedOnce = false;
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !_ipTrustWarnedOnce
) {
  const trustCf     = process.env.TRUST_CLOUDFLARE === "true";
  const isVercel    = process.env.VERCEL === "1" || !!process.env.VERCEL;
  const trustProxy  = process.env.TRUST_PROXY === "true";

  if (!trustCf && !isVercel && !trustProxy) {
    _ipTrustWarnedOnce = true;
    console.error(
      "[rateLimit] MISCONFIGURATION: No trusted IP-header strategy is configured.\n" +
      "  getClientIp() will return \"unknown\" for all requests, which collapses\n" +
      "  all rate-limit keys to a single bucket and makes IP-based limits\n" +
      "  either permanently ineffective or permanently blocking.\n" +
      "\n" +
      "  Fix — choose ONE of the following based on your deployment platform:\n" +
      "\n" +
      "  • Vercel (recommended):  no change needed — set VERCEL=1 in your\n" +
      "    deployment environment (Vercel sets this automatically) or confirm\n" +
      "    that the VERCEL environment variable is present.\n" +
      "\n" +
      "  • Cloudflare in front of any host: set TRUST_CLOUDFLARE=true ONLY after\n" +
      "    confirming that ALL traffic transits Cloudflare (orange-cloud DNS,\n" +
      "    no direct-to-origin path).  See .env.example for prerequisites.\n" +
      "\n" +
      "  • Other reverse proxy (nginx, Caddy, Fly.io, Railway, etc.): configure\n" +
      "    your proxy to set X-Real-IP to the client address (preferred) and/or\n" +
      "    strip inbound X-Forwarded-For and append its own entry, THEN set\n" +
      "    TRUST_PROXY=true.  Both headers require this flag on non-Vercel\n" +
      "    deployments — neither is trusted unconditionally.  Never set\n" +
      "    TRUST_PROXY=true on a direct-to-origin deployment."
    );
  }
}

// ---------------------------------------------------------------------------
// Internal wrapper — injects the "[rateLimit]" log prefix
// ---------------------------------------------------------------------------

async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  return _checkRateLimit(key, limit, windowMs, "[rateLimit]");
}

// ---------------------------------------------------------------------------
// Public rate-limit exports
// ---------------------------------------------------------------------------

/** 3 submissions / IP / hour for the contact form. */
export async function checkContactRateLimit(ip: string): Promise<boolean> {
  return checkRateLimit(`contact:${ip}`, 3, 60 * 60 * 1000);
}

/** 5 submissions / IP / hour for newsletter sign-ups. */
export async function checkNewsletterRateLimit(ip: string): Promise<boolean> {
  return checkRateLimit(`newsletter:${ip}`, 5, 60 * 60 * 1000);
}

/**
 * H-5 fix: IP-based rate limit for the /api/unsubscribe endpoint.
 *
 * Token entropy (2^256 HMAC values) makes brute-force infeasible and
 * safeEqual() is constant-time per request, but without a rate limit two
 * real attack surfaces remain:
 *
 *   1. DB amplification: every well-formed request — valid or not — hits
 *      MongoDB for a deleteOne() call.  An attacker can flood the endpoint
 *      with syntactically valid but token-mismatched requests, each costing
 *      a DB round-trip.  At scale this is a cheap, targeted DoS against the
 *      subscribers collection.
 *
 *   2. Aggregate timing oracle: safeEqual() is constant-time per request, but
 *      a network-level attacker collecting thousands of response latencies can
 *      recover statistical signal even from individually constant-time ops.
 *      Rate-limiting caps the number of samples an attacker can collect per
 *      minute.
 *
 * Limit: 10 req / IP / 60 s.  Unsubscribing is a single human click from an
 * email; 10/min covers accidental double-clicks, retries after a browser crash,
 * and link-preview fetches by email clients, while making both attack vectors
 * economically unattractive.
 */
export async function checkRateLimitUnsubscribe(ip: string): Promise<boolean> {
  return checkRateLimit(`unsubscribe:${ip}`, 10, 60 * 1000);
}

/**
 * IP-based rate limit for the /search route (cookieless-request defence).
 * Limit: 30 req / IP / 60 s — gives legitimate users (shared NAT, API clients)
 * headroom while blocking uncapped scraping.
 *
 * L-7 — INTENTIONAL SHARED KEY PREFIX:
 * The `search:${ip}` key below is the same key prefix used by
 * checkSearchIpRateLimit() in lib/rateLimitEdge.ts. This is deliberate, not
 * accidental duplication: both files call this exact function name for the
 * exact same purpose (capping /search requests per IP) against the exact
 * same Upstash backend (via lib/upstash.ts's checkRateLimit(), which both
 * files import). Using the same key means a request counted by one code
 * path also counts against the other — there is one shared 30-req/60s
 * budget per IP for /search, not two independent budgets that an attacker
 * could exploit by triggering both paths to effectively double their
 * allowance.
 *
 * The function is duplicated across two files (not implemented once and
 * imported from a single place) because lib/rateLimit.ts has
 * `import "server-only"`, which throws if loaded in the Edge Runtime that
 * middleware.ts runs in — so middleware.ts imports the Edge-safe copy from
 * lib/rateLimitEdge.ts instead. lib/upstash.ts is the actual shared
 * implementation underneath both; this is a thin wrapper duplicated for
 * runtime compatibility, not drifted logic.
 *
 * If you ever change the key prefix, the window, or the limit here, make
 * the identical change in lib/rateLimitEdge.ts's checkSearchIpRateLimit() —
 * see the matching comment there.
 */
export async function checkSearchIpRateLimit(ip: string): Promise<boolean> {
  return checkRateLimit(`search:${ip}`, 30, 60 * 1000);
}

/**
 * IP-based rate limit for the /api/csrf token-vending endpoint.
 * Limit: 20 req / IP / 60 s — generous for humans (1–3 tokens per page load),
 * tight enough to stop automated token-farming and DoS.
 */
export async function checkRateLimitCsrf(ip: string): Promise<boolean> {
  return checkRateLimit(`csrf:${ip}`, 20, 60 * 1000);
}

/**
 * IP-based rate limit for the /api/csp-report endpoint.
 * Limit: 10 req / IP / 60 s — generous for real browsers, blocks log-flood bots.
 * The handler returns 204 (not 429) on breach so browsers do not retry.
 */
export async function checkRateLimitCspReport(ip: string): Promise<boolean> {
  return checkRateLimit(`csp-report:${ip}`, 10, 60 * 1000);
}

/**
 * Issue #3 fix: Global (IP-independent) rate limit gating external CSP report
 * forwarding via forwardToExternalReporter() in app/api/csp-report/route.ts.
 *
 * ── Why a second, global limiter? ───────────────────────────────────────────
 * The per-IP limiter (checkRateLimitCspReport) caps local logging at 10 req/IP/min
 * and correctly handles single-IP floods.  However, forwardToExternalReporter()
 * runs BEFORE that check (by design — to ensure no valid report is lost when
 * local logging is throttled).  This creates an unbounded amplification path:
 *
 *   A distributed attacker controlling N IP addresses can each send 10 req/min,
 *   producing 10N outbound fetch() calls per minute to the external reporter.
 *   At scale (10k IPs) that is 100k outbound requests/min — a DoS against the
 *   external reporting service billed to our account, or a bandwidth exhaustion
 *   attack against the origin.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * A SINGLE SHARED KEY (`csp-report-forward:global`) bounds total outbound
 * forwards regardless of how many source IPs are involved.
 *
 * Limit: 500 forwards / minute.
 *   • A real-world site with legitimate CSP violations might see a few dozen
 *     reports/min across all users during a deployment.  500/min is generous
 *     for any real traffic pattern and tight enough to cap amplification damage.
 *   • Adjust upward only if your site legitimately generates >500 CSP reports/min
 *     and you need all of them forwarded externally.
 *
 * ── Behaviour ───────────────────────────────────────────────────────────────
 * Returns false (rate limit exceeded) when the global budget is exhausted.
 * The route handler skips forwardToExternalReporter() on false but continues
 * with local logging (gated by the per-IP limiter as before).
 *
 * The global key is intentionally NOT scoped to an IP — it is a site-wide
 * circuit breaker.  A Upstash miss degrades to the in-process Map fallback
 * (single-instance only) exactly like all other limiters in this file.
 */
export async function checkRateLimitCspReportForward(): Promise<boolean> {
  return checkRateLimit("csp-report-forward:global", 500, 60 * 1000);
}

/**
 * H-2 fix: per-IP rate limit for the getBookmarkedArticles Server Action.
 *
 * Server Actions are POST requests to /_next/action and are NOT automatically
 * covered by route-level limits in middleware.ts. Without a rate limit this
 * endpoint was open to unrestricted flooding.
 *
 * Limit: 60 req / IP / 60 s — generous for legitimate use (one load per
 * minute of the bookmarks page) and tight enough to prevent denial-of-wallet
 * attacks. This limit is REQUIRED before any MongoDB migration: the natural
 * translation of the in-memory `.filter()` becomes a `find({ $in: safeIds })`
 * query, making each call up to 100 DB lookups driven by client-controlled IDs.
 *
 * Called from app/bookmarks/actions.ts via checkRateLimit from lib/upstash.ts
 * directly (to avoid the "server-only" constraint on this file at the Server
 * Action boundary). This export documents the intent and limit for auditors.
 */
export async function checkRateLimitBookmarks(ip: string): Promise<boolean> {
  return checkRateLimit(`bookmarks:${ip}`, 60, 60 * 1000);
}

// ─── IP extraction ────────────────────────────────────────────────────────────

/**
 * Returns the real client IP from request headers.
 *
 * ── H-3 fix: IP spoofing via X-Forwarded-For ─────────────────────────────────
 * The previous implementation fell back to `X-Forwarded-For[0]` on
 * non-Cloudflare deployments.  That header is trivially forged by any client
 * (`curl -H "X-Forwarded-For: 1.1.1.1"`), so an attacker could rotate through
 * arbitrary IPs and bypass all IP-based rate limits entirely.
 *
 * ── H-8 fix: IP spoofing via X-Real-IP ───────────────────────────────────────
 * The previous implementation also had a "Step 3 — Generic" branch that read
 * x-real-ip unconditionally, on every platform, with no trust flag at all.
 * Unlike CF-Connecting-IP (gated by TRUST_CLOUDFLARE) and the XFF fallback
 * (gated by TRUST_PROXY), there was nothing stopping a client from sending
 * `X-Real-IP: 1.2.3.4` (rotating it per request) straight past that check on
 * any deployment that wasn't Vercel — a bare VPS, a generic load balancer, or
 * an nginx config that doesn't explicitly run `proxy_set_header X-Real-IP
 * $remote_addr;`.  That silently defeated every IP-based rate limit in the
 * app.  The fix folds the generic x-real-ip check into the same TRUST_PROXY
 * gate that already covers XFF for non-Vercel deployments — x-real-ip is
 * checked first (more specific, single value) and XFF is the fallback if it's
 * absent, but BOTH now require the operator to assert TRUST_PROXY=true.
 *
 * ── Platform-specific header priority ────────────────────────────────────────
 *
 *   1. CF-Connecting-IP  — trusted ONLY when TRUST_CLOUDFLARE=true.
 *      Cloudflare strips any client-supplied CF-Connecting-IP and sets its own,
 *      so this header is trustworthy when Cloudflare is genuinely in the path.
 *      However, if any traffic reaches the origin directly (bypassing CF), a
 *      client can forge CF-Connecting-IP and rotate through arbitrary IPs,
 *      defeating all IP-based rate limits.  Requiring TRUST_CLOUDFLARE=true
 *      forces an explicit operator assertion that no direct-to-origin path
 *      exists.  See .env.example for setup instructions.
 *
 *   2. x-real-ip         — injected by Vercel's edge network with the true
 *      client IP.  Present when VERCEL environment variable is set ("1").
 *      Unlike X-Forwarded-For, Vercel does not allow clients to control this
 *      header — it is always the socket-level client address. Trusted
 *      unconditionally (no extra flag needed) ONLY in this Vercel-detected
 *      branch.
 *
 *   3. x-real-ip, then X-Forwarded-For — gated behind TRUST_PROXY=true.
 *      For non-Vercel deployments (nginx, Caddy, Fly.io, Railway, a bare VPS,
 *      etc.), neither header is trustworthy by default — both are
 *      client-settable unless the operator's reverse proxy is configured to
 *      overwrite them.  Setting TRUST_PROXY=true is the operator's explicit
 *      assertion that their proxy does so.  x-real-ip is preferred when
 *      present (a single unambiguous value); X-Forwarded-For's first entry is
 *      used as a fallback.
 *      ⚠️  Do NOT set TRUST_PROXY=true unless your reverse proxy strips any
 *      client-supplied X-Real-IP / X-Forwarded-For headers before appending
 *      its own.
 *
 *   4. "unknown"         — returned when none of the above are present/trusted.
 *
 * ── Deployment guidance ───────────────────────────────────────────────────────
 *
 *   • Vercel (recommended):  set nothing extra; x-real-ip is always present
 *     and trusted automatically via the VERCEL env var.
 *
 *   • Cloudflare + any host: set TRUST_CLOUDFLARE=true in your deployment
 *     environment variables once you have confirmed that all traffic transits
 *     Cloudflare (DNS records point through the CF proxy, orange-cloud mode).
 *     Without this flag, CF-Connecting-IP is ignored — a forged header from
 *     a direct-to-origin client cannot bypass the rate limits.
 *
 *   • Other reverse proxy (nginx, Caddy, Fly.io, Railway, etc.): configure
 *     your proxy to set X-Real-IP to the true client address (and/or strip
 *     inbound X-Forwarded-For and append its own entry), THEN set
 *     TRUST_PROXY=true.  Without TRUST_PROXY=true, neither header is read on
 *     a non-Vercel deployment and getClientIp() returns "unknown" — rate
 *     limiting degrades to a single shared bucket rather than silently
 *     trusting a forgeable header.
 *
 *   • Direct-to-origin (no proxy):  leave TRUST_PROXY and TRUST_CLOUDFLARE
 *     unset.  x-real-ip and X-Forwarded-For are both client-controllable in
 *     this configuration and are correctly ignored.  Never set TRUST_PROXY=true
 *     on a direct-to-origin deployment — a client could rotate through
 *     arbitrary IPs and bypass all IP-based rate limits.
 */
export function getClientIp(headers: Headers): string {
  // Step 1 — Cloudflare: CF-Connecting-IP is only trusted when
  // TRUST_CLOUDFLARE=true asserts that ALL traffic transits Cloudflare's
  // proxy network.  Without this guard, any client that reaches the origin
  // directly (bypassing Cloudflare) can forge CF-Connecting-IP and rotate
  // through arbitrary IPs, defeating all IP-based rate limits.
  //
  // Set TRUST_CLOUDFLARE=true in your deployment environment only after
  // confirming that your DNS A/AAAA records point through the Cloudflare
  // proxy (orange-cloud) and no direct-to-origin path exists.
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

  // Step 3 — Generic reverse proxy (nginx, Caddy, Fly.io, Railway, a bare
  // VPS, etc.): x-real-ip, then X-Forwarded-For's first entry as a fallback.
  //
  // H-8 fix: BOTH headers require TRUST_PROXY=true here. Previously x-real-ip
  // was read unconditionally on this branch with no trust flag at all — any
  // client could send `X-Real-IP: 1.2.3.4` and bypass every IP-based rate
  // limit on a non-Vercel deployment. x-real-ip is checked first because it
  // is a single unambiguous value when present; X-Forwarded-For (a
  // potentially attacker-extendable comma-separated list) is the fallback.
  // ⚠️  Never set TRUST_PROXY=true unless your reverse proxy strips any
  // client-supplied X-Real-IP / X-Forwarded-For headers before appending its
  // own — otherwise a client can forge either header and rotate through
  // arbitrary IPs, defeating all IP-based rate limits.
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
 * One-way hash an IP address for logging.
 *
 * L-6 fix: previously this was plain SHA-256 (`crypto.subtle.digest("SHA-256",
 * ip)`), which is unkeyed. An attacker who can observe a logged hash can
 * brute-force or rainbow-table it back to the source IP — IPv4 address
 * space is small enough (2^32) that a plain SHA-256 over it is not
 * meaningfully one-way in practice. HMAC keys the digest with a secret
 * unknown to anyone outside the deployment, which removes that whole
 * offline-guessing avenue: matching a candidate IP to a hash now also
 * requires the secret.
 *
 * L-7 fix: keyed with getLogIpHashSecret() rather than getUnsubscribeSecret()
 * directly. getLogIpHashSecret() uses a dedicated LOG_IP_HASH_SECRET when an
 * operator has set one, falling back to UNSUBSCRIBE_SECRET when they haven't
 * — see the L-7 comment above getLogIpHashSecret() for the full rationale.
 * This keeps existing deployments working unchanged while letting operators
 * who want independent rotation set the new variable.
 *
 * ⚠️  CALLER IMPACT: hashIp() is called from every route that logs an IP —
 * app/api/contact/route.ts, app/api/newsletter/route.ts,
 * app/api/csp-report/route.ts, and app/api/unsubscribe/route.ts. All four
 * now transitively depend on getLogIpHashSecret() being resolvable, which in
 * the absence of LOG_IP_HASH_SECRET means UNSUBSCRIBE_SECRET, exactly as
 * before this fix. This is not a new operational requirement in practice:
 * UNSUBSCRIBE_SECRET is already a required production env var (see
 * .env.example and lib/env.ts), and getUnsubscribeSecret() already returns a
 * deterministic placeholder in local dev / preview (isRealProduction() ===
 * false) rather than throwing, so none of these four routes behave
 * differently locally.
 *
 * Returns the first 16 hex chars of HMAC-SHA256 — not reversible to the
 * original IP without the secret.
 */
export async function hashIp(ip: string): Promise<string> {
  if (ip === "unknown") return "unknown";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getLogIpHashSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Redact an email address for logging.
 * @example redactEmail("alice@example.com") → "<5chars>@example.com"
 */
export function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "<redacted>";
  return `<${at}chars>${email.slice(at)}`;
}
