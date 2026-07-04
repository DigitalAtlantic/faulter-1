/**
 * Cloudflare Turnstile — server-side token verification.
 *
 * Turnstile is an invisible CAPTCHA alternative that stops headless-browser
 * bots (Playwright, Puppeteer) that pass honeypot + timing + rate-limit
 * checks by rendering the page and waiting the minimum human delay.
 *
 * Setup (free, no user interaction required):
 *   1. Go to https://dash.cloudflare.com → Turnstile → Add site
 *   2. Choose "Invisible" widget type
 *   3. Add your domain (e.g. faulter.news)
 *   4. Copy the Site Key and Secret Key into your environment:
 *
 *      NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAA...   ← public, safe in JS
 *      TURNSTILE_SECRET_KEY=0x4AAAAAAA...             ← server-only, never expose
 *
 *   5. On the frontend, install the widget:
 *        npm install @marsidev/react-turnstile
 *      Then add to your contact and newsletter form components:
 *        import { Turnstile } from "@marsidev/react-turnstile";
 *        <Turnstile
 *          siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
 *          onSuccess={(token) => setTurnstileToken(token)}
 *          options={{ appearance: "execute", action: "contact" }}
 *        />
 *      Include `turnstileToken` in your POST body.
 *
 * If TURNSTILE_SECRET_KEY is not set (e.g. local dev), verification is
 * skipped and the function returns { success: true }.  Set it in production.
 *
 * ── M-2 fix: action binding (cross-endpoint replay) ─────────────────────────
 * verifyTurnstileToken() now requires an `expectedAction` argument (e.g.
 * "contact" or "newsletter"). The <Turnstile> widget on each form must set
 * the matching `action` option so the token Cloudflare issues carries that
 * label — verifyTurnstileToken() then checks it on the server side. This
 * stops a token solved on one form from being replayed against a different
 * endpoint that shares the same site key. See the action-mismatch block
 * inside verifyTurnstileToken() below for the full mechanism.
 *
 * ── M-3 fix: TURNSTILE_FAIL_OPEN=true startup warning ──────────────────────
 * Setting TURNSTILE_FAIL_OPEN=true causes all Turnstile API errors and network
 * failures to resolve as { success: true }, effectively disabling CAPTCHA for
 * the duration of any Cloudflare outage or misconfiguration.
 *
 * This is appropriate as a short-term escape hatch during a real Cloudflare
 * incident or planned maintenance window, but it is dangerous left set
 * indefinitely — an operator who sets it during maintenance and forgets to
 * remove it leaves the contact and newsletter endpoints permanently unprotected
 * against bots.
 *
 * The module-load warning below fires ONCE per cold start in production when
 * TURNSTILE_FAIL_OPEN=true is present.  Because it runs at module load time
 * (not per-request), it appears in the deployment platform's log stream on the
 * first request after deploy — impossible to miss without active log monitoring.
 *
 * Recommended usage pattern:
 *   1. Set TURNSTILE_FAIL_OPEN=true temporarily in your deployment environment.
 *   2. Verify the maintenance/incident is resolved.
 *   3. Remove TURNSTILE_FAIL_OPEN (or set it to "false") and redeploy.
 *
 * To auto-expire the flag, pair it with a timestamp sentinel:
 *   TURNSTILE_FAIL_OPEN=true
 *   TURNSTILE_FAIL_OPEN_UNTIL=2026-03-01T00:00:00Z   ← checked in the warning below
 * The warning will flag if the timestamp has passed, reminding you to clean up.
 */
import "server-only";

// ---------------------------------------------------------------------------
// M-3 fix: Module-load startup warning for TURNSTILE_FAIL_OPEN=true
// ---------------------------------------------------------------------------
//
// This runs ONCE at module import time (when the first API route that imports
// this module is cold-started).  It logs a loud error to stderr so the
// misconfiguration is immediately visible in:
//   • Vercel's Runtime Logs tab
//   • Railway / Fly.io / Render log streams
//   • Any log drain or alerting tool connected to stdout/stderr
//
// NEXT_PHASE guard: Next.js sets NEXT_PHASE=phase-production-build during
// `next build`.  The flag is meaningless at build time; suppress the warning
// so the build output stays clean.  The check fires on the first real request
// in the deployed environment.
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  process.env.TURNSTILE_FAIL_OPEN === "true"
) {
  // Check optional TURNSTILE_FAIL_OPEN_UNTIL timestamp sentinel.
  // If present and in the past, this is almost certainly a forgotten flag.
  const untilStr = process.env.TURNSTILE_FAIL_OPEN_UNTIL;
  let expiredSince = "";
  if (untilStr) {
    try {
      const until = new Date(untilStr);
      if (!Number.isNaN(until.getTime()) && until < new Date()) {
        const diffH = Math.round((Date.now() - until.getTime()) / 3_600_000);
        expiredSince = `\n  ⚠️  TURNSTILE_FAIL_OPEN_UNTIL was set to ${untilStr} — expired ${diffH}h ago.`;
      }
    } catch {
      // Malformed date — still log the primary warning.
    }
  }

  console.error(
    "[turnstile] SECURITY WARNING: TURNSTILE_FAIL_OPEN=true is set in production.\n" +
    "  All Turnstile API errors and network failures will resolve as success=true.\n" +
    "  CAPTCHA bot protection is DISABLED for the duration this flag is set.\n" +
    "  The /api/contact and /api/newsletter endpoints are unprotected against bots.\n" +
    (expiredSince ? expiredSince + "\n" : "") +
    "\n" +
    "  This flag is only appropriate as a short-term escape hatch during a\n" +
    "  real Cloudflare outage or planned maintenance window.\n" +
    "\n" +
    "  Action required:\n" +
    "    1. Remove TURNSTILE_FAIL_OPEN (or set it to \"false\") from your\n" +
    "       deployment environment variables.\n" +
    "    2. Remove TURNSTILE_FAIL_OPEN_UNTIL if present.\n" +
    "    3. Redeploy so the change takes effect.\n" +
    "\n" +
    "  If you are actively in a maintenance window and this is intentional,\n" +
    "  set TURNSTILE_FAIL_OPEN_UNTIL=<ISO-timestamp> to document when the\n" +
    "  flag should be removed (e.g. TURNSTILE_FAIL_OPEN_UNTIL=2026-03-01T00:00:00Z).\n" +
    "  This warning will re-fire with an expiry notice once that time has passed."
  );
}

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  /**
   * M-2 fix: the `action` value Cloudflare echoes back when the client-side
   * widget set one (via the `action` render option / `data-action`
   * attribute). Present only if the widget that generated the token set it.
   */
  action?: string;
}

