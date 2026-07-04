import { getLatestArticles } from "@/lib/articles";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { SectionHeader } from "./SectionHeader";

export function LatestNewsSection() {
  const articles = getLatestArticles(6);

  return (
    <section aria-label="Latest News">
      <SectionHeader title="Latest News" href="/archive" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-8">
        {articles.map((article, i) => (
          <ArticleCard
            key={article.id}
            article={article}
            variant="grid"
            priority={i < 3}
            showExcerpt={i < 3}
            showBookmark
          />
        ))}
      </div>
    </section>
  );
}
