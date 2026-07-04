#!/usr/bin/env node
/**
 * scripts/check-env.mjs
 *
 * M-1 fix: Pre-build environment variable validation.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * NEXT_PUBLIC_SITE_URL is consumed at build time (embedded into static HTML
 * via Next.js NEXT_PUBLIC_ inlining) AND at runtime (used by lib/site.ts to
 * generate sitemap <loc>, RSS <link>, canonical, and JSON-LD URLs).
 *
 * CI pipelines commonly inject secrets only at deploy time, not at build time.
 * If NEXT_PUBLIC_SITE_URL is absent during `next build`:
 *
 *   • absoluteUrl("/news/world/slug") → "/news/world/slug"  (relative, broken)
 *   • Sitemap <loc> tags emit relative paths → Google rejects them
 *   • RSS <link> elements emit relative paths → feed readers break
 *   • JSON-LD mainEntityOfPage["@id"] emits a relative URL → invalid schema.org
 *   • NEXT_PUBLIC_ inlining bakes "" into the JS bundle — even after setting
 *     the real URL at deploy time, the bundle still references the empty string
 *     (NEXT_PUBLIC_ vars are compile-time constants, not runtime lookups)
 *
 * The runtime guard in lib/site.ts (console.error) catches this after deploy,
 * but by then the baked bundle already contains empty strings. This script
 * fails the BUILD so the problem is caught before the artefact is produced.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 * This script runs as a `prebuild` step (see package.json). It does NOT run
 * during `next dev` or `next start` — only `next build`.
 *
 * ── CI usage ───────────────────────────────────────────────────────────────
 * Set NEXT_PUBLIC_SITE_URL in your CI environment BEFORE the build step:
 *
 *   # GitHub Actions example
 *   - name: Build
 *     env:
 *       NEXT_PUBLIC_SITE_URL: ${{ vars.SITE_URL }}   # repo variable, not secret
 *     run: npm run build
 *
 * NEXT_PUBLIC_SITE_URL is not a secret (it is embedded into the public JS
 * bundle). Store it as a plain repository variable, not a secret, so it is
 * available at build time without additional CI configuration.
 *
 * ── Validation rules ───────────────────────────────────────────────────────
 * 1. NEXT_PUBLIC_SITE_URL must be set (non-empty).
 *      • In production (NODE_ENV=production): hard failure — exits 1.
 *      • In development/staging: loud warning — exits 0 so local `npm run build`
 *        still works. The build produces a localhost:3000 artefact which is
 *        clearly broken for SEO/RSS/sitemaps, but that's acceptable locally.
 *        Add NEXT_PUBLIC_SITE_URL=http://localhost:3000 to .env.local to silence
 *        the warning and get a fully functional local build.
 * 2. It must be a valid URL (parseable by the URL constructor).
 * 3. It must use https:// in production (NODE_ENV=production).
 *    An http:// origin weakens the CSRF origin check in lib/csrf.ts.
 * 4. It must NOT have a trailing slash — absoluteUrl() concatenates the path
 *    directly, so a trailing slash produces double-slash URLs.
 *
 * Production failures exit with code 1. All other findings are warnings.
 */

// ── Load .env.local before reading process.env ───────────────────────────────
// Node.js does not auto-load .env.local — that is a Next.js feature that only
// kicks in during `next build` itself, which runs AFTER this prebuild script.
// Without this block, any variable that lives only in .env.local will appear
// missing here even though Next.js would find it moments later.
//
// Rules that match Next.js behaviour:
//   • Only loaded when the file actually exists (local dev / local builds).
//   • Variables already set in the shell (CI / Vercel inject) are NOT
//     overwritten — shell wins, file is a fallback.  This means CI pipelines
//     that set vars explicitly keep working unchanged.
//   • Blank lines and # comments are skipped.
//   • Values may be wrapped in single or double quotes; the quotes are stripped.
//   • Inline comments after the value (# …) are NOT stripped — same as
//     Next.js / dotenv behaviour: put comments on their own line.
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envLocalPath = resolve(__dirname, "..", ".env.local");

