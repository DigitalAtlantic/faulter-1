import type { Metadata } from "next";
import { HeroSection } from "@/components/home/HeroSection";
import { LatestNewsSection } from "@/components/home/LatestNewsSection";
import { TrendingSection } from "@/components/home/TrendingSection";
import { CategorySection } from "@/components/home/CategorySection";
import { Sidebar } from "@/components/layout/Sidebar";
import { NewsletterSignup } from "@/components/ui/NewsletterSignup";
import { absoluteUrl, siteName, siteDescription, STATIC_ASSET_VERSION } from "@/lib/site";
import { safeJsonLd } from "@/lib/jsonld";

// Static CSP fix: this route no longer calls headers() (directly, or
// transitively through app/layout.tsx), so it carries no Next.js Dynamic
// API usage and is eligible for static generation / ISR. `revalidate`
// below now actually takes effect — see app/layout.tsx and middleware.ts
// for the corresponding CSP-strategy change that made this possible.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Faulter — World News, Breaking Stories, In-Depth Reporting",
  description:
    "Faulter delivers trusted, in-depth reporting on global news, politics, business, technology, health, science, and more.",
  alternates: {
    canonical: absoluteUrl("/"),
  },
};

// M-5 fix: WebSite + Organization JSON-LD for the home page.
//
// WebSite with SearchAction enables Google Sitelinks Search Box — the inline
// search field that appears under the site result in SERPs for navigational
// queries ("faulter news").  It also establishes the canonical site name and
// URL that Google uses when constructing Sitelinks for the domain.
//
// Organization with logo is what populates the Knowledge Panel logo and
// brand identity signals.  Google's documentation for news publishers
// explicitly recommends both types on the home page.
//
// Both blocks are rendered as a single @graph array, which is the spec-correct
// form when multiple types describe the same page: it avoids creating two
// separate JSON-LD documents and gives crawlers a single parse target.
const homeJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${absoluteUrl("/")}#website`,
      url: absoluteUrl("/"),
      name: siteName,
      description: siteDescription,
      // SearchAction tells Google about the site's search endpoint.
      // The query-input annotation marks {search_term_string} as the
      // variable that maps to the user's search query.  This is what
      // enables the Sitelinks Search Box in Google Search results.
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${absoluteUrl("/search")}?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "Organization",
      "@id": `${absoluteUrl("/")}#organization`,
      name: siteName,
      url: absoluteUrl("/"),
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl(`/icon.svg?v=${STATIC_ASSET_VERSION}`),
        // width/height let crawlers skip a HEAD request.
        // The icon is square; 512×512 is within Google's ≤600px height limit.
        width: 512,
        height: 512,
      },
      sameAs: [
        // Add official social-profile URLs here when accounts are created.
        // e.g. "https://twitter.com/FaulterNews",
        //      "https://www.facebook.com/FaulterNews",
        // Google uses sameAs to consolidate brand signals across platforms.
      ],
    },
  ],
};

export default function HomePage() {
  // Static CSP fix: this <script> no longer needs a nonce attribute.
  // Production CSP now uses `script-src 'self' 'unsafe-inline' …` (see
  // middleware.ts), which permits this inline JSON-LD script without one.
  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(homeJsonLd) }}
      />
      {/* Hero */}
      <HeroSection />

      {/* Thin rule */}
      <div className="border-t border-border dark:border-border-dark" />

      {/* Main content + sidebar */}
      <div className="max-w-screen-xl mx-auto px-5 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
          {/* Left: main content */}
          <div className="space-y-14 min-w-0">
            <LatestNewsSection />

            <div className="border-t border-border dark:border-border-dark" />

            <TrendingSection />

            <div className="border-t border-border dark:border-border-dark" />

            <CategorySection
              categorySlug="world"
              categoryName="World"
              layout="featured-left"
            />

            <div className="border-t border-border dark:border-border-dark" />

            <CategorySection
              categorySlug="politics"
              categoryName="Politics"
              layout="standard"
            />

            <div className="border-t border-border dark:border-border-dark" />

            {/* Inline newsletter */}
            <NewsletterSignup variant="inline" />

            <CategorySection
              categorySlug="business"
              categoryName="Business"
              layout="featured-left"
            />

            <div className="border-t border-border dark:border-border-dark" />

            <CategorySection
              categorySlug="technology"
              categoryName="Technology"
              layout="standard"
            />

            <div className="border-t border-border dark:border-border-dark" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <CategorySection
                categorySlug="science"
                categoryName="Science"
                layout="standard"
              />
              <CategorySection
                categorySlug="health"
                categoryName="Health"
                layout="standard"
              />
            </div>

            <div className="border-t border-border dark:border-border-dark" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <CategorySection
                categorySlug="sports"
                categoryName="Sports"
                layout="standard"
              />
              <CategorySection
                categorySlug="entertainment"
                categoryName="Entertainment"
                layout="standard"
              />
            </div>

            <div className="border-t border-border dark:border-border-dark" />

            <CategorySection
              categorySlug="opinion"
              categoryName="Opinion"
              layout="featured-left"
            />
          </div>

          {/* Sidebar */}
          <div className="hidden lg:block">
            <div className="sticky top-28 space-y-8">
              <Sidebar />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
