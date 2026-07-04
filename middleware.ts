// No Node.js crypto import — globalThis.crypto (Web Crypto API) is available
// in the Edge Runtime that Next.js middleware runs in.
import { NextRequest, NextResponse } from "next/server";
// H-2 fix: server-side IP rate limit for /search (cookieless-request defence).
// Imported from rateLimitEdge (not rateLimit) because rateLimit.ts contains
// `import "server-only"` which throws in the Edge Runtime that middleware runs in.
import { checkSearchIpRateLimit, getClientIp } from "@/lib/rateLimitEdge";
// External-audit H-1 fix: the tiered "is this request HTTPS?" trust model
// now lives in lib/requestProtocol.ts (no `import "server-only"`, so it's
// safe in this Edge Runtime) and is shared with app/api/csrf/route.ts.
// Previously this logic was inline here only, and app/api/csrf/route.ts
// used an unrelated `process.env.NODE_ENV === "production"` check for the
// same purpose — see lib/requestProtocol.ts for why that was wrong and why
// a single shared implementation is required.
import { detectHttps } from "@/lib/requestProtocol";

/**
 * Security-headers middleware.
 *
 * CSP is relaxed in development (NODE_ENV !== "production") to allow
 * Next.js Fast Refresh (HMR), React hydration inline scripts, and
 * webpack eval — all of which are injected automatically by the framework
 * and cannot be avoided with a strict script-src in local dev.
 *
 * In production the full strict policy applies.
 */

/** Maximum search requests allowed per client per window. */
const SEARCH_LIMIT = 30;
/** Window duration in seconds. */
const SEARCH_WINDOW_S = 60;
const SEARCH_COOKIE = "rl_search";

// ---------------------------------------------------------------------------
// Signed-cookie helpers (C-1 fix)
//
// The rl_search cookie stores { t: timestamp, n: count } as plain JSON.
// Without a signature any scripted client can forge { t: <now>, n: 0 } on
// every request and bypass the rate-limit window entirely.
//
// We sign the JSON payload with HMAC-SHA256 using SEARCH_COOKIE_SECRET and
// store the cookie as `<base64url-payload>.<hex-signature>`.  The server
// re-derives the expected signature on every read and rejects mismatches,
// so a forged payload is detected before it is trusted.
//
// crypto.subtle.verify() is used for signature checking — it performs a
// constant-time comparison internally, preventing HMAC oracle timing attacks.
//
// Required env var:
//   SEARCH_COOKIE_SECRET — a 32-byte (256-bit) random secret.
//   Generate with:  openssl rand -hex 32
//   Add to .env.local for local dev and to your deployment secrets in prod.
// ---------------------------------------------------------------------------

/** Guards the one-time SEARCH_COOKIE_SECRET warning so it only logs once. */
let _cookieSecretWarnedOnce = false;

// HIGH-3 fix: module-level cache for the derived HMAC CryptoKey. Without
// this, getHmacKey() ran a full crypto.subtle.importKey() async round trip
// on every encodeCookie()/decodeCookie() call — i.e. on every single
// /api/search request that passes the IP rate limit (up to SEARCH_LIMIT
// requests per client per window). The secret comes from process.env and
// cannot change for the lifetime of this Edge instance, so the key derived
// from it is also constant — caching it once and reusing it for every
// subsequent request in this instance is safe and removes that unnecessary
// per-request crypto overhead.
let _hmacKey: CryptoKey | null = null;

/**
 * The placeholder value that ships in public source.  Anyone who reads the
 * repo can trivially forge a signed rl_search cookie that matches this value,
 * defeating the HMAC protection entirely.
 *
 * M-1 fix: We check for this literal at runtime — not just for the missing-var
 * case — so that a deployment which copies the string from source into its
 * environment variables is treated identically to one that omits the var.
 */
const _PLACEHOLDER_SECRET = "dev-insecure-placeholder-do-not-use-in-production";

function getCookieSecret(): string {
  const secret = process.env.SEARCH_COOKIE_SECRET;

  // H-2 fix: throw on NODE_ENV === "production" unconditionally — no
  // NEXT_PUBLIC_SITE_URL heuristic.  The previous heuristic allowed a staging
  // or preview deployment running NODE_ENV=production but without
  // NEXT_PUBLIC_SITE_URL to silently fall back to the well-known placeholder
  // string, letting anyone who has read the public source forge signed
  // rl_search cookies and bypass the search rate-limit on that environment.
  //
  // check-env.mjs already enforces NEXT_PUBLIC_SITE_URL at build time for
  // genuine production builds, so the two layers were redundant; the security
  // check should be the simpler and stricter one.
  //
  // Local dev: set NODE_ENV to "development" (Next.js default for `next dev`)
  // and the warning path is taken instead.  `next start` locally also sets
  // NODE_ENV=production, but that is a developer choice and the throw is the
  // correct behaviour there too — don't deploy without a real secret.
  if (!secret || secret === _PLACEHOLDER_SECRET) {
    if (process.env.NODE_ENV === "production") {
      // Any production process (real deployment OR staging with NODE_ENV=production)
      // without a real secret is a misconfiguration — throw loudly so the error
      // appears in the deployment platform's log stream on the very first
      // /search request.  The same error fires whether the var is absent OR is
      // set to the well-known placeholder string from the public source.
      throw new Error(
        !secret
          ? "SEARCH_COOKIE_SECRET is not set. " +
              "Generate one with `openssl rand -hex 32` and add it to your " +
              "deployment environment variables."
          : "SEARCH_COOKIE_SECRET is set to the insecure placeholder value " +
              "from the public source. Generate a real secret with " +
              "`openssl rand -hex 32` and replace the placeholder in your " +
              "deployment environment variables."
      );
    }

    // Non-production (NODE_ENV !== "production") — warn once per process and
    // continue.  The placeholder is intentionally weak; it must never reach
    // any production or staging environment.
    if (!_cookieSecretWarnedOnce) {
      _cookieSecretWarnedOnce = true;
      console.error(
        "[middleware] SEARCH_COOKIE_SECRET is not set (or is the insecure " +
        "placeholder). Using an insecure fallback — DO NOT deploy without a " +
        "real secret. Generate one with: openssl rand -hex 32"
      );
    }
    return _PLACEHOLDER_SECRET;
  }

  return secret;
}