if (existsSync(envLocalPath)) {
  const lines = readFileSync(envLocalPath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;          // skip blanks & comments
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;                           // no `=` → not a var line
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double) — mirrors dotenv behaviour.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // Shell / CI value wins; .env.local is only a fallback.
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

const VAR = "NEXT_PUBLIC_SITE_URL";
const value = process.env[VAR];
const isProduction = process.env.NODE_ENV === "production";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Terminate the build with a formatted error message.
 *
 * @param {string} message   - The specific failure description (what went wrong
 *                             and why it matters). Each call site supplies its own
 *                             context-appropriate message so operators see exactly
 *                             which variable or condition failed — not a generic
 *                             NEXT_PUBLIC_SITE_URL hint that may be irrelevant.
 * @param {string} [fixHint] - Optional additional fix guidance to print after the
 *                             message. Pass this only when a short, universal fix
 *                             applies (e.g. "run openssl rand -hex 32"). Leave
 *                             undefined when the message itself already contains
 *                             the fix instructions (which is the common case —
 *                             each check's message block already documents the
 *                             exact remediation steps).
 */
function fail(message, fixHint) {
  console.error(`\n❌  Build blocked by check-env.mjs\n`);
  console.error(`  ${message}\n`);
  if (fixHint) {
    console.error(`  ${fixHint}\n`);
  }
  process.exit(1);
}

function warn(message) {
  console.warn(`\n⚠️   check-env.mjs warning: ${message}\n`);
}

// ── Check 1: variable must be set ───────────────────────────────────────────
if (!value) {
  const missing =
    `${VAR} is not set.\n` +
    `\n` +
    `  Without it:\n` +
    `    • absoluteUrl() returns relative paths (e.g. "/news/slug")\n` +
    `    • Sitemap <loc> tags emit relative paths → Google rejects them\n` +
    `    • RSS <link> elements emit relative paths → feed readers break\n` +
    `    • JSON-LD mainEntityOfPage["@id"] emits a relative URL → invalid\n` +
    `    • The CSRF origin check in lib/csrf.ts may fail for all form submissions\n` +
    `\n` +
    `  To silence this warning locally, add to .env.local:\n` +
    `    ${VAR}=http://localhost:3000`;

  if (isProduction) {
    // Hard failure in production — a missing URL bakes empty strings into the
    // JS bundle that cannot be fixed without a rebuild.
    fail(
      missing,
      `Fix: set ${VAR} in your CI environment BEFORE the build step.\n` +
      `       It must be the full public origin of this deployment, e.g.:\n` +
      `       ${VAR}=https://faulter.news\n` +
      `\n` +
      `       ${VAR} is a NEXT_PUBLIC_ variable — it is baked into the\n` +
      `       JS bundle at compile time.  Injecting it only at deploy time\n` +
      `       (after next build) has NO effect on the compiled artefact.`
    );
  } else {
    // Soft warning in development — the local build produces a localhost
    // artefact with broken SEO/RSS/sitemaps, but that is acceptable locally.
    // The production CI build will still hard-fail if the var is missing there.
    warn(
      missing + `\n\n` +
      `  Proceeding with a development build (NODE_ENV=${process.env.NODE_ENV ?? "unset"}).\n` +
      `  This warning becomes a hard failure when NODE_ENV=production.\n`
    );
    process.exit(0);
  }
}

// ── Check 2: must be a valid URL ─────────────────────────────────────────────
let parsed;
try {
  parsed = new URL(value);
} catch {
  fail(
    `${VAR} is not a valid URL.\n` +
    `  Current value: "${value}"\n` +
    `  Expected a full origin, e.g.: https://faulter.news`
  );
}

// ── Check 3: must use https:// in production ─────────────────────────────────
if (isProduction && parsed.protocol === "http:") {
  fail(
    `${VAR} is set to an http:// origin in a production build.\n` +
    `  Current value: "${value}"\n` +
    `\n` +
    `  In production all traffic must be served over HTTPS.\n` +
    `  The CSRF origin check in lib/csrf.ts uses this value to validate\n` +
    `  the Origin header on form submissions — an http:// origin weakens\n` +
    `  that check and exposes users to MitM attacks.\n` +
    `\n` +
    `  Update ${VAR} to use https://, and confirm that\n` +
    `  Cloudflare (or your reverse proxy) enforces HTTPS rewrites.`
  );
}

// ── Check 4: must not have a trailing slash ──────────────────────────────────
if (value.endsWith("/")) {
  // lib/site.ts strips the trailing slash at runtime, but baking a URL with a
  // trailing slash into the bundle is confusing and error-prone.  Fail the
  // build so the operator fixes the source rather than relying on the runtime
  // strip.
  fail(
    `${VAR} must not have a trailing slash.\n` +
    `  Current value: "${value}"\n` +
    `  Fix: remove the trailing slash → "${value.replace(/\/$/, "")}"`
  );
}

// ── Non-production http:// warning ───────────────────────────────────────────
// Allow http:// in development/staging but make it visible.
if (!isProduction && parsed.protocol === "http:" && !value.startsWith("http://localhost")) {
  warn(
    `${VAR} is set to a non-localhost http:// origin ("${value}").\n` +
    `  This is acceptable in staging but must be https:// in production.\n` +
    `  Ensure your deployment sets the correct https:// URL.`
  );
}

// ── Check 5: UPSTASH_CONFIGURED must be set in production ─────────
//
// M-1 fix: The in-process Map fallback for rate limiting fails silently on
// serverless platforms — each cold-start instance resets its own counter,
// making all per-IP rate limits (contact, newsletter, CSRF) completely
// ineffective. A spam burst before Upstash is configured can exhaust the
// Resend free tier (3,000 emails/month) in minutes.
//
// The runtime console.error in lib/rateLimit.ts fires AFTER the first
// request, and only if log monitoring is already set up. For traffic targets
// of 50k–100k it is too easy to miss.
//
// UPSTASH_CONFIGURED=true is a build-time sentinel. It must be
// set alongside the runtime UPSTASH_REDIS_REST_URL / _TOKEN variables, as a
// deliberate confirmation that Upstash is intentionally configured for this
// deployment. Setting it requires the operator to consciously confirm the
// credentials are present — it cannot be accidentally set without also setting
// the runtime credentials (which lib/rateLimit.ts validates at runtime).
//
// Why no NEXT_PUBLIC_ prefix?
//   This is a build-time prebuild script running in Node.js — process.env reads
//   any environment variable regardless of prefix.  NEXT_PUBLIC_ is only needed
//   for variables that must be inlined into the browser JS bundle.  This sentinel
//   has no value to client-side code: it is read only by this script at build time.
//   Giving it NEXT_PUBLIC_ would bake a "Upstash is configured: true/false" signal
//   into the client bundle, which is unnecessary information leakage to visitors.
//
// This variable does NOT need to contain the Upstash credentials themselves —
// it is only a flag. The actual URL/token remain server-side-only variables
// (no NEXT_PUBLIC_ prefix) so they are never embedded in the client bundle.
//
// To silence this check during local dev:
//   Add UPSTASH_CONFIGURED=true to .env.local
//   (only once UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are also set)

const UPSTASH_VAR = "UPSTASH_CONFIGURED";
const upstashConfigured = process.env[UPSTASH_VAR];

if (!upstashConfigured || upstashConfigured !== "true") {
  const message =
    `${UPSTASH_VAR} is not set to "true".\n` +
    `\n` +
    `  Without Upstash Redis configured, rate limiting silently falls back\n` +
    `  to an in-process Map that does NOT work on serverless platforms\n` +
    `  (Vercel, Netlify, Lambda, Fly.io with >1 replica):\n` +
    `    • Each cold-start instance resets its own counter independently\n` +
    `    • /api/contact, /api/newsletter, and /api/csrf are effectively uncapped\n` +
    `    • A single spam burst can exhaust the Resend free tier in minutes\n` +
    `\n` +
    `  Fix:\n` +
    `    1. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your\n` +
    `       deployment environment (get credentials at https://upstash.com).\n` +
    `    2. Set ${UPSTASH_VAR}=true in your BUILD environment\n` +
    `       (this is the deliberate confirmation that Upstash is configured).\n` +
    `\n` +
    `  To silence this check locally (single-process dev), add to .env.local:\n` +
    `    ${UPSTASH_VAR}=true\n` +
    `  (only once UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set)`;

  if (isProduction) {
    fail(message);
  } else {
    warn(
      message + `\n\n` +
      `  Proceeding with a development build (NODE_ENV=${process.env.NODE_ENV ?? "unset"}).\n` +
      `  This warning becomes a hard failure when NODE_ENV=production.\n`
    );
  }
}

// ── Check 6: UPSTASH_CONFIGURED=true requires the credentials ─────
//
// S-2 fix: The sentinel alone does not prove Upstash is working. A developer
// who sets UPSTASH_CONFIGURED=true in .env.local without also
// providing UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN silences the
// Check 5 warning while leaving rate limiting completely broken — lib/upstash.ts
// will fall back to the in-process Map just as if the sentinel were never set.
//
// This check catches that operator error at build time by verifying that when
// the sentinel is "true", both runtime credentials are also present in the
// environment. The credentials themselves are not validated for correctness
// (that would require a live network call); they are only checked for presence.
//
// Note: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN intentionally have
// no NEXT_PUBLIC_ prefix — they must NEVER be embedded in the client bundle.
// Only the boolean sentinel (UPSTASH_CONFIGURED) is baked in.

if (process.env[UPSTASH_VAR] === "true") {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    fail(
      `${UPSTASH_VAR} is true but the Upstash credentials are missing.\n` +
      `\n` +
      `  Both of the following must be set whenever ${UPSTASH_VAR}=true:\n` +
      `    • UPSTASH_REDIS_REST_URL   — the REST endpoint for your Upstash database\n` +
      `    • UPSTASH_REDIS_REST_TOKEN — the read/write token for that database\n` +
      `\n` +
      `  Without these credentials, lib/upstash.ts silently falls back to an\n` +
      `  in-process Map — the same broken behaviour the sentinel is meant to\n` +
      `  prevent.  Setting the sentinel without the credentials gives false\n` +
      `  confidence that rate limiting is active.\n` +
      `\n` +
      `  Fix (choose one):\n` +
      `    A) Add the missing credentials to your CI / deployment environment\n` +
      `       alongside ${UPSTASH_VAR}=true.\n` +
      `    B) Remove ${UPSTASH_VAR} from your environment\n` +
      `       (rate limiting will fall back to the in-process Map with a warning).`
    );
  }
}

