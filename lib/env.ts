/**
 * lib/env.ts — Server-side environment variable validation.
 *
 * Exports a `getEnv()` function that validates required variables on first
 * call and caches the result.  Validation is intentionally DEFERRED — it does
 * not run at module-load / import time.
 *
 * Why deferred?
 * Next.js executes every API route module during `next build` ("Collecting
 * page data") to discover exports such as GET/POST/dynamic.  At that point
 * process.env does not contain runtime secrets.  A top-level validateEnv()
 * call would throw during the build even in a correctly configured production
 * environment, making the project un-buildable without setting secrets in the
 * build environment.
 *
 * By deferring to first call, the check fires on the first real request:
 *   - In production: immediately on the first incoming request, crashing the
 *     handler with a descriptive Error rather than a silent 502.
 *   - In development: same, on the first request after `npm run dev`.
 *   - During `npm run build`: never — build succeeds without secrets set.
 *
 * Usage (inside POST/GET handlers, not at module top-level):
 *   import { getEnv } from "@/lib/env";
 *   const env = getEnv();          // throws if any variable is missing
 *   new Resend(env.RESEND_API_KEY);
 *
 * ─── DB-4: DATABASE_URL credential protection ────────────────────────────────
 * DATABASE_URL is intentionally NOT included in REQUIRED_VARS here.
 * It is consumed exclusively through lib/db.ts, which strips credentials
 * before any logging.  Adding it to REQUIRED_VARS would risk the raw value
 * appearing in the descriptive missing-vars Error message — do NOT add it.
 *
 * Additionally, this module installs a global process.on("uncaughtException")
 * filter that scrubs DATABASE_URL from any Error message before the Node.js
 * default handler writes it to stderr.  This is a defence-in-depth measure
 * for the case where a third-party library embeds the connection string in
 * a thrown Error.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Prevent this module from being imported in Client Components.
// lib/env.ts validates server-side secrets and installs a process-level
// credential filter — neither is safe nor meaningful in a browser context.
import "server-only";

// ---------------------------------------------------------------------------
// M-3 fix: Single authoritative isRealProduction() — exported for all callers
// ---------------------------------------------------------------------------
//
// Previously, the pattern
//   NODE_ENV === "production" && siteUrl.startsWith("https://") && !siteUrl.includes("localhost")
// was copy-pasted across five files (middleware.ts, lib/unsubscribe.ts,
// lib/rateLimit.ts, app/api/newsletter/route.ts, app/api/contact/route.ts)
// with slight variations.  Drift between copies is where subtle production
// misconfigurations arise — e.g. one file checks NEXT_PHASE, another doesn't.
//
// H-2 (previously patched) already simplified middleware.ts and unsubscribe.ts
// to throw on NODE_ENV === "production" unconditionally.  The remaining three
// locations (rateLimit.ts, newsletter, contact) use the heuristic for a
// different purpose — distinguishing real deployments from local dev for
// Upstash misconfiguration warnings — where the NEXT_PUBLIC_SITE_URL guard
// is still appropriate (we don't want to 503 on `next start` locally).
//
// This export centralises that heuristic so all remaining callers import one
// definition.  If the definition of "real production" changes (e.g. adding a
// staging URL pattern), only this file needs updating.
//
// Note: the H-2 fix in middleware.ts / unsubscribe.ts uses the simpler
// NODE_ENV === "production" directly because those checks guard secrets
// (throwing on any production process is correct behaviour).  This function
// is for the softer "warn or 503 if Upstash is missing" guards, where
// distinguishing a local `next start` from a real deployment is valuable.
export function isRealProduction(): boolean {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return (
    process.env.NODE_ENV === "production" &&
    siteUrl.startsWith("https://") &&
    !siteUrl.includes("localhost")
  );
}


// ---------------------------------------------------------------------------
// Required environment variables, validated lazily by getEnv() below.
//
// Scope: only the variables consumed by the Resend / welcome-email send path
// (app/api/newsletter/route.ts, app/api/contact/route.ts). DATABASE_URL is
// deliberately excluded — see the DB-4 comment in the file header above.
// ---------------------------------------------------------------------------
const REQUIRED_VARS = [
  "RESEND_API_KEY",
  "CONTACT_EMAIL",
  "RESEND_AUDIENCE_ID",
  // D-5: sender address for outbound email.  The domain in this value must be
  // verified in Resend before any email can be sent.  Keeping it in env rather
  // than hardcoded means the same codebase works for faulter.news, staging
  // subdomains, and white-label deployments without source changes.
  "RESEND_FROM_EMAIL",
  // CAN-SPAM §7704(a)(5): every commercial email must carry a valid physical
  // postal address.  Keeping this in env rather than hardcoded means the same
  // codebase works for any publisher without source changes, and the address
  // can be updated (e.g. office move) without a redeploy.
  // A P.O. box is acceptable under the statute.
  // Example: "Faulter Media, PO Box 1234, New York, NY 10001, USA"
  "POSTAL_ADDRESS",
] as const;

type RequiredVar = (typeof REQUIRED_VARS)[number];
type ValidatedEnv = Record<RequiredVar, string>;

let _cached: ValidatedEnv | null = null;

/**
 * Returns a validated, fully-typed env record.
 *
 * Throws a descriptive Error on the first call if any required variable is
 * absent.  Subsequent calls return the cached record without re-checking.
 *
 * Call this inside request handlers, not at module top-level, so that
 * `next build` can run without production secrets present in the environment.
 */
