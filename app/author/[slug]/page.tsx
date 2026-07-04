import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { authors } from "@/lib/authors";
import type { Author, PublicAuthor } from "@/types";
import { getArticlesByAuthor } from "@/lib/articles";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { absoluteUrl, siteName } from "@/lib/site";
import { safeJsonLd } from "@/lib/jsonld";

/**
 * Strip author.email before any Author object is used in JSX or passed
 * across a server → client component boundary.
 *
 * M-7 fix: authors.find() returns a full Author including email.  Using
 * the raw Author directly in a Server Component is safe today because no
 * field access serialises the whole object into the RSC flight payload,
 * but typing the local variable as PublicAuthor enforces the constraint
 * at compile-time so a future refactor cannot accidentally pass the full
 * object (with email) to a Client Component as a prop.
 */
function toPublicAuthor({ email: _email, ...rest }: Author): PublicAuthor {
  return rest;
}

// Static CSP fix: this route no longer calls headers() (directly, or
// transitively through app/layout.tsx) — see middleware.ts and
// app/layout.tsx for the CSP-strategy change that removed the per-request
// nonce. `export const revalidate = 3600` now actually takes effect, and
// generateStaticParams() below is used to pre-render every author at build
// time instead of being skipped.
export const revalidate = 3600;


interface AuthorPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return authors.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: AuthorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const rawAuthor = authors.find((a) => a.slug === slug);
  if (!rawAuthor) return { title: "Author Not Found", robots: { index: false, follow: false } };
  const author = toPublicAuthor(rawAuthor);

  // M-8: suppress indexing for authors with no published articles.
  // Empty author pages are thin-content — no articles means nothing for
  // search engines to index, and they'll be filled once articles are published.
  const authorArticles = getArticlesByAuthor(author.slug);
  if (authorArticles.length === 0) {
    return {
      title: author.name,
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${author.name} — Faulter`,
    description: author.bio,
    alternates: {
      canonical: absoluteUrl(`/author/${author.slug}`),
    },
    openGraph: {
      title: author.name,
      description: author.bio,
      url: absoluteUrl(`/author/${author.slug}`),
      images: [{ url: author.avatar, alt: author.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: author.name,
      description: author.bio,
      images: [author.avatar],
    },
  };
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { slug } = await params;
  const rawAuthor = authors.find((a) => a.slug === slug);
  if (!rawAuthor) notFound();
  // M-7 fix: strip email immediately so the rest of this function works with
  // PublicAuthor — the type system then enforces that email is never used.
  const author: PublicAuthor = toPublicAuthor(rawAuthor);

  const authorArticles = getArticlesByAuthor(author.slug);

  // M-5 fix: Person JSON-LD for author profile pages.
  //
  // Person structured data helps Google understand who the author is, their
  // role at the publication, and which articles they have written.  This is
  // an explicit recommendation in Google's E-E-A-T (Experience, Expertise,
  // Authoritativeness, Trustworthiness) guidance for news publishers — author
  // pages with Person schema demonstrate first-hand expertise.
  //
  // email is intentionally excluded (same reason it is stripped from RSC
  // flight payloads — staff addresses must never appear in public HTML).
  //
  // Author pages with no articles are already suppressed from indexing via
  // generateMetadata robots:{index:false}, so we emit JSON-LD only when there
  // are published articles — otherwise the structured data has no effect and
  // would describe a page that crawlers won't index.
  const authorUrl = absoluteUrl(`/author/${author.slug}`);
  const authorJsonLd = authorArticles.length > 0 ? {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${authorUrl}#author`,
    name: author.name,
    url: authorUrl,
    image: {
      "@type": "ImageObject",
      url: absoluteUrl(author.avatar),
      // Avatar SVGs are 100×100 viewBox — surfacing the logical dimensions
      // lets crawlers skip a HEAD request.
      width: 100,
      height: 100,
    },
    jobTitle: author.role,
    worksFor: {
      "@type": "Organization",
      name: siteName,
      url: absoluteUrl("/"),
    },
    // sameAs: link to verified social profiles so Google can consolidate
    // author identity signals across platforms.
    sameAs: [
      author.twitter ? `https://twitter.com/${author.twitter}` : null,
    ].filter(Boolean),
    // knowsAbout: a sampling of the author's most recent article topics.
    // Helps Google understand the author's area of expertise without
    // requiring a complete article graph traversal.
    knowsAbout: authorArticles
      .slice(0, 5)
      .map((a) => a.category.name)
      .filter((v, i, arr) => arr.indexOf(v) === i), // deduplicate
  } : null;

  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8">
      {authorJsonLd && (
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: safeJsonLd(authorJsonLd) }}
        />
      )}
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-8"
        aria-label="Breadcrumb"
      >
        <Link href="/" className="hover:text-accent transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href="/about#team" className="hover:text-accent transition-colors">
          Journalists
        </Link>
        <span>/</span>
        <span className="text-ink-tertiary dark:text-zinc-400">{author.name}</span>
      </nav>

      {/* Author header */}
      <header className="mb-12 pb-8 border-b border-border dark:border-border-dark">
        <div className="flex flex-col sm:flex-row gap-8 items-start">
          <div className="relative w-28 h-28 flex-shrink-0 overflow-hidden grayscale">
            <Image
              src={author.avatar}
              alt={author.name}
              fill
              className="object-cover"
              sizes="112px"
            />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-2">
              {author.role}
            </p>
            <h1 className="font-serif text-4xl lg:text-5xl font-black text-ink dark:text-zinc-100 mb-4 leading-tight">
              {author.name}
            </h1>
            <p className="font-sans text-[17px] leading-relaxed text-ink-secondary dark:text-zinc-400 max-w-2xl mb-5">
              {author.bio}
            </p>
            <div className="flex items-center gap-5 flex-wrap">
              <span className="text-sm font-sans text-ink-muted dark:text-zinc-500">
                <span className="font-bold text-ink dark:text-zinc-100">
                  {authorArticles.length}
                </span>{" "}
                {authorArticles.length === 1 ? "story" : "stories"} published
              </span>
              {author.twitter && (
                <a
                  href={`https://twitter.com/${author.twitter}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-ink-secondary dark:text-zinc-400 hover:text-accent transition-colors"
                >
                  <svg
                    width="14"
                    height="14"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 5.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  @{author.twitter}
                </a>
              )}
              {/* Author email is intentionally not rendered here.
                  Internal staff addresses are stored server-side only and
                  must never be serialised into public HTML responses.
                  Readers who need to reach a journalist should use the
                  site-wide contact form at /contact. */}
            </div>
          </div>
        </div>
      </header>

      {/* Articles */}
      <section>
        <div className="mb-6 pb-3 border-b-2 border-ink dark:border-zinc-100">
          <h2 className="font-serif text-xl font-bold text-ink dark:text-zinc-100">
            Stories by {author.name}
          </h2>
        </div>

        {authorArticles.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-border dark:border-border-dark">
            <p className="font-serif text-xl text-ink-secondary dark:text-zinc-400">
              No stories published yet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {/* H-4 fix: getArticlesByAuthor() now returns PublicArticle[] —
                author.email is stripped at the query definition site so it
                never reaches the RSC flight payload. */}
            {authorArticles.map((article, i) => (
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
        )}
      </section>
    </div>
  );
}