// ── Check 7: server-only secrets required in production ──────────────────────
//
// H-4 fix: The prebuild script previously checked only NEXT_PUBLIC_SITE_URL
// and the Upstash sentinel.  Several server-only secrets have equally
// catastrophic failure modes when missing in production:
//
//   SEARCH_COOKIE_SECRET  — missing → throws on the FIRST /search request
//                           (middleware tries to sign a cookie with an empty
//                           key and the crypto call raises). Every search
//                           page load returns 500 until the secret is set.
//
//   UNSUBSCRIBE_SECRET    — missing → GET /api/unsubscribe returns 503 for
//                           ALL requests. No subscriber can unsubscribe, which
//                           is a GDPR Art. 17 (right to erasure) violation.
//
//   REVALIDATE_SECRET     — missing → CMS webhooks cannot invalidate the ISR
//                           cache. Article corrections take up to 60 minutes
//                           to reach readers — critical for breaking news.
//
//   TURNSTILE_SECRET_KEY  — missing → CAPTCHA verification is skipped for ALL
//                           contact and newsletter form submissions. Bots can
//                           flood both endpoints with no CAPTCHA friction.
//
//   DATABASE_URL          — missing → first request to any MongoDB-backed
//                           endpoint (newsletter, contact, unsubscribe) throws
//                           a connection error. All subscriber operations fail.
//
// These variables are NOT NEXT_PUBLIC_ — they must never be embedded in the
// client bundle.  They are only accessible to the server at runtime.  Using
// process.env here works because this script runs in a Node.js context during
// `next build`, where all environment variables (public and private) are
// visible to the build process.
//
// Note: this block checks for NON-EMPTY values, not correctness.  A wrong
// secret (e.g. the placeholder from .env.example) passes here but will fail
// at the first real request.  Replace all placeholder values before deploying.