export function getEnv(): ValidatedEnv {
  if (_cached) return _cached;

  const missing: string[] = [];
  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}:\n` +
        missing.map((k) => `  • ${k}`).join("\n") +
        "\n\nSee .env.example for setup instructions."
    );
  }

  _cached = Object.fromEntries(
    REQUIRED_VARS.map((k) => [k, process.env[k] as string])
  ) as ValidatedEnv;

  return _cached;
}

// ─── DB-4: DATABASE_URL credential scrubber ──────────────────────────────────
//
// Defence-in-depth: some versions of the MongoDB driver embed the full
// connection string (including credentials) inside thrown Error messages —
// e.g. "connect ECONNREFUSED mongodb+srv://alice:s3cr3t@cluster/db".  If such
// an error propagates uncaught, Node.js writes it to stderr; if it is caught
// and forwarded to a logging service (Sentry, Datadog, CloudWatch), the
// credentials appear in the log entry.
//
// The filter below intercepts uncaught exceptions and caught promise rejections
// before Node's default handler writes them, strips DATABASE_URL from the
// message and stack, then re-emits a sanitised version.
//
// It runs only in non-Edge runtimes (process is not defined on the Edge) and
// only once, guarded by a module-level flag.
//
// NOTE: This is installed once when lib/env.ts is first imported.  It must be
// imported before any MongoDB connection is opened — the `import { getEnv }
// from "@/lib/env"` in each API route satisfies this ordering.
//
// ⚠️  This filter handles the last-resort case.  The primary defence is
// lib/db.ts, which catches MongoClient errors and strips credentials before
// re-throwing.  Both layers together ensure credentials do not leak.

let _credentialFilterInstalled = false;

/**
 * Replaces all occurrences of the DATABASE_URL value in a string with a
 * redacted placeholder.  Exported for unit-testing; not intended for direct
 * use in application code.
 */
export function scrubDatabaseUrl(input: string): string {
  const uri = process.env.DATABASE_URL;
  if (!uri || !input.includes(uri)) return input;
  return input.split(uri).join("[DATABASE_URL redacted]");
}

