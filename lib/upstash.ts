/**
 * lib/upstash.ts
 *
 * Shared Upstash Redis REST helpers.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Before H-1, `lib/rateLimit.ts` and `lib/rateLimitEdge.ts` both contained
 * identical copies of `hasUpstash`, `upstashIncr`, and `checkRateLimit`.
 * The duplication was forced by `rateLimit.ts` having `import "server-only"`,
 * which crashes in the Next.js Edge Runtime that `middleware.ts` runs in.
 * Every bug fix or logic change had to be applied twice.
 *
 * This file is the single source of truth for the Upstash REST logic.
 * It intentionally has NO `import "server-only"` so it can be imported by:
 *   • lib/rateLimit.ts   — Node.js API route handlers (adds server-only itself)
 *   • lib/rateLimitEdge.ts — Edge Runtime middleware (no server-only allowed)
 *
 * ── What lives here ─────────────────────────────────────────────────────────
 *   hasUpstash()    — credential presence check (evaluated once at import time)
 *   upstashIncr()   — atomic INCR + EXPIRE pipeline call
 *   checkRateLimit() — unified sliding-window rate limiter (Redis + Map fallback)
 *
 * ── What does NOT live here ─────────────────────────────────────────────────
 * The in-process Map store and the per-named-route exports
 * (checkContactRateLimit, checkNewsletterRateLimit, …) stay in rateLimit.ts
 * because they are Node-only concerns.  The Map fallback IS duplicated here
 * for the edge path because it is pure JS with no Node.js dependencies.
 *
 * ── H-3 fix: HTTPS enforcement ──────────────────────────────────────────────
 * `hasUpstash()` now validates that UPSTASH_REDIS_REST_URL starts with
 * `https://`.  If an operator sets it to `http://`, the Upstash REST bearer
 * token would be transmitted in cleartext, giving a network observer read/write
 * access to the rate-limit counters.
 *
 * Behaviour:
 *   • In production: logs a loud error and returns false (disables Upstash,
 *     falls back to in-process Map).  Does NOT throw — taking down every route
 *     that uses rate limiting is a worse outcome than degraded-mode limiting.
 *   • In development: logs a warning and continues.  Developers may point at
 *     a local Redis over http:// for quick testing.
 *
 * The check is performed once at module load (same as the credential check)
 * because env vars cannot change at runtime and the log line should appear
 * on first boot, not buried in per-request noise.
 */

// ---------------------------------------------------------------------------
// In-process fallback store (shared across both importers within one process)
// ---------------------------------------------------------------------------

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

// ---------------------------------------------------------------------------
// H-3 fix: HTTPS guard — evaluated once at module load
// ---------------------------------------------------------------------------

let _upstashAvailable: boolean | null = null;

/**
 * Returns true when Upstash credentials are present AND the URL uses HTTPS.
 * The result is cached after the first call — env vars don't change at runtime.
 */
export function hasUpstash(): boolean {
  if (_upstashAvailable !== null) return _upstashAvailable;

  const url = process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

  if (!url || !token) {
    // L-3 fix: make the missing-Upstash condition visible in production logs.
    // Without this, rate limiting silently falls back to a per-instance Map on
    // every cold start, providing no cross-instance protection on serverless
    // platforms (Vercel, Lambda). The Map resets on every cold start, so a
    // burst of requests spread across instances can exceed limits undetected.
    // console.error (not warn) so it surfaces in error-level log filters and
    // alerting dashboards without requiring operators to read source code.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[upstash] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set.\n" +
        "  Rate limiting is falling back to an in-process Map that resets on every\n" +
        "  cold start. On serverless platforms this provides no cross-instance\n" +
        "  protection — a burst spread across instances bypasses all limits.\n" +
        "  Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in your deployment\n" +
        "  environment. See .env.example for setup instructions."
      );
    }
    _upstashAvailable = false;
    return false;
  }

  // H-3 fix: reject plaintext URLs.
  // The Upstash REST token is a Bearer credential — transmitting it over HTTP
  // exposes it to any network observer between the deployment and Upstash.
  if (!url.startsWith("https://")) {
    const msg =
      "[upstash] MISCONFIGURATION: UPSTASH_REDIS_REST_URL does not use HTTPS.\n" +
      `  Current value starts with: "${url.slice(0, 12)}…"\n` +
      "  The Upstash REST token would be sent in cleartext, exposing it to\n" +
      "  any network observer.  Update UPSTASH_REDIS_REST_URL to start with\n" +
      "  https:// (e.g. https://your-db.upstash.io).\n" +
      "  Falling back to in-process Map rate limiting until this is fixed.";

    if (process.env.NODE_ENV === "production") {
      console.error(msg);
    } else {
      console.warn(msg);
    }

    _upstashAvailable = false;
    return false;
  }

  _upstashAvailable = true;
  return true;
}