const SERVER_ONLY_REQUIRED = [
  "SEARCH_COOKIE_SECRET",
  "UNSUBSCRIBE_SECRET",
  "REVALIDATE_SECRET",
  "TURNSTILE_SECRET_KEY",
  "DATABASE_URL",
  // CAN-SPAM §7704(a)(5): required in every commercial email.
  // Missing → welcome emails send without a postal address (CAN-SPAM violation).
  "POSTAL_ADDRESS",
  // Resend: required for all email delivery (contact form + newsletter).
  // Missing RESEND_API_KEY  → getResend() throws on first email send (502).
  // Missing RESEND_FROM_EMAIL → Resend rejects every send (domain_not_verified or missing From).
  // Missing RESEND_AUDIENCE_ID → newsletter contact creation fails (contacts.create throws).
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_AUDIENCE_ID",
  // Contact form destination: required by getEnv() alongside RESEND_API_KEY.
  // getEnv() validates ALL of REQUIRED_VARS atomically and throws if any is
  // missing — so a missing CONTACT_EMAIL breaks BOTH /api/contact AND
  // /api/newsletter (both call getResend() → getEnv() on their first request).
  // Missing CONTACT_EMAIL → both routes throw 500 on the first call; the
  // contact form cannot deliver submissions and newsletter signup fails.
  "CONTACT_EMAIL",
];

