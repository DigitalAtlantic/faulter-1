import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { BreakingNewsTicker } from "@/components/layout/BreakingNewsTicker";
import { BackToTop } from "@/components/ui/BackToTop";
import { siteName, siteDescription, siteHandle, absoluteUrl, safeMetadataBase, STATIC_ASSET_VERSION } from "@/lib/site";

// Self-hosted fonts — downloaded from google/fonts at build time and committed
// to /public/fonts so the build never makes a runtime request to fonts.googleapis.com.
// Playfair Display: variable font with wght axis (400–900), separate italic file.
// Source Sans 3: variable font with wght axis (300–700), no separate italic axis —
// the browser synthesises oblique from the upright variable file.
const playfair = localFont({
  src: [
    {
      path: "../public/fonts/PlayfairDisplay.woff2",
      style: "normal",
    },
    {
      path: "../public/fonts/PlayfairDisplay-Italic.woff2",
      style: "italic",
    },
  ],
  variable: "--font-playfair",
  display: "swap",
  preload: true,
  fallback: ["Georgia", "serif"],
});

const sourceSans = localFont({
  src: [
    {
      path: "../public/fonts/SourceSans3.woff2",
      style: "normal",
    },
  ],
  variable: "--font-source-sans",
  display: "swap",
  preload: true,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: safeMetadataBase(),
  title: {
    default: `${siteName} — World News, Breaking Stories, In-Depth Reporting`,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  keywords: ["world news", "breaking news", "politics", "business", "technology", "journalism"],
  authors: [{ name: `${siteName} Editorial Team` }],
  creator: siteName,
  publisher: `${siteName} Media`,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: absoluteUrl("/"),
    siteName,
    title: `${siteName} — World News, Breaking Stories, In-Depth Reporting`,
    description: siteDescription,
    // opengraph-image.tsx handles the OG image automatically
  },
  twitter: {
    card: "summary_large_image",
    site: siteHandle,
    creator: siteHandle,
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
};

// M-6: theme-color meta tag — tells mobile browsers (Chrome, Safari, Edge)
// what colour to paint the browser chrome around the page.
//
// Two media-query entries are provided so the browser automatically switches
// between the dark-mode value (#09090b, Tailwind zinc-950) and the light-mode
// value (#ffffff, paper) as the OS colour scheme changes — matching exactly
// what ThemeProvider and theme-init.js apply to the page itself.
//
// The accent colour (#C41E3A) is intentionally NOT used as the primary
// theme-color: it looks correct on the breaking-news ticker but would tint
// the entire browser chrome red, which is jarring.  Using the page background
// colour matches the visual weight of the actual rendered page.
//
// `colorScheme: "light dark"` tells the browser the page supports both
// schemes, which enables the native form controls, scroll bars, and selection
// highlights to follow the OS preference rather than defaulting to light.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)",  color: "#09090b" },
  ],
  colorScheme: "light dark",
};

// Blocking script: runs before first paint to apply the saved theme and prevent
// a flash of unstyled content (FOUC).  Served as a static file from /public,
// loaded via a plain `src="/theme-init.js"` reference.
//
// CSP strategy: this app no longer uses a per-request nonce. middleware.ts
// sets a static `script-src 'self' 'unsafe-inline' …` policy that is byte-
// identical on every response — see the "non-request-specific CSP" comment
// there. 'self' covers this external script file; 'unsafe-inline' covers the
// inline <script> tags Next.js itself injects for React hydration (which
// cannot be served as external files). Because nothing here is derived from
// the incoming request, this layout makes no Dynamic API calls (no headers(),
// no cookies()), so it does not force the route tree into per-request
// rendering — pages can be statically generated or served via ISR.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // H-6 audit point: this layout does NOT read any header or cookie and does
  // NOT branch on user-specific state.  The HTML it produces is therefore
  // identical for every visitor and safe to serve from a static cache / CDN
  // without Vary: Cookie.  If you need to read cookies here (e.g. for
  // server-side theme or session), see the H-6 INVARIANT comment in
  // middleware.ts before adding cache headers.

  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${playfair.variable} ${sourceSans.variable}`}
    >
      <head>
        {/*
          Blocking theme initialisation — must run before any CSS or React
          hydration to prevent a flash of the wrong colour scheme.
          /public/theme-init.js is permitted by `script-src 'self'` (it's an
          external file, not inline), so no nonce attribute is needed here —
          see the CSP-strategy comment above RootLayout.
        */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src={`/theme-init.js?v=${STATIC_ASSET_VERSION}`} suppressHydrationWarning />
        <link rel="icon" href={`/icon.svg?v=${STATIC_ASSET_VERSION}`} type="image/svg+xml" />
        <link rel="manifest" href={`/site.webmanifest?v=${STATIC_ASSET_VERSION}`} />
      </head>
      <body className="bg-paper dark:bg-zinc-950 text-ink dark:text-zinc-100 min-h-screen flex flex-col">
        <ThemeProvider>
          <BreakingNewsTicker />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          <BackToTop />
        </ThemeProvider>
      </body>
    </html>
  );
}