/**
 * Import the secret as a CryptoKey for HMAC-SHA256 sign/verify.
 *
 * HIGH-3 fix: returns the module-level cached key (`_hmacKey`) after the
 * first successful import instead of re-importing on every call. This does
 * NOT change the production fail-closed behaviour in getCookieSecret(): if
 * the secret is absent or still the placeholder, getCookieSecret() throws
 * before _hmacKey is ever assigned, so that throw still fires on every call
 * until a real secret is configured — we only skip the importKey() round
 * trip once a real key has actually been derived.
 */
async function getHmacKey(): Promise<CryptoKey> {
  if (_hmacKey) return _hmacKey;
  _hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getCookieSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  return _hmacKey;
}

/** Convert an ArrayBuffer to a lowercase hex string. */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert a hex string to a Uint8Array<ArrayBuffer>.
 *
 * We construct the view from an explicit `new ArrayBuffer(n)` rather than
 * from an array literal.  TypeScript 5 + @types/node ≥22 infers
 * `new Uint8Array(someArray)` as `Uint8Array<ArrayBufferLike>`, which is
 * incompatible with the `BufferSource` overload of `crypto.subtle.verify()`
 * (which requires `ArrayBufferView<ArrayBuffer>`).  Constructing from a
 * concrete `ArrayBuffer` gives TypeScript the narrower type it needs.
 */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/.{1,2}/g);
  if (!pairs || pairs.length * 2 !== hex.length) {
    return new Uint8Array(new ArrayBuffer(0));
  }
  const buf = new ArrayBuffer(pairs.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < pairs.length; i++) {
    arr[i] = parseInt(pairs[i], 16);
  }
  return arr;
}

