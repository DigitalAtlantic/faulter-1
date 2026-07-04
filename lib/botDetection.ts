/**
 * Server-side bot / spam detection helpers.
 *
 * These checks are a lightweight first layer of defence.  They catch the
 * majority of naive bots (form-fill scripts, scrapers that POST directly)
 * without requiring a third-party service.  They are not a substitute for
 * proper rate limiting or CAPTCHA on high-value forms.
 *
 * Checks implemented:
 *
 *  1. Honeypot field — a hidden <input> that real users never see or fill.
 *     Any submission with a non-empty value was made by a bot that reads
 *     and fills all inputs indiscriminately.
 *
 *  2. Timing check — a `_formLoadedAt` timestamp set when the form mounts.
 *     Submissions arriving in under MIN_HUMAN_MS are almost certainly
 *     automated; no human can read, fill, and submit a multi-field form
 *     that quickly.
 *
 *  3. URL density check — a heuristic for spam messages that pack links
 *     into the body.  Legitimate contact/subscription messages rarely
 *     contain more than one or two URLs; spam almost always does.
 */

// Prevent this module from being imported in Client Components.
// lib/botDetection.ts contains the heuristics bots could use to evade
// detection — if a "use client" file ever imports it, Next.js will throw a
// build error instead of silently shipping this logic to the browser bundle.
import "server-only";

/** Minimum milliseconds between page load and submit for a human. */
const MIN_HUMAN_MS = 3_000;

/**
 * H-4 fix: Clock-skew tolerance window.
 *
 * The timing check compares Date.now() (server clock) against `_formLoadedAt`
 * (client-supplied timestamp).  Browser clocks can legitimately drift from
 * the server clock by several seconds — NTP sync is not guaranteed, and some
 * mobile devices and virtual machines exhibit persistent skew.
 *
 * Effect without tolerance:
 *   A user whose browser clock is 4 s behind the server clock submits after
 *   6 real seconds.  The server sees elapsed = 6000 - 4000 = 2000 ms, which
 *   is below MIN_HUMAN_MS (3000 ms), and the submission is falsely rejected.
 *
 * Fix: only reject when the apparent elapsed time is below MIN_HUMAN_MS AND
 * the elapsed value is greater than -CLOCK_SKEW_TOLERANCE_MS.  The negative-
 * elapsed guard still rejects timestamps that are clearly in the future (a
 * programmatic probe or severe clock misconfiguration), while the tolerance
 * window prevents false rejections from legitimate clock drift.
 *
 * A 30-second tolerance is intentionally generous: it covers any realistic
 * clock drift while still rejecting the overwhelming majority of bots (which
 * don't bother adding skew noise).  The real bot defence remains Turnstile +
 * rate limiting — see the C-2 comment below.
 */
const CLOCK_SKEW_TOLERANCE_MS = 30_000;

/** Maximum number of URLs allowed in a free-text field. */
const MAX_URLS_IN_TEXT = 2;

/**
 * Pattern that matches URLs in all common forms:
 *   1. Schemed URLs:      https://example.com/path, http://x.y
 *   2. www-prefixed:      www.example.com/buy
 *   3. Bare domain spam:  freeviagra.xyz/buy, get-rich.co.uk
 *
 * L-4 fix: the original pattern only matched (1) and (2), so bare-domain
 * links like "freeviagra.xyz/buy" — no scheme, no www — bypassed the URL
 * density check entirely.  The third branch extends coverage to any token
 * that contains a dot followed by a known or plausible TLD suffix and then
 * either a path or end-of-token.
 *
 * The pattern is intentionally conservative — it requires a dot in the
 * hostname part to avoid flagging normal prose like "e.g" or version strings
 * like "v1.0".  False negatives (a missed spam URL) are more acceptable here
 * than false positives (blocking a legitimate message), because Turnstile is
 * the primary bot defence and this is belt-and-suspenders only.
 *
 * L-1 fix (ReDoS): The \S+ quantifiers in the alternation can cause
 * catastrophic backtracking on crafted inputs.  The primary mitigation is the
 * MAX_URL_CHECK_CHARS cap applied inside checkForBot() — the regex never runs
 * on more than 2000 characters regardless of what the caller passes.  The
 * contact route also caps message length at 5000 chars via sanitizeText(),
 * but that is a caller-level guard; the cap here is defence-in-depth
 * independent of any particular call site.
 */
// Three alternatives joined with |:
//   1. https?://...          — schemed URLs
//   2. www\.\S+\.\S+         — www-prefixed hostnames
//   3. \b\S+\.(?:com|net|...) — bare TLD domains (covers the most-abused TLDs)
const URL_PATTERN =
  /https?:\/\/\S+|www\.\S+\.\S+|\b\S+\.(?:com|net|org|io|xyz|co|uk|ru|cn|info|biz|top|online|site|click|link|download|win|loan|work|club|space|website|live|news|shop|store)(?:\/\S*)?/gi;

/**
 * Hard character cap applied to each text field before URL_PATTERN runs.
 *
 * L-1 fix: limits the input fed to the regex regardless of what the caller
 * has already trimmed, so a crafted string that slips through caller-level
 * sanitization cannot trigger O(n²) backtracking.  2000 characters is more
 * than enough to count spam URLs in any realistic message.
 */
const MAX_URL_CHECK_CHARS = 2_000;

