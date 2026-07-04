import Link from "next/link";
import { categories } from "@/lib/categories";
import { FooterNewsletter } from "./FooterNewsletter";
import { siteName } from "@/lib/site";
import { FooterYear } from "./FooterYear";

export function Footer() {
  return (
    <footer className="bg-ink dark:bg-zinc-900 text-zinc-300 mt-16">
      {/* Main footer */}
      <div className="max-w-screen-xl mx-auto px-5 py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link
              href="/"
              className="font-serif text-4xl font-black text-white tracking-tight hover:text-accent transition-colors"
            >
              {siteName}
            </Link>
            <p className="mt-4 text-sm text-zinc-400 leading-relaxed max-w-sm">
              Independent journalism you can rely on. {siteName} delivers trusted,
              in-depth reporting on the stories that shape your world — with clarity,
              rigour, and respect for the truth.
            </p>
            {/* Social links — update hrefs in .env or directly here once accounts are live */}
            <div className="flex items-center gap-4 mt-6">
              {/* X / Twitter — replace # with real profile URL when live */}
              <a
                href="https://twitter.com/faulternews"
                className="text-zinc-400 hover:text-white transition-colors"
                aria-label={`${siteName} on X (Twitter)`}
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 5.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
              {/* RSS — always works, no account needed */}
              <a
                href="/rss.xml"
                className="text-zinc-400 hover:text-white transition-colors"
                aria-label={`${siteName} RSS Feed`}
              >
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/>
                </svg>
              </a>
            </div>
          </div>

          {/* Sections */}
          <div>
            <h3 className="text-white font-sans font-semibold text-xs uppercase tracking-widest mb-5">
              Sections
            </h3>
            <ul className="space-y-2.5">
              {categories.map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={`/category/${cat.slug}`}
                    className="text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    {cat.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-white font-sans font-semibold text-xs uppercase tracking-widest mb-5">
              Company
            </h3>
            <ul className="space-y-2.5">
              {[
                { label: `About ${siteName}`,     href: "/about" },
                { label: "Our Journalists",        href: "/about#team" },
                { label: "Editorial Standards",    href: "/about#standards" },
                { label: "Contact Us",             href: "/contact" },
                { label: "Advertise",              href: "/contact" },
                { label: "Archive",                href: "/archive" },
                { label: "Sitemap",                href: "/sitemap.xml" },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-zinc-400 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Newsletter — client component for the interactive form */}
          <div>
            <h3 className="text-white font-sans font-semibold text-xs uppercase tracking-widest mb-5">
              Newsletter
            </h3>
            <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
              Get the most important stories delivered to your inbox each morning.
            </p>
            <FooterNewsletter />
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-zinc-800">
        <div className="max-w-screen-xl mx-auto px-5 py-5 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-zinc-500">
          <p>© <FooterYear /> {siteName} Media. All rights reserved.</p>
          <div className="flex items-center gap-5 flex-wrap justify-center">
            <Link href="/privacy" className="hover:text-zinc-300 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-zinc-300 transition-colors">Terms of Service</Link>
            <Link href="/privacy#cookies" className="hover:text-zinc-300 transition-colors">Cookie Policy</Link>
            <Link href="/about#standards" className="hover:text-zinc-300 transition-colors">Editorial Standards</Link>
            <Link href="/about#corrections" className="hover:text-zinc-300 transition-colors">Corrections Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
