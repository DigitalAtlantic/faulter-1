import { getTrendingArticles } from "@/lib/articles";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { SectionHeader } from "./SectionHeader";

export function TrendingSection() {
  const articles = getTrendingArticles().slice(0, 4);

  return (
    <section aria-labelledby="trending-heading" className="bg-paper-warm dark:bg-zinc-900 p-6 border border-border dark:border-border-dark">
      <SectionHeader title="Trending Now" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} variant="grid" />
        ))}
      </div>
    </section>
  );
}
