import type { Metadata } from "next";
import { getPublishedArticles } from "@/lib/articles";
import type { PublicArticle } from "@/types";
import Link from "next/link";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { absoluteUrl } from "@/lib/site";

// Static CSP fix: app/layout.tsx (the ROOT layout, an ancestor of this page)
// no longer calls headers() on every request — see the CSP-strategy comment
// there and in middleware.ts for what changed. This page never embedded a
// nonce directly, so removing the ancestor's headers() call is the only
// change this route needed; `revalidate` below now actually takes effect.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Archive",
  description: "Browse the complete Faulter archive of stories, sorted by date.",
  alternates: {
    canonical: absoluteUrl("/archive"),
  },
};

export default function ArchivePage() {
  // H-1 fix: getPublishedArticles() returns PublicArticle[] directly — the
  // raw `articles` export no longer exists. author.email is structurally
  // absent from PublicArticle, so it cannot leak through the grouped map.
  const published = [...getPublishedArticles()]
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

  // H-7 fix: typed as PublicArticle[] (not typeof articles / Article[]) so
  // TypeScript catches any future attempt to access article.author.email from
  // grouped entries — those objects have already been through toPublicArticle().
  const grouped: Record<string, PublicArticle[]> = {};
  for (const article of published) {
    const key = new Date(article.publishedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
    });
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(article);
  }

  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-6" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-accent transition-colors">Home</Link>
        <span>/</span>
        <span>Archive</span>
      </nav>

      <header className="mb-10 pb-6 border-b-2 border-ink dark:border-zinc-100">
        <h1 className="font-serif text-4xl lg:text-5xl font-black text-ink dark:text-zinc-100 mb-3">
          Archive
        </h1>
        <p className="text-ink-secondary dark:text-zinc-400 font-sans">
          {published.length} stories published
        </p>
      </header>

      <div className="max-w-3xl">
        {Object.entries(grouped).map(([month, monthArticles]) => (
          <section key={month} className="mb-12">
            <h2 className="font-serif text-2xl font-bold text-ink dark:text-zinc-100 mb-5 pb-3 border-b border-border dark:border-border-dark">
              {month}
            </h2>
            <div className="space-y-0">
              {monthArticles.map((article) => (
                <article
                  key={article.id}
                  className="group py-4 border-b border-border dark:border-border-dark last:border-b-0 flex gap-6 items-start"
                >
                  <div className="w-14 flex-shrink-0 text-center">
                    <p className="font-serif text-2xl font-black text-ink-muted dark:text-zinc-600 leading-none">
                      {new Date(article.publishedAt).getDate()}
                    </p>
                    <p className="text-[10px] font-sans text-ink-muted dark:text-zinc-600 uppercase tracking-wide">
                      {new Date(article.publishedAt).toLocaleDateString("en-US", { weekday: "short" })}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <CategoryBadge
                        name={article.category.name}
                        slug={article.category.slug}
                      />
                      {article.isBreaking && (
                        <span className="breaking-badge">Breaking</span>
                      )}
                    </div>
                    <Link
                      href={`/news/${article.category.slug}/${article.slug}`}
                      className="font-serif text-[17px] font-bold text-ink dark:text-zinc-100 leading-snug
                                 group-hover:text-accent transition-colors"
                    >
                      {article.title}
                    </Link>
                    <p className="text-sm text-ink-secondary dark:text-zinc-400 mt-1 line-clamp-1">
                      {article.excerpt}
                    </p>
                    <p className="text-xs text-ink-muted dark:text-zinc-500 font-sans mt-1">
                      By {article.author.name} · {article.readingTime} min read
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
