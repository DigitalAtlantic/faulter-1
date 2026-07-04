import type { Metadata } from "next";
import { absoluteUrl, siteName, siteHandle } from "@/lib/site";

export const metadata: Metadata = {
  title: "Newsletter — Faulter",
  description: "Sign up for the Faulter Morning Briefing — the day's most important stories delivered to your inbox every morning.",
  alternates: {
    canonical: absoluteUrl("/newsletter"),
  },
  // Explicit OG tags so link previews render correctly when this URL is
  // shared on social media or in messaging apps — same pattern as
  // app/subscribe/layout.tsx's M-7 fix.
  openGraph: {
    type: "website",
    url: absoluteUrl("/newsletter"),
    siteName,
    title: "Newsletter — Faulter",
    description: "Sign up for the Faulter Morning Briefing — the day's most important stories delivered to your inbox every morning.",
  },
  twitter: {
    card: "summary",
    site: siteHandle,
    title: "Newsletter — Faulter",
    description: "Sign up for the Faulter Morning Briefing — the day's most important stories delivered to your inbox every morning.",
  },
  // Same reasoning as app/subscribe/layout.tsx's L-1 fix: this is a lead-gen
  // email form with no editorial content, so it's excluded from indexing to
  // avoid bot/scraper traffic landing directly on the form from search
  // results. follow: true — outbound links should still be followed.
  robots: {
    index: false,
    follow: true,
    googleBot: {
      index: false,
      follow: true,
      noimageindex: true,
    },
  },
};

export default function NewsletterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