// ── Check 8: known .env.example placeholder values must not reach production ──
//
// check-env.mjs Check 7 verifies that required secrets are non-empty, but a
// developer who copies .env.example verbatim and deploys without replacing the
// placeholder values will pass that check while still running with completely
// insecure or non-functional secrets.
//
// This check detects the exact placeholder strings from .env.example and treats
// them as missing — a placeholder value is functionally equivalent to an absent
// value for security purposes.
//
// Only the cryptographic secrets are checked here; DATABASE_URL and Resend
// vars have obvious non-functional placeholder values (e.g. "re_xxx") that will
// fail at the first request anyway, and those failures are already clearly logged.
//
// This is a production-only hard failure — placeholder secrets in a staging
// or development build are intentional and expected.
const PLACEHOLDER_VALUES = new Map([
  ["SEARCH_COOKIE_SECRET",  "replace-with-openssl-rand-hex-32-output"],
  ["UNSUBSCRIBE_SECRET",    "replace-with-a-different-openssl-rand-hex-32-output"],
  ["REVALIDATE_SECRET",     "replace-with-openssl-rand-hex-32-output"],
  // L-3 fix: detect copied .env.example placeholder for LOG_IP_HASH_SECRET.
  // If an operator sets it but copies the placeholder value verbatim, the
  // coupling between UNSUBSCRIBE_SECRET and the IP-hash key is broken in
  // theory but not in practice (two "different" secrets happen to be identical).
  ["LOG_IP_HASH_SECRET",    "replace-with-yet-another-openssl-rand-hex-32-output"],
  // M-4 fix: POSTAL_ADDRESS has a readable placeholder in .env.example that
  // looks like a real address ("Faulter Media, PO Box 1234, New York, NY 10001, USA")
  // and therefore passes the empty-value check above.  An operator who copies
  // .env.example verbatim will deploy with the placeholder address in every
  // welcome email — which is both misleading and a CAN-SPAM §7704(a)(5) issue
  // because the listed address does not correspond to the actual publisher.
  // Treating the exact placeholder string as "missing" forces an explicit value.
  ["POSTAL_ADDRESS",        "Faulter Media, PO Box 1234, New York, NY 10001, USA"],
  // CONTACT_EMAIL has a realistic-looking placeholder in .env.example
  // ("editorial@faulter.news") that passes the empty-value check above.
  // A fork that copies .env.example verbatim will silently send all contact
  // form submissions to the original project's email address rather than the
  // operator's.  Treating the exact placeholder string as "missing" forces
  // an explicit address to be set.
  ["CONTACT_EMAIL",         "editorial@faulter.news"],
]);

if (isProduction) {
  const missing = SERVER_ONLY_REQUIRED.filter(
    (name) => !process.env[name] || process.env[name].trim() === ""
  );

  if (missing.length > 0) {
    fail(
      `The following required server-only secrets are not set:\n` +
      missing.map((name) => `    • ${name}`).join("\n") + `\n` +
      `\n` +
      `  Each missing variable causes a different production failure:\n` +
      `    • SEARCH_COOKIE_SECRET   — throws 500 on every /search request\n` +
      `    • UNSUBSCRIBE_SECRET     — returns 503 on all unsubscribe attempts (GDPR Art. 17 failure)\n` +
      `    • REVALIDATE_SECRET      — CMS webhooks cannot invalidate ISR cache (up to 60 min stale)\n` +
      `    • TURNSTILE_SECRET_KEY   — CAPTCHA silently disabled on all forms\n` +
      `    • DATABASE_URL           — all MongoDB-backed endpoints throw on first request\n` +
      `    • POSTAL_ADDRESS         — welcome emails send without a postal address (CAN-SPAM §7704(a)(5) violation)\n` +
      `    • RESEND_API_KEY         — all email delivery fails (contact form + newsletter welcome email)\n` +
      `    • RESEND_FROM_EMAIL      — Resend rejects every send (missing or unverified From address)\n` +
      `    • RESEND_AUDIENCE_ID     — newsletter contact creation fails on every subscription\n` +
      `    • CONTACT_EMAIL          — both /api/contact and /api/newsletter throw 500 on first request\n` +
      `\n` +
      `  Set each in your deployment environment before running the production build.\n` +
      `  See .env.example for the required format and generation instructions.`
    );
  }

  // Check for known placeholder values (operator copied .env.example verbatim).
  const placeholders = [];
  for (const [name, placeholder] of PLACEHOLDER_VALUES) {
    if (process.env[name] === placeholder) {
      placeholders.push(name);
    }
  }
  if (placeholders.length > 0) {
    fail(
      `The following variables are set to the .env.example placeholder values:\n` +
      placeholders.map((name) => `    • ${name}`).join("\n") + `\n` +
      `\n` +
      `  Placeholder values are not functional — deploying them is equivalent\n` +
      `  to not setting the variable at all.  Specific risks per variable:\n` +
      `    • SEARCH_COOKIE_SECRET / UNSUBSCRIBE_SECRET / REVALIDATE_SECRET\n` +
      `        Anyone who reads the public source can forge a signed cookie or\n` +
      `        token that matches the placeholder.\n` +
      `    • POSTAL_ADDRESS\n` +
      `        Welcome emails will carry a fictional address ("Faulter Media,\n` +
      `        PO Box 1234, …") — a CAN-SPAM §7704(a)(5) violation because the\n` +
      `        listed address does not belong to the actual publisher.\n` +
      `    • CONTACT_EMAIL\n` +
      `        Contact form submissions will be delivered to the placeholder\n` +
      `        address (editorial@faulter.news) instead of the operator's inbox.\n` +
      `\n` +
      `  For cryptographic secrets, generate real values:\n` +
      `    openssl rand -hex 32\n` +
      `  Use a different value for each secret.\n` +
      `  For POSTAL_ADDRESS, set your actual business mailing address.`
    );
  }
}


