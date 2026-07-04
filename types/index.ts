export interface Author {
  id: string;
  name: string;
  slug: string;
  bio: string;
  avatar: string;
  role: string;
  twitter?: string;
  /**
   * Internal staff address — SERVER-SIDE ONLY.
   * Never render this field in public-facing HTML, RSS, JSON-LD, or
   * any client component.  Use `PublicAuthor` (below) whenever an
   * author object is passed to the UI layer.
   */
  email?: string;
  articleCount?: number;
}

/**
 * A safe, public-facing subset of `Author` with the internal email
 * address stripped out.  Use this type for props, API responses, and
 * any value that crosses the server→client boundary.
 */
export type PublicAuthor = Omit<Author, "email">;

/**
 * A safe, public-facing version of `Article` where the nested author
 * has had `email` stripped.  Use this type for any value that crosses
 * the server→client boundary (Server Actions, API routes, props passed
 * to Client Components).  Never pass a raw `Article` to client code.
 *
 * L-3 fix: also excludes `content` (the raw, pre-sanitization HTML) and
 * narrows `sanitizedContent` from optional to required.
 *
 * Previously this type was `Omit<Article, "author">`, which spread the
 * entire `Article` shape — including `content` — onto the public type even
 * though no renderer ever reads anything but `sanitizedContent` via
 * dangerouslySetInnerHTML. Not an XSS path (React/Next never executes an
 * unused field), but it meant the unsanitized source HTML was still visible
 * in the RSC flight payload / page source to anyone who looked — unnecessary
 * exposure once `content` becomes CMS/editor-authored rather than hardcoded.
 *
 * `toPublicArticle()` (lib/articles.ts) is the only place that produces a
 * `PublicArticle`, and it now always resolves `sanitizedContent` (using the
 * pre-sanitized field when present, or sanitizing `content` on the fly
 * otherwise) before dropping `content` from the object entirely — so
 * `sanitizedContent` can safely be required here, and consumers no longer
 * need their own `?? sanitizeArticleContent(article.content)` fallback.
 *
 * M-1 fix: also excludes `views`. The field's own doc comment (below, on
 * `Article.views`) already claimed it was "intentionally absent from all
 * public-facing components," but `PublicArticle` didn't actually omit it —
 * so every public query function except getTrendingArticles()/
 * getMostReadArticles() (which happened to strip it manually before this
 * fix) shipped the real hardcoded view count to the client. Adding "views"
 * to the Omit below makes the contract the doc comment already described
 * structurally true: a caller can no longer accidentally read
 * `publicArticle.views` and have TypeScript let it through. `toPublicArticle()`
 * strips it at runtime to match.
 */
export type PublicArticle = Omit<
  Article,
  "author" | "content" | "sanitizedContent" | "views"
> & {
  author: PublicAuthor;
  sanitizedContent: string;
};

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  color?: string;
}

