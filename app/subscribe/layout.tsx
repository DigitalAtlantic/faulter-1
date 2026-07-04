import type { Metadata } from "next";
import { absoluteUrl, siteName, siteHandle } from "@/lib/site";

export const metadata: Metadata = {
  title: "Subscribe to Faulter",
  description: "Sign up to receive Faulter breaking news and editor's picks delivered to your inbox.",
  alternates: {
    canonical: absoluteUrl("/subscribe"),
  },
  // M-7 fix: explicit OG tags so link previews render correctly when the
  // subscribe URL is shared on social media or in messaging apps.
  // Falls back to the root layout's opengraph-image.tsx if no image is set here.
  openGraph: {
    type: "website",
    url: absoluteUrl("/subscribe"),
    siteName,
    title: "Subscribe to Faulter",
    description: "Sign up to receive Faulter breaking news and editor's picks delivered to your inbox.",
  },
  twitter: {
    card: "summary",
    site: siteHandle,
    title: "Subscribe to Faulter",
    description: "Sign up to receive Faulter breaking news and editor's picks delivered to your inbox.",
  },
  // L-1 fix: the subscribe page has no editorial content — it's a lead-gen
  // email form. Indexing it at any priority risks bot/scraper traffic landing
  // directly on the form from search results (rather than via a human visit
  // through the site), and there is nothing here for a search result to
  // usefully preview. This mirrors the existing index:false pattern already
  // used for /search and /bookmarks, both of which are also non-editorial,
  // app-like pages rather than content pages.
  // follow: true — outbound links (privacy policy, home) should still be followed.
  robots: {
    index: false,
    follow: true,
    googleBot: {
      index: false,
      follow: true,
      noimageindex: true, // no meaningful images on this page
    },
  },
};

export default function SubscribeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
