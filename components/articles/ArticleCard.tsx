import { FallbackImage as Image } from "@/components/ui/FallbackImage";
import Link from "next/link";
import { PublicArticle } from "@/types";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { ArticleMeta } from "@/components/ui/ArticleMeta";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import clsx from "clsx";

interface ArticleCardProps {
  // H-4 fix: PublicArticle only (was `Article | PublicArticle`). Every real
  // call site already sources data from the public query helpers in
  // lib/articles.ts, which return PublicArticle[]. Narrowing the prop type
  // makes it a compile-time error to pass a raw Article (with author.email)
  // into this component, instead of relying on the per-render
  // toPublicAuthor() strip that used to live in this file. See the H-4 note
  // in lib/articles.ts for the full call-site audit.
  article: PublicArticle;
  variant?: "grid" | "horizontal" | "compact" | "hero-secondary";
  priority?: boolean;
  showExcerpt?: boolean;
  showBookmark?: boolean;
}

export function ArticleCard({
  article,
  variant = "grid",
  priority = false,
  showExcerpt = false,
  showBookmark = false,
}: ArticleCardProps) {
  const href = `/news/${article.category.slug}/${article.slug}`;

  // ── HORIZONTAL (image left, text right) ────────────────────────────────────
  if (variant === "horizontal") {
    return (
      <article className="group flex gap-4 border-b border-border dark:border-border-dark pb-5">
        <Link href={href} className="flex-shrink-0 relative w-28 h-20 overflow-hidden bg-paper-secondary dark:bg-zinc-800">
          <Image
            src={article.featuredImage}
            alt={article.featuredImageAlt}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="112px"
          />
        </Link>
        <div className="flex-1 min-w-0">
          <CategoryBadge name={article.category.name} slug={article.category.slug} className="mb-1.5" />
          <Link href={href}>
            <h3 className="font-serif text-[15px] font-bold text-ink dark:text-zinc-100 leading-snug
                           group-hover:text-accent transition-colors line-clamp-2">
              {article.title}
            </h3>
          </Link>
          <div className="mt-1.5">
            <ArticleMeta
              author={article.author}
              publishedAt={article.publishedAt}
              readingTime={article.readingTime}
              size="sm"
              showAvatar={false}
            />
          </div>
        </div>
      </article>
    );
  }

  // ── COMPACT (text only, numbered) ──────────────────────────────────────────
  if (variant === "compact") {
    return (
      <article className="group border-b border-border dark:border-border-dark pb-4">
        <CategoryBadge name={article.category.name} slug={article.category.slug} className="mb-1" />
        <Link href={href}>
          <h3 className="font-serif text-[15px] font-bold text-ink dark:text-zinc-100 leading-snug
                         group-hover:text-accent transition-colors">
            {article.title}
          </h3>
        </Link>
        <p className="mt-1 text-xs text-ink-tertiary dark:text-zinc-500 font-sans">
          {article.readingTime} min · {new Date(article.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </p>
      </article>
    );
  }

  // ── HERO SECONDARY (slightly larger card for "top stories" beside hero) ────
  if (variant === "hero-secondary") {
    return (
      <article className="group flex flex-col border-b border-border dark:border-border-dark pb-5 last:border-b-0 last:pb-0">
        <CategoryBadge name={article.category.name} slug={article.category.slug} className="mb-2" />
        <Link href={href}>
          <h3 className="font-serif text-[17px] font-bold text-ink dark:text-zinc-100 leading-snug
                         group-hover:text-accent transition-colors line-clamp-3">
            {article.title}
          </h3>
        </Link>
        {showExcerpt && (
          <p className="mt-2 text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed line-clamp-2">
            {article.excerpt}
          </p>
        )}
        <div className="mt-2">
          <ArticleMeta
            author={article.author}
            publishedAt={article.publishedAt}
            readingTime={article.readingTime}
            size="sm"
            showAvatar={false}
          />
        </div>
      </article>
    );
  }

  // ── GRID (default) ─────────────────────────────────────────────────────────
  return (
    <article className="group flex flex-col">
      <Link href={href} className="relative overflow-hidden aspect-[16/10] block bg-paper-secondary dark:bg-zinc-800 mb-3">
        <Image
          src={article.featuredImage}
          alt={article.featuredImageAlt}
          fill
          priority={priority}
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
        {article.isBreaking && (
          <span className="absolute top-3 left-3 breaking-badge">Breaking</span>
        )}
      </Link>
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-1.5">
          <CategoryBadge name={article.category.name} slug={article.category.slug} />
          {showBookmark && (
            <BookmarkButton articleId={article.id} />
          )}
        </div>
        <Link href={href} className="flex-1">
          <h3
            className={clsx(
              "font-serif font-bold text-ink dark:text-zinc-100 leading-snug group-hover:text-accent transition-colors",
              showExcerpt ? "text-lg" : "text-[17px]"
            )}
          >
            {article.title}
          </h3>
        </Link>
        {showExcerpt && (
          <p className="mt-2 text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed line-clamp-3">
            {article.excerpt}
          </p>
        )}
        <div className="mt-3">
          <ArticleMeta
            author={article.author}
            publishedAt={article.publishedAt}
            readingTime={article.readingTime}
            size="sm"
            showAvatar={false}
          />
        </div>
      </div>
    </article>
  );
}