// ── Check 9: Atlas IP Access List confirmation (H-2 fix) ─────────────────────
//
// MongoDB Atlas clusters default to `0.0.0.0/0` (allow all IPs) on the free
// tier.  If this is not changed before launch, a leaked DATABASE_URL grants
// an attacker direct database access from anywhere on the internet — bypassing
// all application-layer authentication entirely.
//
// This is one of the most common causes of MongoDB data breaches.
//
// We cannot check the Atlas Network Access configuration from inside this
// script (that would require the Atlas Admin API), so we require an explicit
// acknowledgement from the operator: setting ATLAS_IP_RESTRICTED=true
// confirms that the cluster's IP Access List has been restricted to the
// application server's IP range (or the Vercel CIDR for Vercel deployments).
//
// ── How to configure Atlas Network Access ──────────────────────────────────
//
//   1. Log in to https://cloud.mongodb.com
//   2. Select your Project → Security → Network Access
//   3. Remove the `0.0.0.0/0` entry (if present)
//   4. Add your application server's public IP or CIDR range:
//        • Vercel: obtain the CIDR list from Vercel's deployment protection
//          docs and add each egress block individually.
//        • Self-hosted VPS / container: add the static egress IP of your server.
//        • Coolify / Railway / Render: check your platform's docs for
//          the egress IP range and add it here.
//   5. Confirm the change is saved and the cluster shows no `0.0.0.0/0` entry.
//   6. Set ATLAS_IP_RESTRICTED=true in your deployment environment.
//
// This is a production-only hard failure.  In development, DATABASE_URL
// commonly points to a local or unrestricted staging cluster — the warning
// is emitted but does not block the build.
//
// IMPORTANT: ATLAS_IP_RESTRICTED is a confirmation token, not a secret.
// It has no cryptographic value.  Its sole purpose is to force an explicit
// operator acknowledgement that the Atlas IP Access List has been reviewed
// and restricted.  Never treat it as a substitute for actually configuring
// the allowlist.

if (process.env.DATABASE_URL) {
  const atlasConfirmed = process.env.ATLAS_IP_RESTRICTED === "true";

  if (!atlasConfirmed) {
    const atlasMsg =
      `ATLAS_IP_RESTRICTED is not set to "true".\n` +
      `\n` +
      `  DATABASE_URL is configured but there is no confirmation that the\n` +
      `  MongoDB Atlas IP Access List has been restricted to the application\n` +
      `  server's IP range.\n` +
      `\n` +
      `  Risk: Atlas clusters default to 0.0.0.0/0 (allow all IPs).  If this\n` +
      `  is not changed, a leaked DATABASE_URL grants an attacker direct\n` +
      `  database access from anywhere on the internet — bypassing all\n` +
      `  application-layer authentication.  This is a leading cause of\n` +
      `  MongoDB data breaches.\n` +
      `\n` +
      `  Fix:\n` +
      `  1. Log in to https://cloud.mongodb.com → Security → Network Access\n` +
      `  2. Remove the 0.0.0.0/0 entry\n` +
      `  3. Add only your application server / Vercel egress IP range\n` +
      `  4. Set ATLAS_IP_RESTRICTED=true in your deployment environment\n` +
      `\n` +
      `  See README.md → "Atlas IP Access List" for platform-specific instructions.`;

    if (isProduction) {
      fail(atlasMsg);
    } else {
      warn(
        atlasMsg + `\n\n` +
        `  This is a hard failure in production (NODE_ENV=production).\n` +
        `  Current environment: NODE_ENV=${process.env.NODE_ENV ?? "unset"} — proceeding with warning.\n`
      );
    }
  }
}

