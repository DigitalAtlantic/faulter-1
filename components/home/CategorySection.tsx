import { getArticlesByCategory } from "@/lib/articles";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { SectionHeader } from "./SectionHeader";
import { FallbackImage as Image } from "@/components/ui/FallbackImage";
import Link from "next/link";
import { ArticleMeta } from "@/components/ui/ArticleMeta";
import { CategoryBadge } from "@/components/ui/CategoryBadge";

interface CategorySectionProps {
  categorySlug: string;
  categoryName: string;
  layout?: "standard" | "featured-left";
}

export function CategorySection({
  categorySlug,
  categoryName,
  layout = "standard",
}: CategorySectionProps) {
  // H-4 fix: getArticlesByCategory() now returns PublicArticle[] — author.email
  // is stripped at the query definition site.  The local toPublicAuthor() and
  // .map(toPublicArticle) that were here previously are no longer needed.
  const articles = getArticlesByCategory(categorySlug).slice(0, 4);

  if (articles.length === 0) return null;

  if (layout === "featured-left") {
    const [lead, ...rest] = articles;
    const href = `/news/${lead.category.slug}/${lead.slug}`;

    return (
      <section aria-label={`${categoryName} section`}>
        <SectionHeader title={categoryName} href={`/category/${categorySlug}`} />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Lead */}
          <article className="group lg:col-span-3">
            <Link href={href} className="block relative overflow-hidden aspect-[16/10] mb-3">
              <Image
                src={lead.featuredImage}
                alt={lead.featuredImageAlt}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(max-width: 1024px) 100vw, 60vw"
              />
            </Link>
            <CategoryBadge name={lead.category.name} slug={lead.category.slug} className="mb-1.5" />
            <Link href={href}>
              <h3 className="font-serif text-xl font-bold text-ink dark:text-zinc-100 leading-snug
                             group-hover:text-accent transition-colors">
                {lead.title}
              </h3>
            </Link>
            <p className="mt-2 text-sm text-ink-secondary dark:text-zinc-400 line-clamp-2 leading-relaxed">
              {lead.excerpt}
            </p>
            <div className="mt-3">
              <ArticleMeta
                author={lead.author}
                publishedAt={lead.publishedAt}
                readingTime={lead.readingTime}
                size="sm"
                showAvatar={false}
              />
            </div>
          </article>

          {/* Side list */}
          <div className="lg:col-span-2 flex flex-col gap-5 lg:border-l lg:border-border lg:dark:border-border-dark lg:pl-6">
            {rest.slice(0, 3).map((article) => (
              <ArticleCard key={article.id} article={article} variant="hero-secondary" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={`${categoryName} section`}>
      <SectionHeader title={categoryName} href={`/category/${categorySlug}`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} variant="grid" />
        ))}
      </div>
    </section>
  );
}