/**
 * Verify a Turnstile challenge token submitted with a form.
 *
 * @param token - The `cf-turnstile-response` value from the form body.
 *                Pass null/undefined if the field was missing.
 * @param ip    - The client IP (from getClientIp()) for Cloudflare's
 *                risk scoring.  Forwarded but not required.
 * @param expectedAction - M-2 fix: the action label the *caller* expects
 *                this token to have been solved for (e.g. "contact" or
 *                "newsletter"). The corresponding <Turnstile> widget on the
 *                frontend must set the same value via its `action` render
 *                option / `data-action` attribute — that is what gets baked
 *                into the token when Cloudflare issues it.
 *
 *                Required (not optional) so a caller cannot forget to pass
 *                one and silently lose this protection. Every endpoint that
 *                calls this function MUST use a distinct action label.
 *
 * @returns `{ success: true }` when the token is valid (or when
 *          TURNSTILE_SECRET_KEY is unset in development).
 *          `{ success: false, errorCodes }` on failure — including
 *          `["action-mismatch"]` if the token was solved for a different
 *          action than `expectedAction` (see M-2 fix below).
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  ip: string,
  expectedAction: string
): Promise<{ success: boolean; errorCodes?: string[] }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // Skip verification in local dev when the secret is not configured.
  // Log a warning so developers know the check is inactive.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // Hard fail in production — a missing secret means CAPTCHA is silently
      // disabled, which is worse than a startup error.
      console.error(
        "[turnstile] TURNSTILE_SECRET_KEY is not set in production. " +
          "All Turnstile checks will FAIL. Add the secret key from the " +
          "Cloudflare Turnstile dashboard to your deployment environment."
      );
      return { success: false, errorCodes: ["missing-secret"] };
    }
    console.warn(
      "[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification in dev."
    );
    return { success: true };
  }

  if (!token) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  try {
    // Audit fix [M-5]: hard timeout so a slow or hung Cloudflare API does not
    // hold the route handler open indefinitely. 5 s is generous; the Turnstile
    // API normally responds in < 200 ms. On timeout the catch block below fires
    // and returns { success: true } (fail-open, same as other network errors).
    //
    // M-2 fix note: `action` is intentionally NOT included in this request
    // body. Cloudflare's siteverify API does not accept an `action`
    // parameter to validate against — secret, response, remoteip, and
    // idempotency_key are the only accepted fields. The action is instead
    // set once, client-side, when the token is issued (see the <Turnstile>
    // widget's `action` option), and Cloudflare echoes it back in the
    // response below, where it's checked against `expectedAction`.
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: ip !== "unknown" ? ip : undefined,
      }),
      // Turnstile tokens are single-use; a cached verification response could
      // silently pass a replayed or invalid token. Never cache this call.
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      // L-5 fix: Fail CLOSED in production on Turnstile API HTTP errors.
      //
      // Rationale: a deliberate or coincidental Cloudflare outage / network
      // partition should not silently disable CAPTCHA protection for the full
      // duration of the incident.  In production, failing closed means form
      // submissions are temporarily blocked, but that is a better outcome than
      // allowing unlimited bot traffic through while operators are unaware.
      //
      // In non-production environments we continue to fail open so that
      // developers and staging environments are not blocked by a missing or
      // unreachable Turnstile secret.
      //
      // Set TURNSTILE_FAIL_OPEN=true in your deployment environment to
      // explicitly opt in to fail-open behaviour in production (e.g. while
      // migrating traffic or during planned Cloudflare maintenance).
      const failOpen =
        process.env.NODE_ENV !== "production" ||
        process.env.TURNSTILE_FAIL_OPEN === "true";

      console.error(
        `[turnstile] ${failOpen ? "FAIL-OPEN" : "FAIL-CLOSED"}: Turnstile API HTTP error — ` +
          `${failOpen ? "bots may bypass CAPTCHA" : "form submissions blocked"}. ` +
          `Check Cloudflare status. (HTTP ${res.status})`
      );
      return { success: failOpen };
    }

    const data: TurnstileResponse = await res.json();

    // Audit fix [H-2]: validate that the token was completed on our own hostname.
    // Cloudflare includes the verified hostname in the API response. A token
    // solved on attacker.com (same site key, different domain) would otherwise
    // pass verification here and could be replayed against our endpoints.
    //
    // Only run the check when NEXT_PUBLIC_SITE_URL is a parseable https:// URL
    // (always true in production; may be absent or localhost in local dev).
    // If the URL cannot be parsed, skip the check rather than crashing —
    // the primary defences (rate limiting, honeypot) remain active.
    if (data.success && data.hostname) {
      try {
        const expectedHostname = new URL(
          process.env.NEXT_PUBLIC_SITE_URL ?? ""
        ).hostname;
        if (expectedHostname && data.hostname !== expectedHostname) {
          console.warn(
            `[turnstile] hostname mismatch — expected "${expectedHostname}", got "${data.hostname}"`
          );
          return { success: false, errorCodes: ["hostname-mismatch"] };
        }
      } catch {
        // NEXT_PUBLIC_SITE_URL is not a valid URL (e.g. empty in local dev).
        // Skip the hostname check; do not fail the verification.
      }
    }

    // ── M-2 fix: action binding — prevents cross-endpoint token replay ──────
    //
    // The contact and newsletter forms share the same Turnstile site key.
    // Without this check, a token solved on /contact could be POSTed
    // straight to /api/newsletter (or vice versa) and would pass
    // verification here, since siteverify only confirms the token is
    // genuine and unused — it says nothing about which form it was meant
    // for. A bot only has to pay the real challenge cost once and can then
    // try the same token against every endpoint that shares the site key,
    // racing Cloudflare's single-use enforcement.
    //
    // Cloudflare embeds an `action` value into the token at issuance time —
    // set client-side via the `action` render option / `data-action`
    // attribute on the <Turnstile> widget — and echoes it back here on
    // verification. (Note: `action` is NOT a siteverify *request* parameter;
    // Cloudflare's API does not accept one. It can only be set when the
    // token is created, so the binding is enforced by comparing the
    // `action` field in this *response* against what the caller expected.)
    //
    // `expectedAction` is a required parameter (see JSDoc above) — every
    // caller of this function must supply one, and every endpoint must use
    // a distinct label, so a token issued for one form can never verify
    // successfully against another.
    //
    // M-2 fix (enhanced): in production, the action field is now REQUIRED
    // to be present. The previous `data.action &&` guard let tokens issued
    // by a widget with no `action` option set (so Cloudflare returns no
    // `action` field) sail through unchecked — effectively falling back to
    // weaker defences (rate limiting, honeypot, hostname check) and allowing
    // cross-endpoint replay via a misconfigured or attacker-controlled widget
    // that deliberately omits the action option. In production, absent action
    // → hard reject. In non-production environments, absent-action tokens are
    // still accepted to avoid blocking local dev setups where the widget may
    // not be fully configured.
    if (data.success) {
      if (process.env.NODE_ENV === "production" && !data.action) {
        console.warn(
          `[turnstile] action absent — expected "${expectedAction}" but ` +
          `Cloudflare returned no action field. ` +
          `Ensure the <Turnstile> widget sets options={{ action: "${expectedAction}" }}.`
        );
        return { success: false, errorCodes: ["action-missing"] };
      }
      if (data.action && data.action !== expectedAction) {
        console.warn(
          `[turnstile] action mismatch — expected "${expectedAction}", got "${data.action}"`
        );
        return { success: false, errorCodes: ["action-mismatch"] };
      }
    }

    return {
      success: data.success,
      errorCodes: data["error-codes"],
    };
  } catch (err) {
    // L-5 fix: Fail CLOSED in production on network/timeout errors for the
    // same reason as the !res.ok branch above.  A transient DNS or TCP failure
    // to challenges.cloudflare.com during a real outage should not silently
    // disable CAPTCHA for the duration of the outage.
    //
    // Non-production environments and deployments with TURNSTILE_FAIL_OPEN=true
    // continue to fail open so developers are not blocked.
    const failOpen =
      process.env.NODE_ENV !== "production" ||
      process.env.TURNSTILE_FAIL_OPEN === "true";

    console.error(
      `[turnstile] ${failOpen ? "FAIL-OPEN" : "FAIL-CLOSED"}: Turnstile API unreachable — ` +
        `${failOpen ? "bots may bypass CAPTCHA" : "form submissions blocked"}. ` +
        `Check Cloudflare status. (${err instanceof Error ? err.message : String(err)})`
    );
    return { success: failOpen };
  }
}
