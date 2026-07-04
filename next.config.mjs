/** @type {import('next').NextConfig} */

// Build-time validation block — runs during `next build` only.
// Guards: NEXT_PUBLIC_SITE_URL presence + validity, SVG audit, Cloudflare cache rule.
// Two-layer design: scripts/check-env.mjs (prebuild hook) + this block inside
// the Next.js pipeline, so direct `next build` calls still get the checks.
{
  const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";
  const IS_PROD  = process.env.NODE_ENV === "production";

  if (IS_BUILD) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

    if (!siteUrl) {
      const msg =
        "\n❌  next.config.mjs: NEXT_PUBLIC_SITE_URL is not set.\n" +
        "\n" +
        "   Without it, next build will produce an artefact where:\n" +
        "     • absoluteUrl() returns bare relative paths (e.g. \"/news/slug\")\n" +
        "     • Sitemap <loc> tags contain relative paths → Google rejects them\n" +
        "     • RSS <link> elements contain relative paths → feed readers break\n" +
        "     • JSON-LD mainEntityOfPage[\"@id\"] is a relative URL → invalid\n" +
        "\n" +
        "   NEXT_PUBLIC_ variables are compile-time constants — setting\n" +
        "   NEXT_PUBLIC_SITE_URL after `next build` has no effect on the bundle.\n" +
        "\n" +
        "   Fix: export NEXT_PUBLIC_SITE_URL=https://faulter.news before building.\n" +
        "   Locally: add NEXT_PUBLIC_SITE_URL=http://localhost:3000 to .env.local.\n";

      if (IS_PROD) {
        console.error(msg);
        process.exit(1);
      } else {
        console.warn(msg.replace("❌", "⚠️ ").replace("Build blocked", "Warning"));
      }
    } else {
      const trimmed = siteUrl.replace(/\/$/, "");
      let parsed;
      try {
        parsed = new URL(trimmed);
      } catch {
        console.error(
          `\n❌  next.config.mjs: NEXT_PUBLIC_SITE_URL="${siteUrl}" is not a valid URL.\n` +
          "   Expected a full origin, e.g. https://faulter.news\n"
        );
        process.exit(1);
      }

      if (parsed.protocol === "http:" && !trimmed.startsWith("http://localhost")) {
        const httpMsg =
          `\n❌  next.config.mjs: NEXT_PUBLIC_SITE_URL is set to an http:// origin.\n` +
          `   Current value: "${siteUrl}"\n` +
          "\n" +
          "   Production builds must use https://.  An http:// origin weakens\n" +
          "   the CSRF origin check in lib/csrf.ts — it could allow MitM attackers\n" +
          "   to forge form submissions from a downgraded http:// origin.\n" +
          "\n" +
          "   Update NEXT_PUBLIC_SITE_URL to https:// and confirm your reverse\n" +
          "   proxy (Cloudflare, nginx, etc.) enforces HTTPS rewrites.\n";

        if (IS_PROD) {
          console.error(httpMsg);
          process.exit(1);
        } else {
          console.warn(httpMsg.replace("❌", "⚠️ "));
        }
      }
    }

    // C-2 fix: second-pass SVG audit inside the build phase.
    // Closes the window between prebuild hook and compilation where a CMS sync
    // could write new SVGs that the prebuild audit never saw.
    {
      const { readFileSync, readdirSync, statSync } = await import("fs");
      const { join: pathJoin, relative: pathRelative } = await import("path");
      const { fileURLToPath: fu } = await import("url");

      const configDir = fu(new URL(".", import.meta.url));
      const publicDir = pathJoin(configDir, "public");

      const SVG_PATTERNS = [
        { regex: /<script[\s>]/i,                          label: "<script> element" },
        { regex: /\bhref\s*=\s*["']?\s*javascript\s*:/i,  label: "javascript: URI in href" },
        { regex: /\bon[a-z]+\s*=/i,                        label: "on* event-handler attribute" },
        { regex: /<foreignObject[\s>]/i,                   label: "<foreignObject> element" },
        { regex: /<animate\b[^>]*\bvalues\s*=/i,           label: "<animate values=…>" },
      ];

      function walkSvgsConfig(dir) {
        const out = [];
        for (const entry of readdirSync(dir)) {
          const full = pathJoin(dir, entry);
          if (statSync(full).isDirectory()) {
            out.push(...walkSvgsConfig(full));
          } else if (entry.toLowerCase().endsWith(".svg")) {
            out.push(full);
          }
        }
        return out;
      }

      const svgFiles = walkSvgsConfig(publicDir);
      const issues = [];

      for (const filePath of svgFiles) {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        for (const { regex, label } of SVG_PATTERNS) {
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              issues.push({
                relPath: pathRelative(configDir, filePath),
                label,
                line: i + 1,
                snippet: lines[i].trim().slice(0, 120),
              });
              break;
            }
          }
        }
      }

      if (issues.length > 0) {
        console.error(
          `\n❌  next.config.mjs SVG audit FAILED — ${issues.length} dangerous pattern(s) found.\n` +
          "   These files may have been added after the prebuild hook ran\n" +
          "   (e.g. by a CMS sync step).  Fix or allowlist them before building.\n"
        );
        for (const { relPath, label, line, snippet } of issues) {
          console.error(`  📄 ${relPath}  (line ${line}: ${label})`);
          console.error(`     ${snippet}`);
        }
        console.error("");
        process.exit(1);
      }

      console.log(
        `✅  next.config.mjs SVG audit passed — ${svgFiles.length} file(s) scanned, no issues found.`
      );
    }

    // C-1 fix: build-time gate for Cloudflare cache eligibility rules.
    // Without CLOUDFLARE_CACHE_RULES_APPLIED=true, CDN-Cache-Control headers
    // are a no-op at Cloudflare and 100% of HTML traffic hits Vercel origin.
    // Set the variable once after running terraform apply (or the GitHub Actions
    // workflow). See infra/cloudflare/README.md for manual steps.
    {
      const cfRulesApplied = process.env.CLOUDFLARE_CACHE_RULES_APPLIED;
      if (!cfRulesApplied || cfRulesApplied.trim().toLowerCase() !== "true") {
        const cfMsg =
          "\n❌  next.config.mjs: CLOUDFLARE_CACHE_RULES_APPLIED is not set to 'true'.\n" +
          "\n" +
          "     This means the Cloudflare Cache Rule that marks HTML routes as\n" +
          "     eligible for edge caching may not have been applied to the zone.\n" +
          "     Without it, every CDN-Cache-Control header in this file is a\n" +
          "     no-op at Cloudflare and 100% of HTML traffic reaches Vercel\n" +
          "     origin on every request (audit Finding C-1, Critical).\n" +
          "\n" +
          "     Fix (choose one):\n" +
          "       A) Trigger the 'Apply Cloudflare cache rules' GitHub Actions\n" +
          "          workflow. It runs terraform apply and sets this flag.\n" +
          "          Requires CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN secrets.\n" +
          "\n" +
          "       B) Apply the rules manually via the Cloudflare dashboard and\n" +
          "          then add CLOUDFLARE_CACHE_RULES_APPLIED=true to your Vercel\n" +
          "          project's environment variables (Production only).\n" +
          "          See infra/cloudflare/README.md for step-by-step instructions.\n" +
          "\n" +
          "     This error blocks production builds until the variable is set.\n" +
          "     See .env.example for the full variable documentation.\n";
        if (IS_PROD) {
          console.error(cfMsg);
          process.exit(1);
        } else {
          console.warn(cfMsg.replace("❌", "⚠️ ").replace(
            "This error blocks production builds until the variable is set.",
            "This warning becomes a hard failure when NODE_ENV=production."
          ));
        }
      } else {
        console.log(
          "✅  next.config.mjs: CLOUDFLARE_CACHE_RULES_APPLIED=true — " +
          "Cloudflare cache eligibility rules confirmed applied to zone."
        );
      }
    }
  }
}