// ── Check 10: LOG_IP_HASH_SECRET advisory (L-3 / L-7 fix) ───────────────────
//
// hashIp() in lib/rateLimit.ts HMAC-signs logged IP digests.  When
// LOG_IP_HASH_SECRET is unset it falls back to UNSUBSCRIBE_SECRET, coupling
// two unrelated concerns to the same secret value:
//
//   1. Signing one-click unsubscribe tokens (security-critical, user-facing).
//   2. Keying the IP hash used purely for log correlation (internal only).
//
// This coupling means that rotating UNSUBSCRIBE_SECRET (e.g. due to suspected
// exposure) immediately makes every previously-logged IP hash uncorrelatable
// with new ones — a disruptive operational side-effect with no relationship to
// the actual reason for rotation.
//
// Setting LOG_IP_HASH_SECRET decouples the two concerns so each can be rotated
// independently.  This is advisory — the fallback keeps the system functional
// without it — but operators should set it before launch to avoid the coupling
// becoming a surprise during a future incident response.
//
// This is not a hard failure: the system works correctly without it.  The
// warning is emitted in all environments (not just production) because the
// fix is cheap (one `openssl rand -hex 32`) and the coupling is permanent once
// log data is written.
if (!process.env.LOG_IP_HASH_SECRET) {
  warn(
    `LOG_IP_HASH_SECRET is not set.\n` +
    `\n` +
    `  hashIp() (lib/rateLimit.ts) is currently using UNSUBSCRIBE_SECRET as\n` +
    `  its HMAC key for log IP-hash correlation.  This couples two unrelated\n` +
    `  concerns to the same secret:\n` +
    `    • UNSUBSCRIBE_SECRET — signs user-facing one-click unsubscribe tokens\n` +
    `    • IP-hash key        — internal log-correlation digest only\n` +
    `\n` +
    `  If UNSUBSCRIBE_SECRET is ever rotated (e.g. suspected exposure), all\n` +
    `  previously-logged IP hashes immediately become uncorrelatable with new\n` +
    `  ones — an operational side-effect unrelated to the reason for rotation.\n` +
    `\n` +
    `  Fix (recommended before launch):\n` +
    `    Generate a dedicated secret:  openssl rand -hex 32\n` +
    `    Add to your deployment environment:  LOG_IP_HASH_SECRET=<value>\n` +
    `    Use a different value from UNSUBSCRIBE_SECRET.\n` +
    `\n` +
    `  The system functions correctly without this variable — this is advisory\n` +
    `  only.  See lib/rateLimit.ts (L-7 fix) and .env.example for details.`
  );
}

// ── Check 11: NEXT_PUBLIC_TURNSTILE_SITE_KEY required in production ───────────
//
// L-7 fix: TURNSTILE_SECRET_KEY (server-side) is already checked in
// Check 7 above, but its client-side counterpart — NEXT_PUBLIC_TURNSTILE_SITE_KEY
// — was never validated here.
//
// Why this matters:
//   The Turnstile widget is initialised client-side with the public site key:
//
//     <Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!} … />
//
//   If this variable is absent at build time, NEXT_PUBLIC_ inlining bakes
//   "" (empty string) into the JS bundle.  The widget silently fails to
//   initialise — no challenge is presented to the user.  From the server's
//   perspective the form body arrives with no `turnstileToken` field, which
//   causes verifyTurnstileToken() to return { success: false, errorCodes:
//   ["missing-input-response"] }, making ALL contact and newsletter form
//   submissions fail with 400 ("Invalid request.") for every user.
//
//   The failure mode is invisible unless you check the Network tab:
//     • No console error is emitted by the Turnstile widget (it never starts).
//     • The form's own error state shows a generic "Invalid request" message.
//     • Users have no way to recover — there is no retry path.
//
// Why a hard build failure (not just a warning):
//   • NEXT_PUBLIC_ variables are compile-time constants.  Setting this after
//     `next build` has no effect; the bundle already contains the empty string.
//   • Without it, every contact and newsletter form submission fails 100% of
//     the time — this is a complete user-facing outage on those forms.
//   • It is not a secret (it is intentionally public — embedded in the JS
//     bundle — and is designed to be visible to end users), so there is no
//     reason to omit it from the build environment.
//
// How to obtain the site key:
//   1. Sign in at https://dash.cloudflare.com → Turnstile
//   2. Create a widget for your domain (or use an existing one).
//   3. Copy the Site Key (the Secret Key goes into TURNSTILE_SECRET_KEY).
//   4. Add to your CI build environment:
//        NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAA...
//      This is a NEXT_PUBLIC_ variable — store it as a plain repo variable,
//      not a secret, and inject it at BUILD TIME (not only at deploy time).