/**
 * Installs a one-time process-level filter that scrubs DATABASE_URL from
 * uncaught exception messages before they are written to stderr or forwarded
 * to an error tracking service.
 *
 * Called automatically when lib/env.ts is first imported.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function installCredentialFilter(): void {
  // Edge Runtime and test environments may not have `process.on`.
  if (_credentialFilterInstalled || typeof process === "undefined" || typeof process.on !== "function") {
    return;
  }
  _credentialFilterInstalled = true;

  // ⚠️  IMPORTANT: Node.js behaviour for 'uncaughtException':
  // If a handler is registered and does NOT call process.exit(), the process
  // SURVIVES the exception — Node considers it "handled".  For a sanitiser
  // whose sole job is to strip credentials before logging, that is wrong:
  // we want to preserve the crash, just with safe output.
  //
  // Correct pattern:
  //   1. Scrub credentials from the Error in place.
  //   2. Write the scrubbed message to stderr ourselves.
  //   3. Call process.exit(1) so the process still terminates.
  //
  // For 'unhandledRejection' the process may or may not crash depending on
  // the Node version and --unhandled-rejections flag.  We scrub and let
  // Node's default behaviour continue (no process.exit here, as the promise
  // rejection may be recoverable in some contexts).

  process.on("uncaughtException", (err: Error, origin: string) => {
    // Scrub credentials from message and stack before anything writes to stderr.
    const scrubbed = scrubDatabaseUrl(err.message);
    if (scrubbed !== err.message) {
      Object.defineProperty(err, "message", { value: scrubbed, writable: true });
      if (err.stack) {
        err.stack = scrubDatabaseUrl(err.stack);
      }
    }
    // Write the (now-safe) error to stderr, then exit.
    // We do this manually rather than re-throwing because re-throwing would
    // call this handler again, creating an infinite loop.
    process.stderr.write(`[env] Uncaught exception (${origin}): ${err.stack ?? err.message}\n`);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    if (reason instanceof Error) {
      const scrubbed = scrubDatabaseUrl(reason.message);
      if (scrubbed !== reason.message) {
        Object.defineProperty(reason, "message", { value: scrubbed, writable: true });
        if (reason.stack) {
          reason.stack = scrubDatabaseUrl(reason.stack);
        }
      }
    }
    // Do NOT call process.exit here — unhandledRejection may come from a
    // promise that Node would otherwise handle via its own rejection tracking.
    // Let Node's default behaviour (warning or exit depending on version/flags)
    // proceed with the now-scrubbed reason.
  });
}

// Auto-install when this module is first imported.
installCredentialFilter();

// ---------------------------------------------------------------------------
// L-8 fix (updated): eager startup validation — security-critical vars throw
// in production; operational vars log-only in all environments.
// ---------------------------------------------------------------------------

/**
 * Validates that all security-sensitive and Resend-related environment
 * variables are present and non-empty.
 *
 * WHY: `getEnv()` defers validation to the first request, so a missing
 * RESEND_AUDIENCE_ID or RESEND_API_KEY will not surface until the first
 * newsletter signup attempt in production — potentially hours or days after
 * deployment, and only after a real user encounters the failure.
 *
 * This function is called once at startup (from getDb()'s startup hook) so
 * misconfigurations are visible in the deployment platform's log stream on
 * the very first warm request.
 *
 * ── Fail-closed for security-sensitive variables in production ───────────────
 * Some variables protect security boundaries: a missing TURNSTILE_SECRET_KEY
 * means Turnstile verification is silently skipped; a missing REVALIDATE_SECRET
 * means the revalidation endpoint is unauthenticated; a missing UNSUBSCRIBE_SECRET
 * means unsubscribe token verification is broken; a missing SEARCH_COOKIE_SECRET
 * means the rate-limit cookie cannot be signed or verified.
 *
 * In NODE_ENV === "production", any of these being absent throws immediately
 * so the deployment fails fast before real traffic reaches an insecure state.
 * In development the function logs a console.error warning and continues,
 * since these secrets are intentionally left unset locally.
 *
 * Non-security operational vars (Resend keys, addresses) always log-only —
 * a missing Resend key must not crash unrelated request handlers (e.g. article
 * pages), and the first affected user interaction makes the gap obvious enough.
 *
 * It is separate from `getEnv()` so the lazy-validation contract that
 * prevents `next build` failures (see module header) is preserved.
 */

/** Operational variables: missing → loud log but no throw (any environment). */
const WARN_ONLY_VARS: ReadonlyArray<string> = [
  "RESEND_API_KEY",
  "RESEND_AUDIENCE_ID",
  "CONTACT_EMAIL",
  "RESEND_FROM_EMAIL",
  "POSTAL_ADDRESS",
];

/**
 * Security-sensitive variables: missing in production → throw immediately.
 * In development, log a console.error warning and continue (local testing
 * does not require every secret to be provisioned).
 */
const SECURITY_CRITICAL_VARS: ReadonlyArray<string> = [
  "TURNSTILE_SECRET_KEY",   // missing → Turnstile bot-check is silently bypassed
  "REVALIDATE_SECRET",      // missing → /api/revalidate is unauthenticated
  "UNSUBSCRIBE_SECRET",     // missing → HMAC token signing/verification is broken
  "SEARCH_COOKIE_SECRET",   // missing → rate-limit cookie cannot be signed or verified
];

let _eagerValidationFired = false;

