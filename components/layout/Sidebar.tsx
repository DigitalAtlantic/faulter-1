import Link from "next/link";
import { getMostReadArticles } from "@/lib/articles";
import { categories } from "@/lib/categories";
import { NewsletterSignup } from "@/components/ui/NewsletterSignup";
import { AdSlot } from "@/components/ads/AdSlot";
import { AD_SLOT_SIDEBAR } from "@/lib/ads/config";

export function Sidebar() {
  const mostRead = getMostReadArticles();

  return (
    <aside className="space-y-8" aria-label="Sidebar">
      {/* Newsletter */}
      <NewsletterSignup variant="sidebar" />

      {/* Ad slot — renders the configured provider's ad unit (or nothing if provider=none) */}
      <AdSlot slotId={AD_SLOT_SIDEBAR} />

      {/* Most Read */}
      <div>
        <div className="flex items-center gap-3 mb-5 pb-3 border-b-2 border-ink dark:border-zinc-100">
          <h2 className="font-serif text-lg font-bold text-ink dark:text-zinc-100">
            Most Read
          </h2>
        </div>
        <ol className="space-y-4">
          {mostRead.map((article, i) => (
            <li key={article.id} className="group flex gap-3">
              <span className="font-serif text-3xl font-black text-border dark:text-zinc-700 leading-none w-6 flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/news/${article.category.slug}/${article.slug}`}
                  className="font-serif text-[14px] font-bold text-ink dark:text-zinc-100 leading-snug
                             group-hover:text-accent transition-colors line-clamp-3"
                >
                  {article.title}
                </Link>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Browse by Category */}
      <div>
        <div className="mb-5 pb-3 border-b-2 border-ink dark:border-zinc-100">
          <h2 className="font-serif text-lg font-bold text-ink dark:text-zinc-100">
            Browse by Topic
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/category/${cat.slug}`}
              className="text-xs font-sans font-semibold uppercase tracking-widest px-3 py-1.5
                         border border-border dark:border-border-dark text-ink-secondary dark:text-zinc-400
                         hover:border-accent hover:text-accent dark:hover:text-accent transition-colors"
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Follow us */}
      <div className="border border-border dark:border-border-dark p-5">
        <h3 className="font-serif text-sm font-bold text-ink dark:text-zinc-100 mb-4 uppercase tracking-wide">
          Follow Faulter
        </h3>
        <div className="space-y-2">
          {[
            { name: "Twitter / X", handle: "@faulternews", href: "https://twitter.com/faulternews" },
            { name: "RSS Feed",    handle: "faulter.news/rss.xml", href: "/rss.xml" },
          ].map((s) => (
            <a
              key={s.name}
              href={s.href}
              target={s.href.startsWith("http") ? "_blank" : undefined}
              rel={s.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="flex items-center justify-between py-2 border-b border-border dark:border-border-dark
                         last:border-b-0 hover:text-accent transition-colors"
            >
              <div>
                <p className="text-sm font-sans font-medium text-ink dark:text-zinc-100">{s.name}</p>
                <p className="text-xs text-ink-muted dark:text-zinc-500">{s.handle}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
}