if (isProduction && !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
  fail(
    `NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set.\n` +
    `\n` +
    `  The Cloudflare Turnstile widget requires this public site key to\n` +
    `  initialise client-side.  Without it:\n` +
    `    • The widget silently fails to render — no challenge is shown.\n` +
    `    • ALL contact and newsletter form submissions fail with 400\n` +
    `      ("Invalid request.") because no Turnstile token is ever generated.\n` +
    `    • Users have no way to recover — there is no retry path.\n` +
    `\n` +
    `  This is a NEXT_PUBLIC_ variable (intentionally public, not a secret).\n` +
    `  It MUST be present at BUILD TIME — setting it after \`next build\`\n` +
    `  has no effect because NEXT_PUBLIC_ values are baked into the JS bundle.\n` +
    `\n` +
    `  Fix:\n` +
    `  1. Sign in at https://dash.cloudflare.com → Turnstile\n` +
    `  2. Create or select your widget and copy the Site Key.\n` +
    `  3. Add to your CI build environment (not just deploy environment):\n` +
    `       NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAA...\n` +
    `  4. Ensure your deployment platform injects it before \`next build\` runs.\n` +
    `\n` +
    `  The corresponding server-side TURNSTILE_SECRET_KEY is checked in Check 7.`
  );
}

// ── Check 12: TURNSTILE_FAIL_OPEN must not be set in production builds ────────────
//
// L-5 fix: TURNSTILE_FAIL_OPEN=true causes ALL Cloudflare Turnstile API errors
// and network timeouts to resolve as { success: true }, effectively disabling
// CAPTCHA verification for the duration of any outage or misconfiguration.
//
// This is a legitimate short-term escape hatch during a Cloudflare incident,
// but it is dangerous left set permanently.  An operator who enables it during
// maintenance and forgets to remove it leaves /api/contact and /api/newsletter
// permanently unprotected against bot traffic.
//
// lib/turnstile.ts already emits a loud console.error on the first cold-start
// request in production.  That runtime warning fires AFTER the bad config has
// shipped.  This build-time check catches it BEFORE the artefact is produced,
// blocking the deployment entirely rather than relying on log monitoring.
//
// Why not also block non-production builds?
//   In development and staging, TURNSTILE_FAIL_OPEN=true is common and
//   intentional — developers set it to test form flows without needing a
//   real Turnstile site key or live Cloudflare account.  Blocking non-prod
//   builds would break the standard local dev workflow.  The lib/turnstile.ts
//   runtime warning already handles production deployments where the flag is
//   accidentally left set; this check adds a hard fail at the build layer.

if (isProduction && process.env.TURNSTILE_FAIL_OPEN === "true") {
  fail(
    `TURNSTILE_FAIL_OPEN=true is set in a production build.\n` +
    `\n` +
    `  This flag causes ALL Cloudflare Turnstile API errors and timeouts to\n` +
    `  resolve as { success: true }, which silently disables CAPTCHA verification\n` +
    `  on every contact and newsletter form submission.\n` +
    `\n` +
    `  TURNSTILE_FAIL_OPEN is intended as a short-term escape hatch during a\n` +
    `  real Cloudflare incident or planned maintenance window.  Leaving it set\n` +
    `  permanently — including across a production build — makes the flag\n` +
    `  indistinguishable from a forgotten misconfiguration.\n` +
    `\n` +
    `  Fix (choose one):\n` +
    `    A) Remove TURNSTILE_FAIL_OPEN from your deployment environment\n` +
    `       (recommended — the normal Turnstile flow should be restored once\n` +
    `       the incident that prompted the flag is resolved).\n` +
    `    B) Set TURNSTILE_FAIL_OPEN=false explicitly to make the intent clear.\n` +
    `\n` +
    `  If you intentionally need to deploy with CAPTCHA disabled (e.g. during\n` +
    `  an active Cloudflare incident), set NODE_ENV to a non-production value\n` +
    `  for that specific deployment — but be aware that this removes other\n` +
    `  production-only protections and should be treated as a last resort.\n` +
    `\n` +
    `  See lib/turnstile.ts (M-3 fix) for the runtime counterpart of this check.`
  );
}

// ── All checks passed ────────────────────────────────────────────────────────
console.log(`✅  env check passed — ${VAR}="${value}"`);
