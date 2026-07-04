import { FallbackImage as Image } from "@/components/ui/FallbackImage";
import Link from "next/link";
import { PublicArticle } from "@/types";
import { CategoryBadge } from "@/components/ui/CategoryBadge";

interface FeaturedArticleCardProps {
  // H-4 fix: PublicArticle (not Article) so author.email is structurally
  // excluded from this component's props — passing a raw Article here is
  // now a compile-time error, not just a runtime non-issue.
  article: PublicArticle;
}

export function FeaturedArticleCard({ article }: FeaturedArticleCardProps) {
  const href = `/news/${article.category.slug}/${article.slug}`;

  return (
    <article className="group" aria-label={`Featured: ${article.title}`}>
      <Link href={href} className="block relative overflow-hidden aspect-[16/9] lg:aspect-[21/9]">
        <Image
          src={article.featuredImage}
          alt={article.featuredImageAlt}
          fill
          priority
          className="object-cover transition-transform duration-700 group-hover:scale-[1.02]"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 75vw, 900px"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {/* Content overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8">
          <CategoryBadge
            name={article.category.name}
            slug={article.category.slug}
            className="text-white/90 hover:text-white mb-3 inline-block"
            asLink={false}
          />
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight mb-3
                         group-hover:text-accent transition-colors max-w-3xl">
            {article.title}
          </h1>
          <p className="text-white/80 text-sm sm:text-base leading-relaxed max-w-2xl line-clamp-2 mb-4 hidden sm:block">
            {article.excerpt}
          </p>
          <div className="flex items-center gap-2 text-white/70 text-xs">
            <span className="font-sans font-medium text-white/90">{article.author.name}</span>
            <span>·</span>
            <time dateTime={article.publishedAt}>
              {new Date(article.publishedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </time>
            <span>·</span>
            <span>{article.readingTime} min read</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
