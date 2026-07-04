import type { Metadata } from "next";
import Link from "next/link";
import { categories } from "@/lib/categories";

// L-2 fix: 404 pages should never be indexed — they have no canonical content
// and Google will penalise a site that returns indexable 404 responses.
// robots.noindex is belt-and-suspenders alongside the HTTP 404 status code:
// some crawlers (and the Googlebot soft-404 detector) look for an explicit
// noindex directive in addition to the status code.
//
// follow:true is intentional — the links on this page (Back to Home, Search,
// category links) are real and should be followed by crawlers so link equity
// flows to the canonical pages they point at.
export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-16 text-center">
      <p className="font-serif text-[120px] lg:text-[180px] font-black text-border dark:text-zinc-800 leading-none select-none">
        404
      </p>
      <h1 className="font-serif text-3xl lg:text-4xl font-bold text-ink dark:text-zinc-100 -mt-4 mb-4">
        Story not found
      </h1>
      <p className="text-ink-secondary dark:text-zinc-400 font-sans text-lg mb-10 max-w-md mx-auto">
        The page you were looking for has either moved, been removed, or never
        existed. Try searching, or browse our sections.
      </p>

      <div className="flex flex-wrap gap-3 justify-center mb-10">
        <Link
          href="/"
          className="bg-accent hover:bg-accent-dark text-white text-xs font-bold uppercase tracking-widest px-6 py-3 transition-colors"
        >
          Back to Home
        </Link>
        <Link
          href="/search"
          className="border border-border dark:border-border-dark text-ink-secondary dark:text-zinc-400 text-xs font-bold uppercase tracking-widest px-6 py-3 hover:border-accent hover:text-accent transition-colors"
        >
          Search
        </Link>
      </div>

      <div>
        <p className="text-xs font-sans font-semibold uppercase tracking-widest text-ink-muted dark:text-zinc-500 mb-4">
          Browse sections
        </p>
        <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/category/${cat.slug}`}
              className="text-xs font-sans font-medium px-3 py-1.5 border border-border dark:border-border-dark
                         text-ink-secondary dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
