// Strip any trailing slash from the env var so absoluteUrl never produces
// a double-slash (e.g. "https://faulter.news//about") when the operator
// sets NEXT_PUBLIC_SITE_URL="https://faulter.news/".
//
// M-8 fix: the previous code fell back to the hardcoded string
// "https://faulter.news" when NEXT_PUBLIC_SITE_URL was absent.  That caused
// staging / preview deployments that forget to set the variable to silently
// generate canonical URLs, sitemap entries, and RSS links pointing at the
// production domain — polluting production SEO signals and making the preview
// environment appear to be the live site.
//
// The fallback is now "http://localhost:3000" in development only.  In all
// other environments NEXT_PUBLIC_SITE_URL is required; if it is absent siteUrl
// will be the empty string, which is clearly broken and will surface
// immediately during QA rather than silently poisoning the production sitemap.
//
// M-1 fix: if siteUrl resolves to an http:// origin in production, the
// isValidOriginOrReferer() check in lib/csrf.ts will accept http:// Origins
// from potential MitM attackers.  Cloudflare normally enforces HTTPS rewrites
// so this is low-risk in the standard setup, but a misconfigured or direct-
// to-origin deployment could inadvertently allow it.  We emit a single
// console.error at module load so the issue is visible in logs immediately.
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "")
).replace(/\/$/, "");

// M-1 + M-8: production configuration guards.
//
// Each guard uses a module-level `let warned` flag so it fires at most once
// per worker process.  Next.js spawns several worker processes during
// `next build` for parallel static generation — without this flag the warning
// would print once per worker (4–8 times) for a single missing env var,
// making the build output noisy without adding diagnostic value.
//
// NEXT_PHASE guard: Next.js sets NEXT_PHASE=phase-production-build during
// `next build`. The missing-env warning is only actionable at runtime (when
// the app is actually serving requests), not during the build step where
// NEXT_PUBLIC_SITE_URL may be legitimately absent (e.g. CI builds that inject
// secrets only at deploy time). Skipping the warning during build keeps the
// output clean while still surfacing the misconfiguration on the first real
// request in a deployed environment.
//
// L-7 fix: typeof window === "undefined" guard.
// lib/site.ts is imported in both Server Components and Client Components
// (via absoluteUrl calls in metadata and links).  Without this guard the
// console.error calls fire in every user's browser DevTools console on the
// first module evaluation — leaking an internal misconfiguration message to
// the public and polluting the browser console with server-operator concerns.
// The guard restricts the check to the server/edge runtime (where
// window is undefined) so the warnings only appear in the deployment
// platform's server log stream where operators can act on them.
let _siteWarnedOnce = false;
if (
  typeof window === "undefined" &&
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !_siteWarnedOnce
) {
  _siteWarnedOnce = true;
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    console.error(
      "[site] MISCONFIGURATION: NEXT_PUBLIC_SITE_URL is not set.\n" +
      "  Canonical URLs, sitemap entries, RSS links, and CSRF origin checks\n" +
      "  will all be broken or empty.  Set NEXT_PUBLIC_SITE_URL to the full\n" +
      "  public origin of this deployment (e.g. https://faulter.news)."
    );
  } else if (siteUrl.startsWith("http://")) {
    console.error(
      "[site] MISCONFIGURATION: NEXT_PUBLIC_SITE_URL is set to an http:// origin\n" +
      "  (" + siteUrl + ").\n" +
      "  In production all traffic should be served over HTTPS.  The CSRF\n" +
      "  origin check in lib/csrf.ts uses this value to validate the Origin\n" +
      "  header on form submissions — an http:// origin weakens that check.\n" +
      "  Update NEXT_PUBLIC_SITE_URL to use https://, and confirm that\n" +
      "  Cloudflare (or your reverse proxy) enforces HTTPS rewrites."
    );
  }
}

/**
 * A validated URL object built from siteUrl, safe to pass to Next.js
 * `metadataBase`.
 *
 * When siteUrl is empty (i.e. NEXT_PUBLIC_SITE_URL is unset during
 * `next build`), we return a localhost URL instead of undefined.
 * Returning undefined causes Next.js to emit a noisy build warning:
 *   "metadataBase property in metadata export is not set …
 *    using http://localhost:3000"
 * By explicitly supplying the localhost URL ourselves we make the intent
 * clear, silence that warning, and keep the build output clean.
 * The [site] misconfiguration guard above still fires at runtime (not at
 * build time) to alert the operator when the real URL is missing in prod.
 */
export function safeMetadataBase(): URL {
  if (siteUrl) {
    try {
      return new URL(siteUrl);
    } catch {
      // Malformed URL — fall through to the localhost default below.
    }
  }
  // Build-time fallback: NEXT_PUBLIC_SITE_URL is unset (or malformed).
  // Explicitly returning localhost:3000 satisfies Next.js metadata
  // resolution and suppresses the "using http://localhost:3000" warning
  // that Next.js emits when metadataBase is undefined.
  return new URL("http://localhost:3000");
}

// Stable baseline date used by rss.xml (empty-articles fallback) and
// sitemap.xml (editorial page lastmod).  Defined once here so both route
// handlers always agree on the value — a constant defined in two places
// can silently drift when one is updated and the other is missed.
//
// Update this value manually after any meaningful content change to the
// static editorial pages (about, contact, privacy, terms).  Do NOT derive
// it from the clock or from ISR revalidation time — doing so would make
// lastmod/lastBuildDate non-deterministic across revalidation cycles,
// defeating conditional-GET caching for RSS readers and Googlebot alike.
export const SITE_LAUNCH_DATE = "2026-04-15";

// Cache-busting version for long-lived, non-hashed static assets served
// straight out of /public (theme-init.js, logo.png, icon.svg,
// site.webmanifest). next.config.mjs serves these with a 1-year immutable
// Cache-Control header, and unlike /_next/static/... they have no
// content hash in the filename — so without a version query string,
// updating one of these files leaves existing visitors (and any
// intermediate CDN cache) pinned to the old bytes for up to a year.
//
// Append this as `?v=${STATIC_ASSET_VERSION}` wherever one of the assets
// above is referenced. Bump the value whenever the underlying file's
// content changes; the value itself is opaque and does not need to follow
// any particular format (a date, semver, or incrementing integer all work).
export const STATIC_ASSET_VERSION = "1";

export const siteName = "Faulter";
export const siteDescription =
  "Faulter delivers trusted, in-depth reporting on global news, politics, business, technology, health, science, and more. Independent journalism you can rely on.";
export const siteHandle = "@Faulter";

export function absoluteUrl(path: string): string {
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