/** Base64url-encode a plain string (Edge-safe, no Buffer). */
function base64urlEncode(str: string): string {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    )
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Base64url-decode to a plain string (Edge-safe, no Buffer). */
function base64urlDecode(str: string): string {
  const padded = str + "==".slice(0, (4 - (str.length % 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(
    atob(b64)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Encode a rate-limit state object into a signed cookie value.
 * Format: `<base64url-JSON>.<hex-HMAC>`
 */
async function encodeCookie(state: { t: number; n: number }): Promise<string> {
  const payload = base64urlEncode(JSON.stringify(state));
  const key = await getHmacKey();
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return `${payload}.${bufToHex(sigBuf)}`;
}

/**
 * Decode and verify a signed cookie value.
 * Returns the parsed state, or null if the value is missing, malformed,
 * or the signature does not match (i.e. the cookie was tampered with).
 *
 * crypto.subtle.verify() performs a constant-time comparison internally,
 * so this is safe against HMAC oracle timing attacks.
 */
async function decodeCookie(
  value: string
): Promise<{ t: number; n: number } | null> {
  const dotIndex = value.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payload = value.slice(0, dotIndex);
  const receivedHex = value.slice(dotIndex + 1);

  try {
    const receivedBytes = hexToBytes(receivedHex);
    if (receivedBytes.length === 0) return null;

    const key = await getHmacKey();
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      receivedBytes,
      new TextEncoder().encode(payload)
    );

    if (!isValid) return null;

    return JSON.parse(base64urlDecode(payload)) as { t: number; n: number };
  } catch {
    return null;
  }
}

async function enforceSearchRateLimit(
  request: NextRequest,
  response: NextResponse,
  isHttps: boolean
): Promise<NextResponse> {
  const cookie = request.cookies.get(SEARCH_COOKIE);
  const now = Math.floor(Date.now() / 1000);

  let count = 1;
  let windowStart = now;

  if (cookie?.value) {
    // decodeCookie returns null for any forged or malformed value — in that
    // case we simply start a fresh window rather than trusting the payload.
    const parsed = await decodeCookie(cookie.value);
    if (parsed !== null && now - parsed.t < SEARCH_WINDOW_S) {
      count = parsed.n + 1;
      windowStart = parsed.t;
    }
  }

  if (count > SEARCH_LIMIT) {
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: {
        "Retry-After": String(SEARCH_WINDOW_S - (now - windowStart)),
        "Content-Type": "text/plain",
      },
    });
  }

  // L-1 fix: SEARCH_WINDOW_S - (now - windowStart) can equal exactly 0 on the
  // expiry tick, producing maxAge: 0 which browsers interpret as "delete this
  // cookie immediately" (semantics of Max-Age=0). The next request then starts
  // a fresh window — correct behaviour — but the cookie deletion generates a
  // redundant Set-Cookie header. Clamping to at least 1 second avoids the
  // deletion-then-recreate churn without changing the effective window logic.
  const ttl = Math.max(1, SEARCH_WINDOW_S - (now - windowStart));
  const cookieValue = await encodeCookie({ t: windowStart, n: count });
  // `secure: true` over HTTP causes browsers to silently discard the cookie,
  // so the rate-limit counter resets to n=1 on every request in local dev.
  // Only set the Secure attribute in production where HTTPS is guaranteed.
  //
  // M-4 — sameSite: "lax" is correct for this cookie (not a security gap).
  //
  // The rl_search cookie is a rate-limit counter, not a session credential.
  // "lax" allows the cookie to be sent on top-level navigations originating
  // from another site (e.g. a user clicks a search link in a Google result),
  // which is the expected user journey — the counter should persist across
  // that navigation so the user doesn't silently lose their window progress.
  //
  // "strict" would drop the cookie on every cross-site top-level navigation,
  // resetting the rate-limit window to n=1 and making the per-client window
  // meaningless for the most common real-world entry path.
  //
  // The csrf_token cookie uses "strict" because it is a credential: a
  // cross-site POST that carries the cookie would bypass CSRF protection.
  // rl_search has no such risk — the worst a cross-site actor can do is
  // trigger the rate-limit check on behalf of the user, which is harmless.
  //
  // ⚠️  UPGRADE WARNING: if this cookie is ever used to store session state
  // or any value that grants privileges, change sameSite to "strict" and
  // re-evaluate the full cookie security model before shipping.
  //
  // M-1 fix: COOKIE-PRIVILEGE-CHECK sentinel — machine-readable gate.
  //
  // The ESLint no-restricted-syntax rule in .eslintrc.json requires this
  // sentinel comment to be present on any cookies.set() call that uses
  // SEARCH_COOKIE.  If a future developer changes this cookie to carry session
  // state or any privilege-granting data, the sentinel comment must be updated
  // to reflect the new security model, which will be visible in code review.
  //
  // COOKIE-PRIVILEGE-CHECK: rl_search carries no privileges.
  // Payload: { t: windowStart (Unix seconds), n: count (integer) }.
  // The HMAC signature protects integrity but the fields grant no access.
  // sameSite: "lax" is safe for a pure rate-limit counter.
  // Change to "strict" and update this comment if privilege-bearing data is added.
  response.cookies.set(SEARCH_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    maxAge: ttl,
    path: "/search",
  });

  return response;
}

export async function middleware(request: NextRequest) {
  // H-1 fix: SVG security headers for /article-images/* and /avatars/* are
  // enforced at the Cloudflare layer via cloudflare_ruleset.svg_security_headers
  // in infra/cloudflare/cache_rules.tf (http_response_headers_transform phase).
  // Those paths are excluded from the matcher below so middleware never runs for
  // them — applying headers here would be dead code.

  // M-8 fix: hard-block all /admin/* paths now, before any admin routes exist.
  //
  // WHY NOW (when there are no admin routes yet):
  //   If an admin panel is added at /admin/ in a future PR and this guard is
  //   not updated simultaneously, the panel is publicly accessible by default
  //   — Next.js has no built-in auth layer, and robots.txt only disallows
  //   crawlers (not browsers).  Adding the guard now means /admin/* is
  //   blocked at the edge from day zero; the developer adding the real admin
  //   panel will remove or replace this guard intentionally (they will see
  //   this comment) rather than accidentally shipping an unprotected route.
  //
  // WHAT IT RETURNS:
  //   404 (not 401 or 403).  Returning 404 avoids confirming that an admin
  //   surface exists at all, which is the correct security posture for a
  //   route that has no public API contract.  An attacker probing for /admin/
  //   sees the same response as any other non-existent path.
  //
  // ⚠️  CRITICAL — HOW TO REPLACE THIS WHEN ADDING A REAL ADMIN PANEL:
  //   Middleware auth IS NOT SUFFICIENT on its own for admin routes.
  //   Middleware runs at the edge and can be bypassed if a misconfiguration
  //   causes traffic to reach the origin directly (e.g. a misconfigured
  //   Cloudflare rule, a direct-to-origin IP leak, or a future edge bug).
  //
  //   Every /admin/* route handler MUST ALSO validate the session server-side
  //   inside the route itself — for example by checking a signed NextAuth JWT
  //   or a Clerk session cookie in the Server Component or API handler before
  //   rendering any admin UI or executing any privileged action.
  //
  //   The required pattern is BOTH:
  //     1. A middleware guard (edge — fast, first line of defence)
  //     2. A server-side auth check inside every /admin/* route (defence in depth)
  //
  //   Never ship admin routes that rely on middleware as their SOLE auth layer.
  //
  //   Replace this 404 return with a real auth check, redirect to /login on
  //   failure, and confirm that every /admin/* route handler also validates
  //   the session server-side before removing this block.
  //
  // NOTE: the middleware `matcher` in the config at the bottom of this file
  //   already runs for /admin/* paths — no matcher change is needed.
  if (request.nextUrl.pathname.startsWith("/admin")) {
    return new NextResponse(null, { status: 404 });
  }

  // C-1 fix: Only rate-limit /api/search — the endpoint that actually runs
  // searchArticles() and costs server resources.  The bare /search page is a
  // fully-static shell after the Finding-8 refactor; it does zero per-request
  // query work.
  //
  // The previous definition used startsWith("/search"), which matched the
  // static /search shell as well as /api/search.  That caused
  // enforceSearchRateLimit() to call response.cookies.set() (emitting a
  // Set-Cookie: rl_search=... header) on every GET /search response.
  //
  // Cloudflare's documented behaviour for "Set-Cookie present on a response
  // that is Eligible for cache" (which /search is, per cache_rules.tf
  // cache_eligible_public_routes + next.config.mjs Cache-Control:
  // public, s-maxage=86400) is: preserve Set-Cookie, do NOT cache, return
  // MISS every time — regardless of TTL values.  This put /search at a
  // permanent 0 % cache-hit ratio despite all the CDN wiring being correct.
  //
  // Fix: match only the query endpoint.  /api/search is already excluded from
  // Cloudflare HTML caching by the bypass_api_and_search rule in
  // cache_rules.tf, so setting a cookie there is safe and correct.
  // IP-level abuse protection for the /search page-load itself (if ever
  // needed) must live at the Cloudflare WAF/rate-limit layer — not as an
  // origin Set-Cookie — to avoid reintroducing this bug.
  const isSearch = request.nextUrl.pathname === "/api/search";
  // This middleware does not set Cache-Control, CDN-Cache-Control, or
  // Surrogate-Control headers — those are applied explicitly in
  // next.config.mjs's headers() function (D-2 fix / CDN-cache fix) for the
  // public, content-stable routes (home, article, news, author, archive,
  // about, privacy, terms):
  //
  //   Cache-Control     — consumed by browsers and Vercel's edge cache;
  //                       uses s-maxage so Vercel's own CDN stores the HTML.
  //   CDN-Cache-Control — consumed by Cloudflare; overrides the default
  //                       Cloudflare behaviour of NOT caching HTML, so pages
  //                       are stored at Cloudflare's edge PoPs without
  //                       requiring a manual Cache Rule in the dashboard.
  //   Surrogate-Control — consumed by Fastly, Varnish, and other RFC-compliant
  //                       reverse proxies; stripped before reaching browsers.
  //
  // next.config.mjs rules are applied by the Next.js response pipeline and
  // replayed by the CDN on cache hits, bypassing middleware entirely —
  // middleware only runs for cache misses at the edge.
  // M-3 fix: /category/[slug] and /tag/[slug] are NOT excluded from the
  // next.config.mjs cache rules any more. This comment used to say both
  // routes "still render dynamically" because they read searchParams for
  // sort/pagination — that read has since moved out of the Server Component
  // and into a "use client" child (CategoryArticleList / TagArticleList)
  // wrapped in <Suspense>, which keeps the Server Component itself
  // ISR-eligible (revalidate = 3600) and able to receive the
  // Cache-Control: public, s-maxage=3600 rule below. /search is the only
  // route that still reads searchParams server-side and remains excluded.
  //
  // /category/* and /archive previously had dedicated path-matching consts
  // here (isCategory, isArchive), used only to scope a
  // `Vary: Content-Security-Policy` response header. That header has been
  // removed (M-1 fix — see the Vary-header explanation in the "Resolution:
  // CSP is no longer request-specific" block below) because Vary partitions a cache by *request* headers,
  // and Content-Security-Policy is a header the server sets on the
  // *response* — it never appears on the incoming request, so the
  // directive had no effect regardless of path. Neither path needs
  // special-casing in this file any more.
  // L-8 fix: track API routes so we can set X-Robots-Tag below.
  // robots.txt already disallows /api/ for crawlers, but X-Robots-Tag is a
  // belt-and-suspenders server-side signal that is respected even when a
  // crawler ignores robots.txt.  It also prevents search engines from
  // indexing API error responses (400/429/500) that are accidentally fetched
  // by a link or a bookmark.
  const isApi = request.nextUrl.pathname.startsWith("/api/");

  // M-1 fix: Gate x-forwarded-proto trust on a verified proxy signal.
  //
  // PROBLEM (pre-fix):
  //   `isHttps` was derived from `x-forwarded-proto` unconditionally.  Any HTTP
  //   client — including one that bypasses Cloudflare and reaches the origin
  //   directly — can send `X-Forwarded-Proto: https` over a plain HTTP socket.
  //   That causes this middleware to:
  //     • Emit `Strict-Transport-Security` over HTTP (browsers ignore it, but
  //       it wastes a header and contradicts the connection reality).
  //     • Include `upgrade-insecure-requests` in the CSP — telling browsers to
  //       upgrade sub-resource loads to HTTPS when the page itself is plain HTTP,
  //       which causes every JS chunk / CSS / image to fail to load.
  //     • Set the `Secure` flag on the `rl_search` cookie.  A browser will never
  //       send a Secure cookie over HTTP, so the rate-limit window is never
  //       carried forward: the counter resets to n=1 on every request, making
  //       the per-client sliding window completely ineffective.
  //
  // FIX — tiered trust model, consistent with getClientIp(). Full tier-by-tier
  // rationale (Cloudflare / Vercel / TRUST_PROXY / socket-protocol fallback)
  // now lives in lib/requestProtocol.ts's detectHttps(), not here — see that
  // file. It was moved out of this file (external-audit H-1 fix) so that
  // app/api/csrf/route.ts can share the exact same trust logic for its
  // `csrf_token` cookie instead of using an unrelated NODE_ENV check, and so
  // the two cookies this file and that route set (`rl_search` and
  // `csrf_token`) can never disagree again about whether the current
  // request is HTTPS.
  const isHttps = detectHttps(request);

  // In development Next.js injects dozens of inline scripts and uses eval
  // for Fast Refresh / HMR.  A strict CSP breaks all of that, so we skip
  // it entirely in dev and let the browser run without restrictions locally.
  const isDev = process.env.NODE_ENV !== "production";

  // ── Non-request-specific CSP strategy ───────────────────────────────────
  //
  // This middleware used to call crypto.randomUUID() here on every request
  // and embed the result as a CSP nonce (`script-src 'nonce-<value>'`), with
  // the same value forwarded to app/layout.tsx via an `x-nonce` request
  // header so Next.js could stamp it onto inline hydration scripts.
  //
  // That made every response request-specific in two compounding ways:
  //   1. The nonce differs on every request, so the CSP response header is
  //      never byte-identical across requests for the same URL.
  //   2. Because app/layout.tsx had to call headers() to read the nonce, and
  //      headers() is a Next.js Dynamic API, its mere presence in the render
  //      tree forced EVERY route in the app to render dynamically (SSR on
  //      every request) — there was no static/ISR HTML for a CDN or Next's
  //      own Full Route Cache to serve in the first place.
  //
  // Both effects defeated edge caching for what is otherwise plain, stable
  // editorial content. The fix is below: script-src now uses 'unsafe-inline'
  // instead of a nonce, so the exact same CSP header (and the exact same
  // HTML, once app/layout.tsx and the individual pages stop calling
  // headers() for a nonce) can be served — and cached — for every visitor.
  //
  // Trade-off, stated plainly: 'unsafe-inline' is weaker than a correctly-
  // generated nonce against script-injection XSS. This app accepts that
  // trade-off in exchange for static/ISR rendering and shared-cache
  // eligibility on public pages. style-src already used 'unsafe-inline' for
  // the same reason Next.js's streaming SSR needs it (see below), so this
  // brings script-src in line with the same accepted posture rather than
  // introducing a new one.

  // L-3 fix: ad-network domains (Adsterra's highperformanceformat.com,
  // AdSense's pagead2.googlesyndication.com / googleads.g.doubleclick.net /
  // tpc.googlesyndication.com) were previously hardcoded into script-src,
  // img-src, and frame-src unconditionally — present in the CSP even when
  // NEXT_PUBLIC_AD_PROVIDER is "none" and no ad script is ever loaded.
  //
  // A static allow-list for origins your app does not currently load from is
  // unnecessary attack surface: if an XSS payload elsewhere on the page tries
  // to exfiltrate data or load a malicious script from one of these domains,
  // an unconditionally-present entry would let it through even though no ad
  // network is active. Gating this on the same env var that lib/ads/config.ts
  // already uses (getActiveProvider()) keeps the CSP honest about what the
  // running deployment actually does — same source of truth, not a duplicated
  // check that could drift out of sync.
  //
  // We read NEXT_PUBLIC_AD_PROVIDER directly here (middleware runs in the
  // Edge Runtime; lib/ads/config.ts's getActiveProvider() is safe to import
  // too, but mirroring the same env check here avoids pulling the ads config
  // module — with its AD_SLOTS map and placeholder-ID guard — into the
  // middleware bundle for a single boolean).
  const adsEnabled = (process.env.NEXT_PUBLIC_AD_PROVIDER ?? "none") !== "none";
  const adScriptSrc = adsEnabled
    ? " https://www.highperformanceformat.com https://pagead2.googlesyndication.com"
    : "";
  const adImgSrc = adsEnabled
    ? " https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net"
    : "";
  const adFrameSrc = adsEnabled
    ? " https://googleads.g.doubleclick.net https://tpc.googlesyndication.com"
    : "";

  let csp: string;

  if (isDev) {
    // Relaxed CSP in development — Next.js HMR and React Fast Refresh require
    // unsafe-inline and unsafe-eval which would defeat the purpose of having
    // a strict policy anyway.  Security headers still apply.
    //
    // Turnstile domains are included here so that local testing with a real
    // NEXT_PUBLIC_TURNSTILE_SITE_KEY works without CSP errors.  The widget
    // self-injects a <script> from challenges.cloudflare.com (script-src),
    // contacts that origin to complete the challenge (connect-src), and
    // renders inside an <iframe> from that same origin (frame-src).
    // Omitting these from the dev policy causes the exact same CSP violation
    // seen in production when the domains were absent — even though
    // unsafe-inline/unsafe-eval are present, an explicit allow-list for
    // external origins is still required.
    //
    // L-3 fix: ad domains (adScriptSrc/adImgSrc/adFrameSrc, computed above)
    // are appended only when adsEnabled — same gating as the production
    // branch below.
    //
    // HIGH-1 fix: `data:` was removed from img-src. Allowing data: URIs in
    // img-src lets any script running on the page (e.g. a successful XSS
    // payload) construct `new Image().src = "data:image/gif;base64,…"` and,
    // combined with blob:, convert sensitive page content into a Blob URL
    // and load it as an image — widening what an injected script can do with
    // page data even though data: itself never crosses the network. It is
    // also unnecessary here: all article images are served from same-origin
    // /article-images/*.svg and avatars from /avatars/*.svg — no component
    // creates inline data: images. blob: is kept for now (no current use,
    // but lower-risk and may be needed for future image-preview features).
    csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com${adScriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      `img-src 'self' blob:${adImgSrc}`,
      // ws/wss: HMR websocket; challenges.cloudflare.com: Turnstile challenge XHR
      "connect-src 'self' ws: wss: https://challenges.cloudflare.com",
      // Turnstile + (when enabled) AdSense iframes
      `frame-src 'self' https://challenges.cloudflare.com${adFrameSrc}`,
      "object-src 'none'",
      "frame-ancestors 'self'",
    ].join("; ");
  } else {
    // Production: static, non-request-specific strict policy.
    //
    // script-src uses 'unsafe-inline' (no nonce) so that Next.js 15's
    // per-request inline hydration scripts (React bootstrapping, chunk
    // manifests, server-action boundaries) are allowed to execute. Without
    // this, 'script-src self' alone would block them, because they are
    // injected as inline <script> tags rather than external .js files —
    // causing a blank screen on `npm start`. A nonce would also satisfy this
    // requirement, but only at the cost of making every response
    // request-specific (see the "non-request-specific CSP strategy" comment
    // above) — that cost is why this app no longer generates one.
    //
    // style-src keeps 'unsafe-inline' because Next.js App Router injects a
    // <style> tag per CSS chunk during streaming SSR, and Next.js does not
    // support per-element style nonces at the framework level. style-src and
    // script-src now share the same 'unsafe-inline' posture; this is a
    // consistent, deliberate trade-off in favor of static/ISR rendering and
    // shared-cache eligibility, not an oversight.
    //
    // H-2 fix (preserved): ReadingProgress and AuthorAvatar set CSS custom
    // properties via element.style.setProperty() in JS rather than HTML style=
    // attributes, so they work under 'unsafe-inline' style-src regardless.
    //
    // L-3 fix: ad domains (adScriptSrc/adImgSrc/adFrameSrc, computed above)
    // are appended only when NEXT_PUBLIC_AD_PROVIDER !== "none". When ads are
    // disabled these three directives now contain no ad-network origins at
    // all, instead of carrying dead allow-list entries for scripts/images/
    // frames the app never requests.
    //
    // HIGH-1 fix: `data:` was removed from img-src (see matching comment in
    // the dev branch above for the full rationale). Not needed in production
    // either — all article/avatar images are same-origin .svg files served
    // from /article-images/ and /avatars/.
    const cspDirectives = [
      "default-src 'self'",
      // D-2 fix: Cloudflare Turnstile self-injects a <script> from
      // challenges.cloudflare.com at widget initialisation time.  Without this
      // domain in script-src the widget script is blocked before it can render
      // and the onSuccess callback never fires, causing every form submission
      // to return 400 in production.
      `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${adScriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      `img-src 'self' blob:${adImgSrc}`,
      // D-2 fix: Turnstile completes the challenge via a fetch/XHR back to
      // challenges.cloudflare.com.  connect-src 'self' alone blocks this
      // request, keeping turnstileTokenRef.current permanently null and causing
      // verifyTurnstileToken() to return { success: false } for every submission.
      "connect-src 'self' https://challenges.cloudflare.com",
      // D-2 fix: The Turnstile widget renders inside an <iframe> loaded from
      // challenges.cloudflare.com.  Without frame-src this directive defaults
      // to default-src 'self', which blocks the iframe entirely — the widget
      // never initialises and no token is ever generated.
      // AdSense ad iframes (when enabled) are served from doubleclick.net and
      // googlesyndication.com — see adFrameSrc above.
      `frame-src 'self' https://challenges.cloudflare.com${adFrameSrc}`,
      "object-src 'none'",
      "frame-ancestors 'self'",
      // Always include upgrade-insecure-requests in production —
      // Cloudflare→Vercel is always HTTPS, and the directive is harmless
      // even on a theoretical HTTP request. Tying to NODE_ENV rather than
      // isHttps prevents a stale cached response (generated during an HTTP
      // health check) from being served to HTTPS browsers without the
      // directive, which could produce mixed-content warnings for sub-resources.
      ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
      // M-7 fix: collect CSP violation reports so injection attempts and
      // accidental breakage are visible in logs rather than silently swallowed.
      // The handler at /api/csp-report logs the violation server-side and
      // returns 204.  It intentionally accepts only application/csp-report
      // and applies its own rate limit so it cannot be used as a log-flood
      // vector.
      //
      // M-2 fix: emit both report-uri (CSP Level 2, universally supported) and
      // report-to (CSP Level 3 Reporting API, supported in Chrome/Edge) so that
      // browsers that have shipped the newer API use it while older browsers fall
      // back to report-uri.  The two directives coexist without conflict — a
      // browser that supports report-to ignores report-uri for CSP (per spec),
      // and one that only knows report-uri ignores report-to.
      // The Report-To header (set below with the other security headers) defines
      // the named endpoint group that the report-to directive refers to.
      "report-uri /api/csp-report",
      "report-to csp-endpoint",
    ];
    csp = cspDirectives.join("; ");
  }

  // No per-request header to forward to the layout any more — see the
  // "non-request-specific CSP strategy" comment above. app/layout.tsx makes
  // no Dynamic API calls, so NextResponse.next() needs no request-header
  // override here.
  const response = NextResponse.next();

  if (isSearch) {
    // H-2 fix: IP-based server-side cap — runs BEFORE the cookie check so
    // that cookieless clients (curl --no-cookie, scrapers) cannot bypass the
    // rate limit by simply omitting the rl_search cookie.  A client that
    // sends no cookie always starts at count=1 in enforceSearchRateLimit;
    // this guard is the only thing that closes that bypass today.
    const clientIp = getClientIp(request.headers);
    const ipAllowed = await checkSearchIpRateLimit(clientIp);
    if (!ipAllowed) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": "60",
          "Content-Type": "text/plain",
        },
      });
    }
    // Cookie-based check (existing, per-client window).
    const rlResult = await enforceSearchRateLimit(request, response, isHttps);
    if (rlResult.status === 429) return rlResult;
  }

  response.headers.set("X-Content-Type-Options", "nosniff");
  // L-3 fix: X-Frame-Options removed. The CSP `frame-ancestors 'self'`
  // directive (set in both the dev and production CSP blocks above) supersedes
  // X-Frame-Options in all browsers that support CSP Level 2 (every modern
  // browser since 2015). Sending both is redundant — frame-ancestors is more
  // expressive (supports multiple origins, nonce/hash values) and is the
  // current standard. Removing X-Frame-Options reduces response header size
  // by ~30 bytes per request with no loss of framing protection.
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // L-1: payment=() and usb=() added to block the Payment Request API and
  // WebUSB respectively.  Neither is used by this site; leaving them open
  // allows a future XSS payload or a malicious third-party script to invoke
  // the browser's payment sheet or enumerate USB devices without a further
  // header change.  Opting out now is zero-cost and closes that surface.
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=()"
  );
  // Only send HSTS on HTTPS — sending it over HTTP can lock users out
  if (isHttps) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }
  // D-4 fix: CSP is functionally inert on JSON responses — /api/* routes
  // never render HTML, so there is no script/style/frame surface for the
  // policy to constrain, and the header adds pure overhead to every API
  // response. isApi (computed above, near the X-Robots-Tag logic) is reused
  // here rather than re-deriving the path check.
  if (!isApi) {
    response.headers.set("Content-Security-Policy", csp);
  }

  // M-2 fix: Report-To header — defines the endpoint group referenced by the
  // CSP `report-to csp-endpoint` directive above.  Browsers that support the
  // Reporting API (Chrome, Edge) will POST violation reports to /api/csp-report
  // as application/reports+json.  The existing /api/csp-report handler accepts
  // both the legacy application/csp-report format and the newer reports+json
  // format, so no change to the handler is needed.
  //
  // max_age matches the HSTS max-age (2 years) so the browser does not need to
  // re-fetch this header frequently.  include_subdomains is omitted — we only
  // want reports from the main origin, not subdomains.
  response.headers.set(
    "Report-To",
    JSON.stringify({
      group: "csp-endpoint",
      max_age: 63072000,
      endpoints: [{ url: "/api/csp-report" }],
    })
  );

  // H-1 fix: emit a stricter Content-Security-Policy-Report-Only header in
  // production so that any future script-injection vector (CMS field rendered
  // without sanitisation, dangerouslySetInnerHTML outside the
  // sanitizeArticleContent() pipeline, or a third-party script compromise)
  // produces a CSP violation report at /api/csp-report *before* it can be
  // exploited — without breaking real users today.
  //
  // Why report-only rather than enforced?
  //   The enforced script-src must carry 'unsafe-inline' to allow Next.js 15's
  //   per-request inline hydration scripts (React bootstrapping, chunk
  //   manifests, server-action boundaries). Removing 'unsafe-inline' from the
  //   enforced policy without a nonce/hash strategy causes a blank screen on
  //   every page load. The report-only policy can be stricter than the enforced
  //   one — violations are reported but not blocked — so it acts as an early-
  //   warning sensor for the exact class of injection this trade-off leaves
  //   unprotected.
  //
  // What is stricter here vs. the enforced CSP:
  //   • script-src: 'unsafe-inline' removed — any injected inline <script> or
  //     inline event handler that would execute under the enforced policy is
  //     reported here. This is the H-1 signal: if CMS content or a new
  //     dangerouslySetInnerHTML call introduces an unintended inline script,
  //     a violation report lands at /api/csp-report before the code ships.
  //   • style-src: 'unsafe-inline' removed — surfaces inline <style> usage
  //     (Next.js App Router per-CSS-chunk tags, any future inline style=
  //     attributes) for the staged style-src tightening already documented in
  //     the L-5 comment history. ReadingProgress and AuthorAvatar already avoid
  //     inline style= via element.style.setProperty(), so violations here are
  //     expected only from the framework's streaming SSR chunks.
  //
  // Always emitted in production (not gated on an env var) because the
  // risk described in H-1 — XSS reaching the httpOnly:false csrf_token cookie
  // and forging CSRF-protected requests — becomes critical the moment any
  // CMS-sourced content reaches dangerouslySetInnerHTML, and that moment may
  // not be flagged explicitly during development. The report-only header costs
  // one string operation and one response header per request; that is
  // negligible and worthwhile as a permanent signal channel.
  //
  // In development the enforced CSP is already permissive (unsafe-eval,
  // unsafe-inline, no enforcement intent), so a report-only header there adds
  // no value and is skipped to avoid log noise from HMR/Fast Refresh scripts.
  // D-4 fix: same isApi exclusion as the enforced Content-Security-Policy
  // header above — this report-only policy exists to sense inline-script/
  // style injection in rendered HTML (see the H-1 rationale above), which
  // has no equivalent on a JSON-only /api/* response.
  if (!isDev && !isApi) {
    const reportOnlyCsp = csp
      .replace(
        `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${adScriptSrc}`,
        `script-src 'self' https://challenges.cloudflare.com${adScriptSrc}`
      )
      .replace("style-src 'self' 'unsafe-inline'", "style-src 'self'");
    response.headers.set("Content-Security-Policy-Report-Only", reportOnlyCsp);
  }

  // ── Resolution: CSP is no longer request-specific ──────────────────────────
  //
  // BACKGROUND (the problem this used to cause):
  //   This middleware previously generated a fresh cryptographic nonce per
  //   request and embedded it in two places — the Content-Security-Policy
  //   response header (`script-src 'nonce-X'`) and the HTML body (via
  //   app/layout.tsx's `<script nonce="X">`). A CDN or shared cache that
  //   stored one such response and replayed it to a second visitor would
  //   serve HTML containing nonce X alongside a CSP header generated fresh
  //   for that second request (`'nonce-Y'`, Y ≠ X). The mismatch causes the
  //   browser to block every nonce-protected inline script — a blank page or
  //   broken hydration on any cache hit. Worse, the nonce read also required
  //   app/layout.tsx to call headers() (a Next.js Dynamic API), which on its
  //   own forced every route in the render tree to render dynamically (SSR
  //   on every request) — there was no static/ISR HTML for a cache to serve
  //   in the first place, on any route in the app.
  //
  // THE FIX:
  //   script-src now uses 'unsafe-inline' instead of a per-request nonce (see
  //   the production CSP block above), and app/layout.tsx and the individual
  //   page components no longer call headers() to read one. The
  //   Content-Security-Policy header below is therefore byte-identical for
  //   every request to a given route in a given environment — there is
  //   nothing left for a shared cache to get out of sync. Public, stable
  //   editorial routes (home, article, news, author, archive, about,
  //   privacy, terms) no longer declare `dynamic = "force-dynamic"` and no
  //   longer call headers(), so Next.js can render them statically or via
  //   ISR, and a CDN sitting in front of this deployment can cache the
  //   resulting HTML + headers as a single, consistent unit.
  //
  //   This middleware does not set Cache-Control headers itself. The D-2 fix
  //   in next.config.mjs's headers() function now sets
  //   "public, s-maxage=3600, stale-while-revalidate=86400" for ISR routes
  //   and "public, s-maxage=31536000, stale-while-revalidate=86400" for
  //   static routes. M-3 fix: /category/[slug] and /tag/[slug] are now
  //   included in the s-maxage=3600 ISR group, not excluded — their
  //   sort/pagination searchParams read now lives in a Client Component, not
  //   the Server Component, so they no longer render per-request (see the
  //   note above). Finding 8 fix: /search is now a static Server Component
  //   (searchParams access removed, force-dynamic removed). All routes are
  //   now covered by next.config.mjs cache rules.
  //
  // M-1 fix (preserved): no `Vary: Content-Security-Policy` header is set
  // here. `Vary: <header-name>` tells a cache to partition stored responses
  // by the value of that header *on the incoming request* —
  // Content-Security-Policy is never a request header, it is only ever set
  // on the response, so there is nothing for a cache to vary on. No
  // real-world cache (Cloudflare, Varnish, Fastly, CloudFront) partitions on
  // a response header, so the directive would provide no protection of any
  // kind. (Contrast with app/api/csrf/route.ts's `Vary: Origin` — Origin *is*
  // a real request header, so that usage is correct.)

  // L-8 fix: prevent search engines from indexing API route responses.
  //
  // robots.txt already disallows /api/ for well-behaved crawlers, but
  // X-Robots-Tag is honoured even when robots.txt is ignored and applies
  // per-response rather than per-path pattern.  "noindex, nofollow" is
  // correct here: API responses are JSON/plain-text, not HTML pages with
  // valuable links to follow, so suppressing both indexing and link-following
  // for this class of response is safe and intentional.
  if (isApi) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}

