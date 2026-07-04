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
  title: "Privacy Policy",
  description: "Faulter privacy policy — how we collect, use, and protect your data.",
  alternates: {
    canonical: absoluteUrl("/privacy"),
  },
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <nav className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-8" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-accent">Home</Link>
        <span>/</span>
        <span>Privacy Policy</span>
      </nav>

      <header className="mb-10">
        <h1 className="font-serif text-4xl font-black text-ink dark:text-zinc-100 mb-3">
          Privacy Policy
        </h1>
        <p className="text-sm text-ink-muted dark:text-zinc-500 font-sans">
          Last updated: June 2, 2026
        </p>
      </header>

      <div className="prose-content space-y-8 text-[17px] font-sans leading-relaxed text-ink-secondary dark:text-zinc-400">
        {(
          [
            {
              title: "1. Introduction",
              body: `Faulter Media ("Faulter", "we", "us", or "our") is committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website faulter.news and use our services.

Please read this policy carefully. If you disagree with its terms, please discontinue your use of our site.`,
            },
            {
              title: "2. Information We Collect",
              body: `We may collect information about you in a variety of ways. The information we may collect on the Site includes:

Personal Data: When you register for our newsletter or contact us, we collect personally identifiable information, such as your name and email address, that you voluntarily give to us.

Derivative Data: Our servers automatically collect information when you access the Site, such as your IP address, browser type, operating system, referring URLs, and pages visited.`,
            },
            {
              title: "Cookie Policy",
              id: "cookies",
              body: `Cookies and Tracking Technologies: We may use cookies, web beacons, pixel tags, and similar tracking technologies on the Site to help customise the Site and improve your experience.

We use technically necessary cookies for security (CSRF protection) and session management, and analytics cookies to understand how visitors use our site. You may disable cookies through your browser settings; doing so may affect some Site functionality.`,
            },
            {
              title: "3. How We Use Your Information",
              body: `Having accurate information about you permits us to provide you with a smooth, efficient, and customised experience. Specifically, we may use information collected about you to:

- Send you our newsletter and editorial communications you have opted into
- Respond to your comments and questions and provide customer service
- Compile anonymous statistical data and analysis for use internally
- Monitor and analyse usage and trends to improve your experience with the Site
- Notify you of updates to the Site
- Prevent fraudulent transactions, monitor against theft, and protect against criminal activity`,
            },
            {
              title: "4. Disclosure of Your Information",
              body: `We do not sell, trade, or otherwise transfer your personally identifiable information to third parties except in the following circumstances: to trusted third parties who assist us in operating our website (subject to confidentiality agreements), when we believe release is appropriate to comply with the law, enforce our site policies, or protect our or others' rights, property, or safety.`,
            },
            {
              title: "5. Security of Your Information",
              body: `We use administrative, technical, and physical security measures to help protect your personal information. While we have taken reasonable steps to secure the personal information you provide to us, please be aware that despite our efforts, no security measures are perfect or impenetrable.`,
            },
            {
              title: "6. Your Rights",
              body: `Depending on your location, you may have the following rights regarding your personal information: the right to access information we hold about you, the right to request correction of inaccurate data, the right to request deletion of your data, the right to opt out of marketing communications, and the right to data portability.

Contact form submissions are retained for 90 days and then automatically deleted. To request earlier deletion of your contact form submission, email privacy@faulter.news with the subject line "Early Deletion Request" and the approximate date you submitted the form.

To exercise any of these rights, please contact us at privacy@faulter.news.`,
            },
            {
              title: "7. Contact Us",
              body: `If you have questions or comments about this Privacy Policy, please contact us at:

Faulter Media
Email: privacy@faulter.news`,
            },
          ] as { title: string; id?: string; body: string }[]
        ).map((section) => (
          <section key={section.title} id={section.id}>
            <h2 className="font-serif text-xl font-bold text-ink dark:text-zinc-100 mb-3">
              {section.title}
            </h2>
            <div className="whitespace-pre-line">{section.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
