"use client";

import { useEffect, useState } from "react";
import { PublicArticle } from "@/types";
import { getBookmarkedArticles } from "./actions";
import { ArticleCard } from "@/components/articles/ArticleCard";
import Link from "next/link";

// M-6: Same probe used in BookmarkButton — must stay in sync.
function isStorageAvailable(): boolean {
  try {
    localStorage.getItem("__storage_test__");
    return true;
  } catch {
    return false;
  }
}

export default function BookmarksPage() {
  const [bookmarked, setBookmarked] = useState<PublicArticle[]>([]);
  const [mounted, setMounted] = useState(false);
  // M-6: Track whether localStorage is blocked so we can surface a message
  // instead of silently showing an empty bookmarks list.
  const [storageBlocked, setStorageBlocked] = useState(false);

  useEffect(() => {
    setMounted(true);

    // M-6: Probe first — if storage is blocked there is nothing to load.
    if (!isStorageAvailable()) {
      setStorageBlocked(true);
      return;
    }

    let ids: string[] = [];
    try {
      const raw = localStorage.getItem("faulter-bookmarks");
      const parsed = JSON.parse(raw || "[]");
      // M-6 fix: mirror the same ID validation that getBookmarkedArticles()
      // applies server-side.  If localStorage is contaminated (browser
      // extension, manual edit, XSS on another same-origin page) the Server
      // Action would silently return no results for the bad entries, leaving
      // the user with a confusing empty bookmarks page.  Filtering here gives
      // an accurate count and avoids a round-trip for IDs that will never match.
      const VALID_ID = /^[a-z0-9-]+$/;
      ids = Array.isArray(parsed)
        ? parsed.filter((id: unknown) => typeof id === "string" && VALID_ID.test(id))
        : [];
    } catch {
      // localStorage unavailable or corrupt — show empty state
    }
    // Server Action resolves IDs → PublicArticle[] server-side,
    // so the full articles array (including author.email) is never
    // bundled into or sent to the client.
    getBookmarkedArticles(ids).then(setBookmarked);
  }, []);

  const clearAll = () => {
    try {
      localStorage.setItem("faulter-bookmarks", "[]");
    } catch {
      // localStorage unavailable — clear in-memory state only
    }
    setBookmarked([]);
  };

  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-6" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-accent transition-colors">Home</Link>
        <span>/</span>
        <span>Saved Stories</span>
      </nav>

      <header className="mb-8 pb-6 border-b-2 border-ink dark:border-zinc-100 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-4xl font-black text-ink dark:text-zinc-100 mb-2">
            Saved Stories
          </h1>
          {mounted && !storageBlocked && (
            <p className="text-ink-secondary dark:text-zinc-400 font-sans text-sm">
              {bookmarked.length} {bookmarked.length === 1 ? "story" : "stories"} saved
            </p>
          )}
        </div>
        {mounted && !storageBlocked && bookmarked.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs font-sans font-semibold uppercase tracking-widest text-ink-muted dark:text-zinc-500
                       hover:text-accent transition-colors border border-border dark:border-border-dark
                       px-3 py-2 hover:border-accent"
          >
            Clear all
          </button>
        )}
      </header>

      {!mounted ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-3 animate-pulse">
              <div className="aspect-[16/10] bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-4 bg-paper-secondary dark:bg-zinc-800 w-3/4" />
              <div className="h-4 bg-paper-secondary dark:bg-zinc-800 w-1/2" />
            </div>
          ))}
        </div>
      ) : storageBlocked ? (
        // M-6: Storage is blocked — surface an explanation rather than a
        // silent empty list. Safari ITP, Firefox private browsing, and some
        // ad-blockers/extensions block localStorage entirely. Without this
        // message the user sees "0 stories saved" with no indication why.
        <div className="py-24 text-center border border-dashed border-border dark:border-border-dark">
          <svg
            className="w-12 h-12 mx-auto text-ink-muted dark:text-zinc-600 mb-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            <line x1="3" y1="3" x2="21" y2="21" strokeWidth="1.5" />
          </svg>
          <p className="font-serif text-2xl text-ink-secondary dark:text-zinc-400 mb-2">
            Bookmarks unavailable
          </p>
          <p className="text-sm text-ink-muted dark:text-zinc-500 max-w-sm mx-auto">
            Bookmarks require browser storage. Enable cookies or disable private
            browsing to save stories.
          </p>
        </div>
      ) : bookmarked.length === 0 ? (
        <div className="py-24 text-center border border-dashed border-border dark:border-border-dark">
          <svg
            className="w-12 h-12 mx-auto text-ink-muted dark:text-zinc-600 mb-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
          </svg>
          <p className="font-serif text-2xl text-ink-secondary dark:text-zinc-400 mb-2">
            No saved stories yet
          </p>
          <p className="text-sm text-ink-muted dark:text-zinc-500 mb-6">
            Click the bookmark icon on any article to save it here.
          </p>
          <Link
            href="/"
            className="inline-block text-xs font-sans font-bold uppercase tracking-widest px-5 py-3
                       bg-accent hover:bg-accent-dark text-white transition-colors"
          >
            Browse Stories
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
          {bookmarked.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              variant="grid"
              showExcerpt
              showBookmark
            />
          ))}
        </div>
      )}
    </div>
  );
}