/**
 * Cache-Control strategy
 *
 * CSP is set in middleware.ts (per-request, runtime-aware) — do NOT add
 * CSP headers here, they would overwrite what middleware sets.
 *
 * All ISR/static routes now emit explicit Cache-Control headers (D-2 fix).
 * Root cause of previous removal: app/layout.tsx was calling headers() to
 * embed a per-request CSP nonce, making responses non-cacheable. That nonce
 * is gone — middleware now uses a static CSP policy, so all content routes
 * are genuinely static or ISR and safe to cache publicly.
 *
 * Three headers per route:
 *   Cache-Control     → browsers + Vercel edge cache
 *   CDN-Cache-Control → Cloudflare (requires a Cache Rule in cache_rules.tf)
 *   Surrogate-Control → Fastly/Varnish; stripped before the browser sees it
 *
 * TTL policy:
 *   ISR (revalidate=3600): s-maxage=3600, stale-while-revalidate=86400
 *   Static (revalidate=false): s-maxage=31536000, stale-while-revalidate=86400
 *   stale-if-error=86400 on content routes: serves cached copy during outages
 *   instead of a 503. API routes are never cached.
 */

const nextConfig = {
  // Suppress X-Powered-By header to reduce technology fingerprinting (M-9 fix).
  poweredByHeader: false,

  // M-5 / M-2 fix: restrict Server Actions to the production origin.
  // An explicit allowlist prevents preview deployments from invoking Server
  // Actions against the production database.
  // M-2 fix: third-layer guard — if NEXT_PUBLIC_SITE_URL is absent at build
  // time, allowedOrigins would silently be [] (falling back to weaker built-in
  // heuristics). This IIFE hard-fails production builds and warns otherwise.
  experimental: {
    serverActions: {
      allowedOrigins: (() => {
        const allowedOrigins = [
          (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
        ].filter(Boolean);

        const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
        const isProd = process.env.NODE_ENV === "production";

        if (isBuildPhase && allowedOrigins.length === 0) {
          const msg =
            "\n❌  next.config.mjs: experimental.serverActions.allowedOrigins resolved to an empty array.\n" +
            "\n" +
            "   NEXT_PUBLIC_SITE_URL was missing or invalid at build time, so Server Actions\n" +
            "   will fall back to Next.js's built-in host-matching heuristics instead of an\n" +
            "   explicit origin allowlist — weakening CSRF protection for Server Actions.\n" +
            "\n" +
            "   Fix: set NEXT_PUBLIC_SITE_URL to the full deployment origin (e.g.\n" +
            "   https://faulter.news) in the build-step environment before building.\n";

          if (isProd) {
            console.error(msg);
            process.exit(1);
          } else {
            console.warn(msg.replace("❌", "⚠️ "));
          }
        }

        return allowedOrigins;
      })(),
    },
  },

  async headers() {
    return [
      // ── ISR routes (revalidate = 3600) ──────────────────────────────────────
      // stale-if-error=86400: serves cached copy for up to 24 h during origin
      // outages rather than surfacing a 503 to readers.
      {
        source: "/",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      {
        source: "/news/:category/:slug",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      // Finding 3 fix: /article/:slug moved from static (1-year TTL) to ISR (1-hour)
      // to match /news/:category/:slug — prevents stale content after post-publish edits.
      //
      // FINDING 5 fix: /article/:slug is a noindex ad-layout alias for the canonical
      // /news/:category/:slug URL. Both routes serve identical content, so caching
      // /article/* at 3600 s doubles Cloudflare edge-cache storage per PoP with no
      // user-visible benefit (noindex = no organic search traffic; only direct links).
      // Reduced s-maxage/max-age from 3600 → 300 (5 min) to free edge capacity for
      // high-traffic canonical routes while retaining a short cache for burst protection.
      // X-Robots-Tag: noindex added at the CDN layer as the authoritative robots signal
      // (generateMetadata already sets <meta robots> but this header-level signal is
      // more reliable for crawlers that skip HTML parsing on non-200 responses).
      {
        source: "/article/:slug",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "X-Robots-Tag",      value: "noindex, follow" },
        ],
      },
      {
        source: "/author/:slug",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      {
        source: "/category/:slug",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      {
        source: "/tag/:slug",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      {
        source: "/archive",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },

      // ── Static routes (revalidate = false) ──────────────────────────────────
      // stale-if-error=86400: guards the brief window on a fresh deploy before
      // Cloudflare's edge node has fetched the new build.
      {
        source: "/about",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      {
        source: "/privacy",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      {
        source: "/terms",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },

      // ── Form page shells ─────────────────────────────────────────────────────
      // HTML shells are fully static. CSRF token + Turnstile are fetched
      // client-side at mount from /api/csrf — no per-request server variation.
      // stale-if-error=86400 added (FINDING 4 follow-up) to match every other
      // static route — serves cached shell during origin outages rather than 504.
      //
      // FINDING 3 (cache-config alignment) — /newsletter specifically:
      // app/newsletter/page.tsx sets `export const revalidate = false`, i.e. the
      // route is rendered once at build time and never regenerated on the
      // server. Paired with max-age=86400 + stale-while-revalidate=86400 here,
      // Cloudflare can keep serving a pre-deploy copy for up to ~48h after a
      // redeploy, and there is no on-demand revalidation webhook wired up for
      // this path (see app/api/revalidate/route.ts). This is intentional and
      // safe today because /newsletter has no DB/CMS-driven content. If that
      // ever changes, either purge the Cloudflare cache for /newsletter on
      // publish, add it to the revalidation webhook, or do a full redeploy —
      // otherwise visitors may see stale HTML for up to 48 hours.
      {
        source: "/newsletter",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      {
        source: "/subscribe",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      {
        source: "/contact",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      // /search: static shell (searchParams read moved into <SearchResults> "use client").
      {
        source: "/search",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
      // /bookmarks: "use client" page — the server renders a static shell.
      {
        source: "/bookmarks",
        headers: [
          { key: "Cache-Control",     value: "public, s-maxage=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "CDN-Cache-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
          { key: "Surrogate-Control", value: "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },

      // ── API routes — never cached ────────────────────────────────────────────
      // no-store on all three header names so Vercel's edge, Cloudflare, and
      // Fastly/Varnish each get an explicit signal.
      // private: API responses are not suitable for shared/proxy caches even
      // transiently — belt-and-suspenders alongside no-store.
      // Surrogate-Control + private folded in from the now-removed vercel.json
      // headers block, which was the second source of truth for this path.
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control",     value: "no-store, private" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Surrogate-Control", value: "no-store" },
        ],
      },

      // ── Static assets — immutable, 1-year TTL ───────────────────────────────
      // X-Content-Type-Options: nosniff added to every rule in this section as
      // defense-in-depth. middleware.ts sets nosniff globally, but its matcher
      // excludes all of these paths (see the "Excluded paths" comment above
      // config.matcher in middleware.ts), and the Cloudflare
      // svg_security_headers ruleset (infra/cloudflare/cache_rules.tf) only
      // covers /article-images/* and /avatars/*. Everything below — /fonts/*,
      // /theme-init.js, /icon.svg, /logo.png, /sitemap.xsl,
      // /site.webmanifest — would otherwise ship with no nosniff header at
      // all when Cloudflare is not in front of the origin (e.g. local dev,
      // direct-to-origin requests, or a misconfigured proxy).
      //
      // Content-Type is set explicitly only for /icon.svg: it's the one SVG
      // in this block, and pairing an explicit `image/svg+xml; charset=utf-8`
      // with nosniff prevents any legacy-browser MIME-sniffing fallback that
      // could otherwise treat the response as text/html. The other assets
      // here keep their framework-inferred Content-Type.
      //
      // D-1 fix: fonts previously had no explicit cache rule.
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control",     value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/article-images/:path*",
        headers: [
          { key: "Cache-Control",     value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/avatars/:path*",
        headers: [
          { key: "Cache-Control",     value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // D-3 fix: theme-init.js previously had no explicit cache rule.
      {
        source: "/theme-init.js",
        headers: [
          { key: "Cache-Control",     value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // /public root static assets — requested on nearly every page load but
      // previously had no explicit cache rule, falling through to Vercel's
      // default (short TTL, no immutable).  All four are committed build
      // artifacts: content changes only on a full redeploy, so immutable +
      // 1-year TTL is correct and consistent with /fonts/*, /avatars/*,
      // /article-images/*, and /theme-init.js above.
      //
      // /icon.svg    — <link rel="icon"> in app/layout.tsx; fetched on every page.
      // /logo.png    — used in Header and og:image; fetched on every page.
      // /sitemap.xsl — XSL stylesheet referenced by /sitemap.xml; browser-fetched
      //                whenever a user opens the sitemap directly.
      // /site.webmanifest — PWA manifest; fetched by every browser on first visit
      //                     and periodically thereafter.
      {
        source: "/icon.svg",
        headers: [
          { key: "Cache-Control",     value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Type",      value: "image/svg+xml; charset=utf-8" },
        ],
      },
      {
        source: "/logo.png",
        headers: [
          { key: "Cache-Control",     value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/sitemap.xsl",
        headers: [
          { key: "Cache-Control",     value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/site.webmanifest",
        headers: [
          { key: "Cache-Control",     value: "public, max-age=31536000, immutable" },
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // /rss.xml, /sitemap.xml, and /robots.txt are intentionally omitted here.
      // Each is served by a route handler (app/rss.xml/route.ts,
      // app/sitemap.xml/route.ts, app/robots.txt/route.ts) that sets all three
      // cache headers (Cache-Control, CDN-Cache-Control, Surrogate-Control)
      // directly on the Response object. Duplicating those paths here would
      // create two sources of truth: Next.js applies next.config headers()
      // *after* the route handler runs, so any value set here would silently
      // override — not merge with — what the route emits.
      //
      // /rss.xml  + /sitemap.xml: route sets max-age=3600 (matches revalidate=3600).
      //   A next.config block with s-maxage=86400 would replace that value,
      //   causing Cloudflare to cache stale feeds for 24 h instead of 1 h.
      //
      // /robots.txt: route already sets the full three-header triple
      //   (max-age=86400 + stale-while-revalidate=86400 on all three names).
      //   The former next.config block here only had Cache-Control with no
      //   stale-while-revalidate, making it weaker and redundant.
      //
      // Single source of truth: edit the route handler, not this file.
    ];
  },

  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // remotePatterns is intentionally empty — next/image never proxies
    // third-party URLs. See removal triggers below before changing this.
    remotePatterns: [],
    // dangerouslyAllowSVG: safe TODAY because remotePatterns=[] and every SVG
    // in /public is a committed build-time asset — no user-controlled content
    // can reach this code path.
    //
    // REMOVAL TRIGGERS — set this flag to false if ANY of these become true:
    //   A) remotePatterns becomes non-empty (external SVGs could execute JS)
    //   B) A CMS sync or CI step writes new files to public/ at build time
    //   C) Any user-controlled content can be written to a next/image path
    //
    // CDN migration milestone (SVG_CDN_TICKET: GH-42):
    //   Before starting CMS integration, file-upload features, or any change
    //   satisfying trigger A/B/C above — resolve GH-42 (migrate article images
    //   to a CDN subdomain) and set this flag to false.
    //
    // MED-1 enforcement: .github/workflows/svg-config-check.yml enforces that
    // remotePatterns must not be non-empty while dangerouslyAllowSVG: true.
    // That CI check runs on every push and pull request and fails the build if
    // both conditions are true simultaneously — it cannot be suppressed by an
    // eslint-disable comment. Before adding any remotePatterns entry, either:
    //   1. Resolve GH-42 and set dangerouslyAllowSVG: false (recommended), OR
    //   2. Ensure all remote origins exclusively serve raster images (no SVGs).
    // The CI gate will catch and block any combination that violates this.
    //
    // ESLint no-restricted-syntax is disabled below as the explicit
    // acknowledgement that triggers A–C have been reviewed and are not met.
    // eslint-disable-next-line no-restricted-syntax
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    // L-1 fix: minimum cache TTL prevents unbounded disk growth on self-hosted
    // deployments (next/image never evicts without this).
    minimumCacheTTL: 86400,
  },
};

export default nextConfig;