// ---------------------------------------------------------------------------
// Upstash REST pipeline
// ---------------------------------------------------------------------------

/**
 * Calls the Upstash Redis REST API with a pipelined INCR + EXPIRE sequence.
 *
 * Pipeline semantics:
 *   1. INCR key                    — atomically increment counter; returns new value.
 *   2. EXPIRE key window NX        — set TTL only if the key has no existing expiry
 *                                    (i.e. only on the very first hit of a window).
 *                                    The NX flag is the critical detail: plain EXPIRE
 *                                    resets the TTL on every request, so a steady
 *                                    stream of traffic would push the window forward
 *                                    indefinitely and the limit would never trigger.
 *                                    NX locks the window at first-hit time, matching
 *                                    the fixed-window semantics used by the Map fallback.
 *
 * Upstash supports Redis 7+ commands including EXPIRE … NX via the REST pipeline.
 *
 * Returns the new counter value, or null on network / parse error.
 * Errors are logged but never thrown — a Redis outage degrades gracefully
 * (caller falls back to allowing the request).
 *
 * @param logPrefix - caller label for log lines, e.g. "[rateLimit]"
 */
export async function upstashIncr(
  key: string,
  windowSeconds: number,
  logPrefix = "[upstash]"
): Promise<number | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;

  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      // Explicitly opt out of any HTTP-level caching for this request.
      // The Next.js fetch cache and framework-level caching (e.g. a future
      // Next.js version that caches fetch() calls by default) must never
      // cache Upstash pipeline responses — each INCR must reach the Redis
      // server to be counted.  The current behaviour is correct without this
      // flag, but the explicit declaration makes the intent clear and guards
      // against a framework upgrade silently introducing caching.
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        // H-2 fix: NX means "set expiry only if key has no expiry yet".
        // Without NX, EXPIRE resets the TTL on every request, so a client
        // sending 29 req/min continuously never exhausts the window — the
        // 60-second clock restarts on every hit.  NX anchors the window at
        // the first increment, giving true fixed-window behaviour.
        ["EXPIRE", key, windowSeconds, "NX"],
      ]),
    });

    if (!res.ok) {
      console.error(`${logPrefix} Upstash pipeline HTTP ${res.status}`);
      return null;
    }

    // Response shape: [{ result: <incrValue> }, { result: 0|1 }]
    const data = (await res.json()) as Array<{ result: number; error?: string }>;
    const incrResult = data[0];
    if (incrResult?.error) {
      console.error(`${logPrefix} Upstash INCR error:`, incrResult.error);
      return null;
    }
    return typeof incrResult?.result === "number" ? incrResult.result : null;
  } catch (err) {
    console.error(
      `${logPrefix} Upstash fetch failed:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core rate-limit logic (shared between Node and Edge paths)
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter.
 * Returns true if the request is allowed, false if it should be rejected.
 *
 * When Upstash credentials are present (and HTTPS — see H-3), uses an atomic
 * Redis INCR + EXPIRE pipeline shared across all replicas / serverless instances.
 *
 * Falls back to an in-process Map when Upstash is not configured.  The Map
 * fallback prunes stale entries when it exceeds 10 000 keys to prevent
 * unbounded memory growth on long-running single-instance servers.
 *
 * Failure behaviour (fail-closed):
 *   When Upstash IS configured but the request fails (network error, bad token,
 *   Redis outage), the rate limiter returns FALSE (deny) rather than TRUE
 *   (allow).  Failing open would disable abuse protection precisely when the
 *   backend is unreachable — the window most likely to be targeted.  A brief
 *   denial of service during a Redis outage is a far better outcome than
 *   unlimited access to the contact, newsletter, revalidation, and error-report
 *   endpoints.
 *
 * @param logPrefix - caller label for log lines, e.g. "[rateLimit]"
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  logPrefix = "[upstash]"
): Promise<boolean> {
  if (hasUpstash()) {
    const windowSeconds = Math.ceil(windowMs / 1000);
    const count = await upstashIncr(key, windowSeconds, logPrefix);

    if (count === null) {
      // Upstash backend error — fail CLOSED to preserve abuse protection.
      // Failing open here would disable rate limiting during a Redis outage,
      // network partition, or misconfigured token — exactly when endpoints are
      // most vulnerable to abuse.  Log clearly so the operator can act.
      console.error(
        `${logPrefix} Upstash unavailable — failing CLOSED for key: ${key}. ` +
        "All requests for this key are denied until Redis recovers. " +
        "Check UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, and network connectivity."
      );
      return false;
    }

    return count <= limit;
  }

  // ── In-process Map fallback ──────────────────────────────────────────────
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });

    // H-5: Prune stale entries when the store gets large.
    //
    // The O(n) scan is acceptable up to ~10k entries (a few milliseconds),
    // but under a sustained flood of unique IPs (or a prolonged Upstash outage)
    // the Map can grow far beyond that — turning each subsequent request into a
    // progressively longer scan.
    //
    // Two-tier defence:
    //   1. Soft prune at 10k: iterate and delete entries whose window has
    //      expired.  This is the normal operating path and keeps memory bounded
    //      during ordinary traffic spikes.
    //   2. Hard evict at 50k: clear the entire Map.  At this size the O(n) scan
    //      itself would add meaningful per-request latency (5–25 ms), so it is
    //      better to accept a momentary "everyone gets one free request" reset
    //      than to let the scan compound under load.  This path should never be
    //      reached in production when Upstash is healthy — treat it as a
    //      last-resort safety valve and add an alertable log line so it is
    //      visible in monitoring.
    //
    // PRODUCTION PREREQUISITE: configure Upstash so this fallback Map is only
    // used during brief Upstash outages, not as the primary store.  A single
    // Node.js process cannot share rate-limit state across replicas or
    // serverless instances.
    if (store.size > 50_000) {
      console.error(
        "[upstash] In-process rate-limit store exceeded 50 000 entries — " +
          "performing full eviction.  This indicates either a sustained flood " +
          "of unique IPs or a prolonged Upstash outage.  Configure " +
          "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to avoid " +
          "relying on the in-process fallback in production."
      );
      store.clear();
    } else if (store.size > 10_000) {
      const cutoff = now - windowMs * 2;
      for (const [k, e] of store.entries()) {
        if (e.windowStart < cutoff) store.delete(k);
      }
    }

    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count += 1;
  return true;
}

// ---------------------------------------------------------------------------
// M-3 fix: fail-open rate limiter for the revalidate webhook endpoint
// ---------------------------------------------------------------------------

/**
 * checkRateLimitFailOpen — identical to checkRateLimit except that when Upstash
 * IS configured but a network error occurs, the request is ALLOWED (fail-open)
 * instead of denied (fail-closed).
 *
 * Use ONLY for the /api/revalidate endpoint, where:
 *   • The endpoint is already protected by a shared secret (REVALIDATE_SECRET),
 *     so the primary abuse vector (unauthenticated flooding) is blocked before
 *     rate-limiting is reached.
 *   • A transient Redis outage during a high-traffic article publish window
 *     must not silently block all CMS webhook deliveries with 429s, which
 *     would cause stale content to persist for up to one ISR cycle (3600 s).
 *   • The editorial impact of a missed rate-limit window is far lower than
 *     the editorial impact of silently failing to publish urgent corrections.
 *
 * For all other endpoints (contact, newsletter, csp-report, error-report)
 * use checkRateLimit — those face unauthenticated callers and must remain
 * fail-closed.
 *
 * Failure behaviour:
 *   Upstash configured + network error  → log warning, return TRUE  (allow)
 *   Upstash configured + count OK       → return count <= limit
 *   Upstash not configured              → falls through to in-process Map
 */
export async function checkRateLimitFailOpen(
  key: string,
  limit: number,
  windowMs: number,
  logPrefix = "[upstash]"
): Promise<boolean> {
  if (hasUpstash()) {
    const windowSeconds = Math.ceil(windowMs / 1000);
    const count = await upstashIncr(key, windowSeconds, logPrefix);

    if (count === null) {
      // Upstash error on a secret-authenticated endpoint — fail OPEN.
      // A transient Redis outage must not block CMS webhook deliveries.
      // The shared secret still guards against unauthenticated callers.
      console.warn(
        `${logPrefix} Upstash unavailable — failing OPEN for key: ${key}. ` +
        "Request allowed despite Redis error because this endpoint is " +
        "secret-authenticated. Check UPSTASH_REDIS_REST_URL and connectivity."
      );
      return true;
    }

    return count <= limit;
  }

  // ── In-process Map fallback (identical to checkRateLimit) ────────────────
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });

    if (store.size > 50_000) {
      console.error(
        "[upstash] In-process rate-limit store exceeded 50 000 entries — " +
          "performing full eviction.  Configure Upstash to avoid relying on " +
          "the in-process fallback in production."
      );
      store.clear();
    } else if (store.size > 10_000) {
      const cutoff = now - windowMs * 2;
      for (const [k, e] of store.entries()) {
        if (e.windowStart < cutoff) store.delete(k);
      }
    }

    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count += 1;
  return true;
}