export interface Article {
  id: string;
  title: string;
  /**
   * URL slug. MUST be globally unique across ALL categories, not merely
   * unique within a category.
   *
   * H-3: /article/[slug] (app/article/[slug]/page.tsx) looks up articles by
   * slug alone, with no category segment to disambiguate — unlike the
   * canonical /news/[category]/[slug] route. getArticleBySlug() in
   * lib/articles.ts enforces this invariant at module load for the current
   * static dataset (it throws on any duplicate). When migrating to a CMS /
   * MongoDB, enforce this with a unique index on `slug`
   * (`createIndex({ slug: 1 }, { unique: true })`) plus a save-hook check —
   * do not rely on editors choosing distinct slugs by convention.
   */
  slug: string;
  excerpt: string;
  /**
   * Raw HTML content as authored (or as stored in the CMS / MongoDB).
   *
   * M-9: Treat this field as UNTRUSTED on every read path.
   * Do NOT pass it to dangerouslySetInnerHTML, RSS body, or JSON-LD
   * without first running it through sanitizeArticleContent().
   *
   * For rendering, prefer `sanitizedContent` if it is present — it
   * was produced by sanitizeArticleContent() at write time and avoids
   * a redundant per-render sanitization pass.
   *
   * When migrating to MongoDB:
   *   • Store both `content` (raw) and `sanitizedContent` (pre-sanitized)
   *     in the document.
   *   • Run sanitizeArticleContent() in the CMS save hook and write the
   *     result to `sanitizedContent`.
   *   • All secondary read paths (RSS, JSON-LD, article excerpts, search
   *     result snippets) MUST use `sanitizedContent` — never `content`.
   *   • A code-review checklist item: any new code that reads `content`
   *     and touches the UI layer should be rejected unless it explicitly
   *     calls sanitizeArticleContent() and documents why pre-sanitized
   *     content could not be used instead.
   */
  content: string;
  /**
   * M-9: Pre-sanitized HTML, produced by sanitizeArticleContent(content)
   * at article-definition / CMS-write time.
   *
   * Always prefer this field over `content` whenever rendering HTML to
   * the browser.  It is safe to pass directly to dangerouslySetInnerHTML.
   *
   * When migrating to MongoDB, this field must be written by the CMS save
   * hook and stored alongside `content`.  The article-page renderer and
   * every other read path (RSS, JSON-LD, search snippets) should switch to
   * reading this field so sanitization is a write-time cost, not a
   * per-request cost.
   *
   * Optional for backwards-compat during migration; callers must fall back
   * to sanitizeArticleContent(content) when undefined.
   */
  sanitizedContent?: string;
  category: Category;
  tags: string[];
  author: Author;
  publishedAt: string;
  updatedAt?: string;
  readingTime: number;
  featuredImage: string;
  featuredImageAlt: string;
  featuredImageCaption?: string;
  isFeatured: boolean;
  isTrending: boolean;
  isMostRead: boolean;
  /**
   * L-5 fix: changed from `boolean | undefined` to `boolean` so it is
   * consistent with isFeatured, isTrending, and isMostRead.  All article
   * objects in lib/articles.ts that omitted the field must now supply
   * `isBreaking: false` explicitly.  The article page and any other
   * consumer can now use `article.isBreaking` (truthy check) without
   * the implicit-undefined footgun.
   */
  isBreaking: boolean;
  status: "published" | "draft" | "unpublished";
  /**
   * M-5 — SYNTHETIC SORT KEY ONLY. Not a real page-view count.
   *
   * During the static-data phase this is a hardcoded number authored at
   * write time and used solely to produce a stable sort order for
   * getTrendingArticles() and getMostReadArticles().  It is never displayed
   * to users and is intentionally absent from all public-facing components.
   *
   * M-1 fix: that "intentionally absent" claim was previously aspirational
   * only — `PublicArticle` (types/index.ts) didn't omit `views`, and
   * `toPublicArticle()` (lib/articles.ts) didn't strip it, so every public
   * query function except getTrendingArticles()/getMostReadArticles() shipped
   * this number to the client in the RSC flight payload. `PublicArticle` now
   * omits `views` and `toPublicArticle()` strips it for every caller, so the
   * claim in this comment is now structurally enforced rather than just
   * documented. `views` still exists on the internal `Article` type (this
   * interface) because the two trending/most-read sort functions need it —
   * it is only guaranteed absent from `PublicArticle`.
   *
   * When migrating to MongoDB, replace with a live counter maintained by
   * POST /api/articles/[id]/views (rate-limited + CSRF-protected).
   * See the M-5 migration guide at the top of lib/articles.ts.
   */
  views?: number;
  relatedArticleIds?: string[];
}

/**
 * H-4 fix: `articles` is `PublicArticle[]`, not `Article[]`.
 * searchArticles() (lib/articles.ts) returns PublicArticle[] — any future
 * route or component that assembles a SearchResult must not be able to
 * smuggle a raw Article (with author.email) back in through this type.
 */
export interface SearchResult {
  articles: PublicArticle[];
  total: number;
  query: string;
}

export interface NavItem {
  label: string;
  href: string;
  children?: NavItem[];
}
