import { getFeaturedArticles, getLatestArticles } from "@/lib/articles";
import { FeaturedArticleCard } from "@/components/articles/FeaturedArticleCard";
import { ArticleCard } from "@/components/articles/ArticleCard";

export function HeroSection() {
  const featured = getFeaturedArticles();
  const latest = getLatestArticles(8);

  const lead = featured[0] ?? latest[0];
  const supporting = featured.slice(1, 3).length >= 2
    ? featured.slice(1, 3)
    : latest.filter((a) => a.id !== lead?.id).slice(0, 3);

  if (!lead) return null;

  return (
    <section aria-label="Top stories" className="max-w-screen-xl mx-auto px-5 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead story — takes 2/3 */}
        <div className="lg:col-span-2">
          <FeaturedArticleCard article={lead} />
        </div>

        {/* Supporting stories — 1/3 */}
        <div className="flex flex-col justify-between gap-0 border-t border-border dark:border-border-dark lg:border-t-0 lg:border-l lg:border-border lg:dark:border-border-dark lg:pl-6 pt-6 lg:pt-0">
          <div className="text-[10px] font-sans font-bold uppercase tracking-widest text-ink-muted dark:text-zinc-500 mb-4">
            Top Stories
          </div>
          <div className="flex flex-col gap-5 flex-1 justify-between">
            {supporting.slice(0, 3).map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                variant="hero-secondary"
                showExcerpt={false}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
