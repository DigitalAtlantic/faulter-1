import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl } from "@/lib/site";

// Static CSP fix: app/layout.tsx (the root layout, an ancestor of every
// route) no longer calls headers() on every request — see the CSP-strategy
// comment there and in middleware.ts for what changed. This page never made
// any Dynamic API calls of its own, so it is now fully static: built once at
// deploy time and served unchanged until the next deploy, exactly as
// `revalidate = false` describes.
export const revalidate = false;

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Faulter terms of service — the rules governing your use of our website.",
  alternates: {
    canonical: absoluteUrl("/terms"),
  },
};

export default function TermsPage() {
  const sections = [
    {
      title: "1. Acceptance of Terms",
      body: `By accessing and using the Faulter website (faulter.news), you accept and agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, you may not use our services.`,
    },
    {
      title: "2. Use of Content",
      body: `All content published on Faulter — including articles, photographs, graphics, video, audio, and data — is the intellectual property of Faulter Media or its content providers and is protected by applicable copyright, trademark, and other intellectual property laws.

You may read, share links to, and quote brief excerpts from our content for personal, non-commercial use, provided you attribute Faulter and include a link to the original article. You may not reproduce substantial portions of our content without our prior written permission.`,
    },
    {
      title: "3. User Conduct",
      body: `When using our site, you agree not to: (a) use the site for any unlawful purpose; (b) attempt to gain unauthorised access to any part of the site; (c) interfere with the proper functioning of the site; (d) scrape, crawl, or data-mine the site without our written permission; (e) use automated means to access the site in a manner that sends more request messages than a human could reasonably produce.`,
    },
    {
      title: "4. Links to Third-Party Sites",
      body: `Our site may contain links to third-party websites. These links are provided for your convenience only. Faulter has no control over the content of those sites and accepts no responsibility for them or for any loss or damage that may arise from your use of them.`,
    },
    {
      title: "5. Disclaimers",
      body: `The content on Faulter is provided for general information purposes only. While we strive for accuracy, we make no representations or warranties of any kind, express or implied, about the completeness, accuracy, reliability, or availability of information on the site. Any reliance you place on such information is strictly at your own risk.`,
    },
    {
      title: "6. Limitation of Liability",
      body: `To the fullest extent permitted by law, Faulter Media shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of, or inability to use, our site or services.`,
    },
    {
      title: "7. Changes to Terms",
      body: `We may update these terms from time to time. The date of the most recent revision will always appear at the top of this page. Your continued use of the site following any changes constitutes acceptance of the revised terms.`,
    },
    {
      title: "8. Governing Law",
      body: `These Terms shall be governed by and construed in accordance with the laws of England and Wales, without regard to its conflict of law principles.`,
    },
    {
      title: "9. Contact",
      body: `For questions about these Terms of Service, please contact legal@faulter.news.`,
    },
  ];

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <nav className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-8" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-accent">Home</Link>
        <span>/</span>
        <span>Terms of Service</span>
      </nav>

      <header className="mb-10">
        <h1 className="font-serif text-4xl font-black text-ink dark:text-zinc-100 mb-3">
          Terms of Service
        </h1>
        <p className="text-sm text-ink-muted dark:text-zinc-500 font-sans">
          Last updated: April 19, 2026
        </p>
      </header>

      <div className="space-y-8 text-[17px] font-sans leading-relaxed text-ink-secondary dark:text-zinc-400">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="font-serif text-xl font-bold text-ink dark:text-zinc-100 mb-3">
              {section.title}
            </h2>
            <p className="whitespace-pre-line">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
