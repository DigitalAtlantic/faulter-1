import Link from "next/link";
import { PublicAuthor } from "@/types";
import { formatDate } from "@/lib/utils";
import { AuthorAvatar } from "./AuthorAvatar";
import { RelativeTime } from "./RelativeTime";
import clsx from "clsx";

interface ArticleMetaProps {
  // H-1 fix: PublicAuthor instead of Author so author.email is structurally
  // excluded from this component's props and therefore never reaches the RSC
  // flight payload or the browser.
  author: PublicAuthor;
  publishedAt: string;
  readingTime: number;
  size?: "sm" | "md";
  showAvatar?: boolean;
}

export function ArticleMeta({
  author,
  publishedAt,
  readingTime,
  size = "md",
  showAvatar = true,
}: ArticleMetaProps) {
  const avatarSize = size === "sm" ? 24 : 32;

  return (
    <div className={clsx("flex items-center gap-3", size === "sm" ? "text-xs" : "text-sm")}>
      {showAvatar && (
        <Link href={`/author/${author.slug}`} className="flex-shrink-0">
          <AuthorAvatar
            src={author.avatar}
            name={author.name}
            size={avatarSize}
            className="grayscale hover:grayscale-0 transition-all"
          />
        </Link>
      )}
      <div className="flex items-center gap-2 text-ink-tertiary dark:text-zinc-500 flex-wrap">
        <Link
          href={`/author/${author.slug}`}
          className="font-sans font-semibold text-ink-secondary dark:text-zinc-400 hover:text-accent transition-colors"
        >
          {author.name}
        </Link>
        <span className="text-border dark:text-border-dark">·</span>
        {/* L-2 fix: render the relative-time string client-side via RelativeTime
            so it reflects the viewer's actual clock rather than being frozen at
            the ISR regeneration instant (where "2h ago" could lag up to ~1 hour).
            The <time> element with dateTime and title is preserved for semantics
            and accessibility; only the visible text is deferred to the client. */}
        <RelativeTime
          dateTime={publishedAt}
          title={formatDate(publishedAt)}
          className="font-sans"
        />
        <span className="text-border dark:text-border-dark">·</span>
        <span className="font-sans">{readingTime} min read</span>
      </div>
    </div>
  );
}