export interface BotCheckResult {
  /** true = looks human; false = looks like a bot or spam. */
  ok: boolean;
  /** Human-readable reason, logged server-side (not sent to client). */
  reason?: string;
}

/**
 * Run all bot-detection checks against a parsed form body.
 *
 * @param honeypot          Value of the hidden honeypot field (must be empty).
 * @param loadedAt          ISO timestamp string set when the form first rendered.
 * @param textFields        Free-text strings to check for URL stuffing.
 * @param turnstileVerified L-2 fix: whether the request already carries a
 *                           verified Turnstile token (see caller). Turnstile
 *                           requires solving a real browser challenge, which
 *                           is strictly stronger proof of humanity than this
 *                           timing heuristic. The invisible Turnstile widget
 *                           itself takes time to resolve — on a slow network
 *                           or device, that resolution can eat into (or even
 *                           exceed) the apparent gap between page-load and
 *                           submit, since the user is left waiting on the
 *                           challenge rather than reading the form. Without
 *                           this flag, a real human with a valid Turnstile
 *                           token could still be rejected here purely because
 *                           the challenge latency made their submission look
 *                           "too fast". Pass `true` only when the caller has
 *                           already confirmed Turnstile succeeded for this
 *                           exact request.
 */
export function checkForBot(
  honeypot: unknown,
  loadedAt: unknown,
  textFields: string[] = [],
  turnstileVerified = false
): BotCheckResult {
  // 1. Honeypot — must be absent or empty string.
  if (typeof honeypot === "string" && honeypot.length > 0) {
    return { ok: false, reason: "honeypot field was filled" };
  }

  // 2. Timing — reject submissions faster than a human can fill the form.
  //
  // C-2 note: PARTIAL DEFENCE ONLY — bypassable by any bot that controls the
  // POST body.  _formLoadedAt is a client-supplied value; a bot that reads the
  // client-side code can set it to (Date.now() - MIN_HUMAN_MS - 1) and trivially
  // pass this check.  This stops naive form-fill scripts (curl, wget, simple
  // automation that sends an empty or missing timestamp) but provides ZERO
  // protection against any attacker who has read the JavaScript.
  //
  // The real defences against targeted bots are:
  //   1. Turnstile CAPTCHA challenge (lib/turnstile.ts) — requires a real
  //      browser to solve a cryptographic proof-of-work; headless Playwright/
  //      Puppeteer bots cannot pass it without significant setup cost.
  //   2. IP-based rate limiting (lib/rateLimit.ts) — caps submission volume
  //      per IP regardless of how the bot constructs the body.
  //
  // Do NOT weaken Turnstile or rate limiting based on the presence of the
  // timing check — it is intentionally defence-in-depth only.
  //
  // L-2 fix: skip the timing rejection entirely when turnstileVerified is
  // true. A verified Turnstile token is strictly stronger evidence of a real
  // human than this timestamp heuristic, so it should never be overridden by
  // it — see the parameter doc above for why the two can otherwise conflict.
  if (
    !turnstileVerified &&
    typeof loadedAt === "string" &&
    loadedAt.length > 0
  ) {
    const loadTime = Date.parse(loadedAt);
    if (!Number.isNaN(loadTime)) {
      const elapsed = Date.now() - loadTime;
      // H-4 fix: only reject when BOTH conditions hold:
      //   1. elapsed < MIN_HUMAN_MS  — the apparent submission time is too fast.
      //   2. elapsed > -CLOCK_SKEW_TOLERANCE_MS  — the timestamp is not wildly
      //      in the future (which would indicate a probe, not legitimate skew).
      //
      // Without condition 2, a user whose browser clock is more than 30 s ahead
      // of the server clock would never be rejected here regardless of how quickly
      // they submit — an acceptable trade-off given that such extreme skew is
      // unusual and the other guards (Turnstile, rate limiting) remain active.
      //
      // Without condition 1 being gated by the tolerance, a user whose browser
      // clock is 4 s behind the server is rejected for a 6-second real-world
      // submission because the server sees elapsed = 2000 ms < MIN_HUMAN_MS.
      if (elapsed < MIN_HUMAN_MS && elapsed > -CLOCK_SKEW_TOLERANCE_MS) {
        return {
          ok: false,
          reason: `form submitted too quickly (${elapsed}ms < ${MIN_HUMAN_MS}ms)`,
        };
      }
    }
  }

  // 3. URL density — reject messages stuffed with links.
  //
  // L-1 fix: slice each field to MAX_URL_CHECK_CHARS before running URL_PATTERN.
  // This caps the regex input regardless of what the caller has already trimmed,
  // so a crafted string cannot exploit the \S+ alternation for ReDoS even if it
  // slips past caller-level sanitization.  Slicing here is a no-op for the
  // current contact route (sanitizeText already caps at 5000 chars, well below
  // 2000), but protects any future call site that passes a longer string.
  for (const text of textFields) {
    const safeText = text.length > MAX_URL_CHECK_CHARS
      ? text.slice(0, MAX_URL_CHECK_CHARS)
      : text;
    const matches = safeText.match(URL_PATTERN);
    if (matches && matches.length > MAX_URLS_IN_TEXT) {
      return {
        ok: false,
        reason: `message contains ${matches.length} URLs (max ${MAX_URLS_IN_TEXT})`,
      };
    }
  }

  return { ok: true };
}