export const config = {
  // Finding 9 fix: article-images/ and avatars/ are re-added to the exclusion
  // list so middleware never runs for these static SVG assets.
  //
  // WHY THIS IS NOW SAFE:
  //   The SVG security headers previously applied by the early-return branch at
  //   the top of middleware() should instead be set at the Cloudflare layer via
  //   a Transform Rule targeting /article-images/* and /avatars/*:
  //
  //     Rule: URI Path starts with /article-images/ OR starts with /avatars/
  //     Action: Set response headers
  //       X-Content-Type-Options: nosniff
  //       Content-Disposition: attachment
  //       X-Frame-Options: DENY
  //       Referrer-Policy: strict-origin-when-cross-origin
  //
  //   Applying these headers at the CDN layer is strictly better than doing so
  //   in middleware because:
  //     1. They are set on EVERY response — including cache hits — not just on
  //        the origin requests that bypass the cache on cold misses.
  //     2. Zero middleware execution cost: these static assets have 1-year
  //        immutable Cache-Control headers and are served from Cloudflare's
  //        edge cache on the overwhelming majority of requests. Middleware runs
  //        only on cold cache misses (new PoP warmup), so the prior overhead
  //        was already minimal — but excluding the paths eliminates it entirely.
  //     3. Defence-in-depth: a Cloudflare rule applies even if a configuration
  //        error causes the middleware to be skipped.
  //
  //   Deployed as cloudflare_ruleset.svg_security_headers in
  //   infra/cloudflare/cache_rules.tf (http_response_headers_transform phase).
  //   The middleware early-return branch (isStaticSvg) that previously attempted
  //   to set these headers has been removed — it was unreachable for these paths
  //   once the matcher excluded them, and all header enforcement is now handled
  //   at the Cloudflare layer.
  //
  // Excluded paths:
  //   _next/static      — Next.js compiled JS/CSS bundles (never user-supplied)
  //   _next/image       — Next.js image optimizer (sets its own headers
  //                       including Content-Disposition: attachment for SVGs)
  //   favicon           — browser favicon; no security concern
  //   icon.svg          — same as favicon
  //   site.webmanifest  — PWA manifest; no security concern
  //   robots.txt        — crawler directive; no security concern
  //   sitemap.xml       — XML sitemap; no security concern
  //   rss.xml           — RSS feed; no security concern
  //   sitemap.xsl       — XSLT stylesheet for sitemap rendering; no concern
  //   fonts/            — static woff2 font files; no security concern
  //   article-images/   — static SVGs; security headers via Cloudflare rule ↑
  //   avatars/          — static SVGs; security headers via Cloudflare rule ↑
  //   theme-init.js     — D-3 fix: blocking theme-init script. Single build-
  //                       time-committed file, not user-supplied content.
  //                       Headers set in next.config.mjs instead.
  matcher: [
    "/((?!_next/static|_next/image|favicon|icon\\.svg|site\\.webmanifest|robots\\.txt|sitemap\\.xml|rss\\.xml|sitemap\\.xsl|fonts/|article-images/|avatars/|theme-init\\.js).*)",
  ],
};
