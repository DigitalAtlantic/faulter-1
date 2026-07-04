import { NextRequest, NextResponse } from "next/server";
import {
  generateCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_MAX_AGE,
} from "@/lib/csrf";
import { checkRateLimitCsrf, getClientIp } from "@/lib/rateLimit";
import { siteUrl } from "@/lib/site";
import { isRealProduction } from "@/lib/env";
import { hasUpstash } from "@/lib/upstash";
// External-audit H-1 fix: use the same request-level HTTPS detection that
// middleware.ts uses for the `rl_search` cookie, instead of
// `process.env.NODE_ENV === "production"`. NODE_ENV reflects the build mode,
// not the protocol of the request actually being served — a staging
// deployment can run with NODE_ENV=production while being served over plain
// HTTP (direct-to-origin health check, an HTTP-only staging URL, etc.). A
// `Secure` cookie sent over that connection is silently dropped by the
// browser, breaking the double-submit CSRF check for every user on that
// deployment. See lib/requestProtocol.ts for the full tiered-trust rationale.
import { detectHttps } from "@/lib/requestProtocol";

/**
 * GET /api/csrf
 *
 * Vends a fresh CSRF token to the client.
 *
 * Called by client-side forms (contact, newsletter) on mount via
 * `useCsrfToken()`.  The response:
 *   1. Sets a `csrf_token` cookie (SameSite=Strict; NOT HttpOnly so JS
 *      can read it for the double-submit pattern).
 *   2. Returns the same token in the JSON body so the client can include it
 *      as the `X-CSRF-Token` request header on form submissions.
 *
 * This endpoint is intentionally unauthenticated — it just hands out tokens.
 * The security guarantee comes from the cookie's SameSite=Strict attribute:
 * a cross-origin attacker cannot read our cookies and therefore cannot
 * reproduce the matching header + cookie pair.
 *
 * Cache-Control: no-store ensures proxies never cache a token intended for
 * one user and serve it to another.
 *
 * M-8 fix: CLOUDFLARE DEPLOYMENT REQUIREMENT
 * ───────────────────────────────────────────
 * This route sets `Cache-Control: no-store` in the response headers, but that
 * header alone is NOT sufficient if Cloudflare has a Cache Rule configured to
 * "Cache Everything" without a bypass for `/api/*`.
 *
 * In that scenario Cloudflare caches the CSRF token response at the edge,
 * and every user who hits that edge node receives the same stale token.
 * That token will have been set as a cookie in a different user's browser,
 * so the double-submit check will fail for all subsequent users — and worse,
 * if the stale token somehow matches a prior session's cookie, it could
 * permit CSRF forgery from a different session.
 *
 * REQUIRED CLOUDFLARE CONFIGURATION (one of the following):
 *   Option A — Add a Cache Rule in the Cloudflare dashboard:
 *     Match: (http.request.uri.path matches "^/api/") OR
 *            (http.request.uri.path matches "^/_next/")
 *     Action: Bypass cache
 *
 *   Option B — Use a Page Rule:
 *     URL pattern: example.com/api/*
 *     Setting: Cache Level → Bypass
 *
 *   Option C — Verify that the zone-level "Default Cache Behavior" does NOT
 *     include the "Cache Everything" override, and that no Cache Rule
 *     matches /api/* with a non-bypass action.
 *
 * Verify the setting is active by checking response headers on /api/csrf:
 *   curl -I https://your-domain.com/api/csrf
 *   # Must include: cf-cache-status: BYPASS  (not HIT or MISS)
 *
 * This is a deployment configuration concern, not a code issue.  The code
 * is correct; the CDN layer must be told to honour it.
 *
 * H-2 fix: rate-limited at 20 requests / IP / minute.  The contact and
 * newsletter forms each fetch one token on mount and never need to re-fetch
 * within the same page session, so 20 req/min is generous for any real user
 * while blocking automated token-farming and cheap DoS against this endpoint.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // H-1 fix: Hard-fail in production if Upstash Redis is not configured.
  //
  // Without Upstash the rate limiter falls back to an in-process Map that does
  // NOT share state across serverless instances.  On Vercel (or any platform
  // that runs multiple concurrent function instances) a bot that spreads
  // requests across N instances faces no practical limit — it can farm tokens
  // at effectively 20/min × N.
  //
  // The CSRF endpoint is the highest-value target for this failure mode:
  //   • It is explicitly documented as "intentionally unauthenticated."
  //   • Every form submission path depends on it — a DoS here takes down
  //     contact and newsletter as a side-effect.
  //   • Unlimited token farming is a prerequisite for any automated form
  //     submission attack against downstream endpoints.
  //
  // Returning 503 is preferable to silently issuing unthrottled tokens:
  //   503 is visible immediately in monitoring; silent farming is not.
  //   The operator can fix the environment and redeploy; users cannot work
  //   around a token farm silently consuming the quota of legitimate users.
  //
  // The guard mirrors the pattern in /api/contact and /api/newsletter.
  // isRealProduction() returns true only for NODE_ENV=production deployments
  // whose NEXT_PUBLIC_SITE_URL is a non-localhost https:// origin — local dev
  // with the in-process Map fallback is intentional and unaffected.
  if (isRealProduction() && !hasUpstash()) {
    console.error(
      "[csrf] MISCONFIGURATION: Upstash Redis is not configured.\n" +
      "  The CSRF token rate limit (20 req/IP/min) is ineffective on this deployment.\n" +
      "  Without shared state, a bot can farm tokens at 20/min × N serverless instances.\n" +
      "  Set UPSTASH_REDIS_REST_URL (https://) and UPSTASH_REDIS_REST_TOKEN\n" +
      "  in your deployment environment, then redeploy.\n" +
      "  Returning 503 until Upstash is configured."
    );
    return NextResponse.json(
      {
        error:
          "Service temporarily unavailable. " +
          "The CSRF token endpoint is not available until a " +
          "required configuration issue is resolved.",
      },
      { status: 503, headers: { "Retry-After": "3600" } }
    );
  }

  // H-2 fix: enforce per-IP rate limit before doing any work.
  const ip = getClientIp(request.headers);
  if (!await checkRateLimitCsrf(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const token = generateCsrfToken();

  // H-2 fix: explicit CORS policy on the CSRF token endpoint.
  //
  // The CSRF double-submit pattern relies on the SameSite=Strict cookie being
  // unreadable by cross-origin pages.  However, making the policy explicit in
  // the response headers provides a second layer and makes the intent legible:
  //
  //   • Access-Control-Allow-Origin is restricted to the site's own origin so
  //     a cross-origin fetch() of /api/csrf from a malicious page receives a
  //     CORS error and cannot read the token from the response body.
  //
  //   • Vary: Origin ensures that a shared/proxy cache (e.g. a misconfigured
  //     CDN that ignores Cache-Control: no-store) never serves a token with
  //     the wrong ACAO header to a different origin.
  //
  // HIGH-1 correction: previously re-read process.env.NEXT_PUBLIC_SITE_URL
  // directly on the (incorrect) assumption that this resolves differently
  // at "call time" than the cached `siteUrl` export from lib/site.ts. Both
  // are the same build-time-inlined value — see the HIGH-1 correction in
  // lib/unsubscribe.ts for the full explanation.
  //
  // Using `siteUrl` here also fixes a latent bug: the raw env var is not
  // guaranteed to be trailing-slash-stripped (an operator could set
  // NEXT_PUBLIC_SITE_URL="https://faulter.news/"), and a trailing slash in
  // Access-Control-Allow-Origin never matches a real browser Origin header
  // (Origin is scheme+host+port only, never a path). `siteUrl` strips the
  // trailing slash, so this header now matches correctly in that case too.
  //
  // M-2 fix: when siteOrigin is falsy (i.e. NEXT_PUBLIC_SITE_URL is absent,
  // which only happens in local dev without .env.local), we now set
  // Access-Control-Allow-Origin to the string "null" rather than omitting
  // the header entirely.
  //
  // Why "null" (the string) instead of omitting the header?
  //   The SameSite=Strict cookie is the primary CSRF guard in either case,
  //   but omitting Access-Control-Allow-Origin is a subtle trap: it does NOT
  //   produce a wildcard ("*") allow — it means the browser's CORS preflight
  //   gets no ACAO header and the cross-origin fetch() is blocked by the
  //   browser's same-origin policy. However, the response body (containing
  //   the token) is still readable in same-origin contexts and by any
  //   runtime that doesn't enforce CORS (e.g. curl, server-side fetch,
  //   certain older mobile webviews). Setting "null" makes the intent
  //   explicit and ensures the header is always present on the response,
  //   which is easier to audit and matches no real browser Origin header
  //   (browsers send "null" only for sandboxed iframes, not for first-party
  //   navigation — so cross-site fetches still get a CORS rejection).
  const siteOrigin = siteUrl;

  const corsHeaders: Record<string, string> = {
    "Cache-Control": "no-store",
    // M-2 fix: always emit Access-Control-Allow-Origin.
    // When siteOrigin is set: restrict to the known production origin.
    // When siteOrigin is empty (local dev without NEXT_PUBLIC_SITE_URL):
    //   use "null" — the string, not the absence of the header — so the
    //   response is never silently readable by an unintended cross-origin
    //   caller. "null" matches no real browser Origin and is safe as a
    //   fallback. See comment above for the full rationale.
    "Access-Control-Allow-Origin": siteOrigin || "null",
    "Vary": "Origin",
  };

  const response = NextResponse.json(
    { token },
    {
      status: 200,
      headers: corsHeaders,
    }
  );

  response.cookies.set(CSRF_COOKIE_NAME, token, {
    // H-5: httpOnly: false is INTENTIONAL — the double-submit pattern requires
    // JS to read this cookie and echo it as the X-CSRF-Token request header.
    //
    // Security contract: this design is only safe while same-origin XSS is
    // prevented. A same-origin XSS exploit can read this cookie and forge the
    // matching header. The current defence is the sanitize-html allowlist in
    // lib/sanitize.ts. Before adding any Markdown renderer, dangerouslySetInnerHTML
    // with unsanitized CMS content, or third-party embed scripts, read the
    // full XSS→CSRF escalation warning in lib/csrf.ts and evaluate whether
    // this cookie strategy is still appropriate.
    httpOnly: false,
    sameSite: "strict",
    // External-audit H-1 fix: was `process.env.NODE_ENV === "production"`.
    // That checked the build mode, not whether THIS request arrived over
    // HTTPS — the two are not equivalent (see the import comment above and
    // lib/requestProtocol.ts). detectHttps() uses the same tiered trust
    // model (Cloudflare / Vercel / TRUST_PROXY / socket-protocol fallback)
    // as the `rl_search` cookie in middleware.ts, so both cookies now agree
    // about the connection's protocol by construction instead of by luck.
    secure: detectHttps(request),
    maxAge: CSRF_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}