export function validateEnvEagerly(): void {
  if (_eagerValidationFired) return;
  _eagerValidationFired = true;

  const isProduction = process.env.NODE_ENV === "production";

  // ── Security-critical vars ─────────────────────────────────────────────────
  const missingSecrets = SECURITY_CRITICAL_VARS.filter((k) => !process.env[k]);
  if (missingSecrets.length > 0) {
    const message =
      `[env] STARTUP BLOCKED — missing security-critical environment variable${missingSecrets.length > 1 ? "s" : ""}:\n` +
      missingSecrets.map((k) => `  • ${k}`).join("\n") +
      "\n\n" +
      "  These variables protect security boundaries (bot protection, endpoint\n" +
      "  authentication, HMAC token signing).  Without them the application\n" +
      "  would start in an insecure state.\n" +
      "  Fix: add the missing variable(s) to your deployment secrets and redeploy.\n" +
      "  See .env.example for generation instructions.";

    if (isProduction) {
      // Hard-fail in production — do not allow the app to serve traffic in an
      // insecure state.  getDb() awaits this function, so the error propagates
      // to the first request handler and is visible in deployment logs.
      throw new Error(message);
    } else {
      // Warn-only in development — secrets are intentionally absent locally.
      console.error(message);
    }
  }

  // ── Operational (non-security) vars ───────────────────────────────────────
  const missingOps = WARN_ONLY_VARS.filter((k) => !process.env[k]);
  if (missingOps.length > 0) {
    console.error(
      `[env] STARTUP CONFIG WARNING — missing operational environment variable${missingOps.length > 1 ? "s" : ""}:\n` +
        missingOps.map((k) => `  • ${k}`).join("\n") +
        "\n\n" +
        "  Features depending on these variables will fail until they are set.\n" +
        "  See .env.example for setup instructions.\n" +
        "  Fix: add the missing variable(s) to your deployment secrets and redeploy."
    );
  }

  // ── MED-5 fix: trusted-IP-header startup assertion ─────────────────────────
  //
  // getClientIp() in lib/rateLimit.ts resolves the real client IP via one of
  // three mutually-exclusive strategies:
  //
  //   1. CF-Connecting-IP  — when TRUST_CLOUDFLARE=true
  //   2. x-real-ip         — when VERCEL=1 (set automatically by Vercel)
  //   3. x-real-ip / XFF   — when TRUST_PROXY=true (custom reverse proxy)
  //
  // If none of the three is set, getClientIp() returns "unknown" for every
  // request and collapses ALL per-IP rate-limit buckets into one.  In the
  // best case this makes limits effectively per-server; in the worst case a
  // single bad actor's requests share the same bucket as every legitimate
  // user, causing collateral blocking.
  //
  // lib/rateLimit.ts already logs a console.error at module load when it
  // detects this condition.  This check is placed HERE so it:
  //
  //   a) Fires once at startup through the same validateEnvEagerly() path
  //      that already surfaces missing TURNSTILE/REVALIDATE/etc. secrets.
  //   b) Throws in isRealProduction() (true HTTPS deployment with a non-
  //      localhost SITE_URL) — not just locally or in a Vercel Preview
  //      (which has VERCEL=1 set automatically, so always passes).
  //   c) Provides an actionable error message that points directly to the
  //      right env var for each deployment topology, matching the detail
  //      level of the .env.example comments.
  //
  // The throw is correct here because:
  //   • Vercel deployments: VERCEL is always set automatically — this check
  //     never fires for them unless someone unsets it deliberately.
  //   • Cloudflare-proxied deployments: TRUST_CLOUDFLARE=true must be
  //     set explicitly; if it's absent the operator has not finished setup.
  //   • Other proxies: TRUST_PROXY=true is the required explicit opt-in.
  //   • Local dev (isRealProduction() returns false): skipped entirely.
  //
  // NEXT_PHASE guard: suppressed during `next build` — env vars are injected
  // at deploy time, not build time, so the build step legitimately lacks them.
  if (
    isRealProduction() &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const trustCf    = process.env.TRUST_CLOUDFLARE === "true";
    const isVercel   = !!process.env.VERCEL;
    const trustProxy = process.env.TRUST_PROXY === "true";

    if (!trustCf && !isVercel && !trustProxy) {
      const msg =
        "[env] STARTUP BLOCKED — no trusted IP-header strategy is configured.\n" +
        "\n" +
        "  getClientIp() in lib/rateLimit.ts requires at least ONE of:\n" +
        "    • TRUST_CLOUDFLARE=true  — when all traffic transits Cloudflare\n" +
        "    • VERCEL=1               — set automatically by Vercel (no action needed)\n" +
        "    • TRUST_PROXY=true       — when a verified reverse proxy sets X-Real-IP\n" +
        "\n" +
        "  Without one of the above, every request resolves to IP \"unknown\",\n" +
        "  collapsing all IP-based rate limits (contact, newsletter, CSRF, search,\n" +
        "  revalidate, bookmarks) into a single shared bucket — either\n" +
        "  permanently ineffective or permanently blocking for all users.\n" +
        "\n" +
        "  Fix for your deployment topology:\n" +
        "    • Vercel:           VERCEL=1 is set automatically — confirm it is\n" +
        "                        present in your deployment environment.\n" +
        "    • Cloudflare proxy: set TRUST_CLOUDFLARE=true ONLY after confirming\n" +
        "                        all traffic transits Cloudflare (orange-cloud DNS).\n" +
        "    • Other proxy:      set TRUST_PROXY=true after confirming your proxy\n" +
        "                        overwrites X-Real-IP with the true client address.\n" +
        "\n" +
        "  See .env.example — TRUST_CLOUDFLARE / TRUST_PROXY sections for\n" +
        "  full prerequisites and security warnings before setting either flag.";

      if (isProduction) {
        throw new Error(msg);
      } else {
        console.error(msg);
      }
    }
  }
}

