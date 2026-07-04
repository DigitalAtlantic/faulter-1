"use client";

import { useState, useEffect } from "react";
import clsx from "clsx";

interface BookmarkButtonProps {
  articleId: string;
  className?: string;
  showLabel?: boolean;
}

// M-6: Probe whether localStorage is actually writable.
// Safari ITP, private browsing, and some browser extensions make
// localStorage present in the global scope but throw on every access.
// A simple getItem call is enough — if it throws, storage is blocked.
function isStorageAvailable(): boolean {
  try {
    localStorage.getItem("__storage_test__");
    return true;
  } catch {
    return false;
  }
}

// M-8: Maximum bookmark IDs persisted to localStorage.
// Must match MAX_BOOKMARK_IDS in app/bookmarks/actions.ts (both are 100).
// The Server Action already slices at 100 on the read path; this cap on the
// write path prevents the localStorage array from growing without bound in
// the first place — a user or script that bookmarks thousands of articles
// would otherwise accumulate an unbounded array that gets passed to the
// Server Action on every bookmarks page load.
const MAX_IDS = 100;

export function BookmarkButton({ articleId, className, showLabel = false }: BookmarkButtonProps) {
  const [bookmarked, setBookmarked] = useState(false);
  // M-6: Tri-state: null = not yet measured (SSR/hydration), then boolean.
  const [storageBlocked, setStorageBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    const available = isStorageAvailable();
    setStorageBlocked(!available);
    if (!available) return;
    try {
      const saved = JSON.parse(localStorage.getItem("faulter-bookmarks") || "[]");
      setBookmarked(Array.isArray(saved) && saved.includes(articleId));
    } catch {
      // Corrupt data — treat as no bookmarks; storage probe already passed
    }
  }, [articleId]);

  const toggle = () => {
    if (storageBlocked) return; // button is disabled when storage is blocked
    try {
      const saved: string[] = JSON.parse(localStorage.getItem("faulter-bookmarks") || "[]");
      let updated: string[];
      let next: boolean;
      if (saved.includes(articleId)) {
        updated = saved.filter((id) => id !== articleId);
        next = false;
      } else {
        // Append the new ID, then cap the array so localStorage never grows
        // beyond MAX_IDS entries.  slice(-MAX_IDS) keeps the most-recently
        // added items, which matches a user's expectation that their newest
        // bookmarks are always retained.
        updated = [...saved, articleId].slice(-MAX_IDS);
        next = true;
      }
      // setItem first — if it throws (quota exceeded, storage revoked
      // mid-session) the catch block runs and we never update UI state,
      // so the button does not falsely show "Saved" for an unwritten bookmark.
      localStorage.setItem("faulter-bookmarks", JSON.stringify(updated));
      setBookmarked(next);
    } catch {
      // Write failed (quota exceeded or storage revoked) — leave UI state
      // unchanged so the button does not confirm a save that never happened.
    }
  };

  // M-6: When storage is blocked, render a disabled button with an
  // explanatory tooltip so the user knows why bookmarking is unavailable.
  if (storageBlocked) {
    return (
      <button
        disabled
        aria-label="Bookmarks unavailable — browser storage is blocked"
        title="Bookmarks require browser storage. Enable cookies or disable private browsing to save stories."
        className={clsx(
          "flex items-center gap-1.5 opacity-40 cursor-not-allowed",
          "text-ink-tertiary dark:text-zinc-500",
          className
        )}
      >
        <svg
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
        </svg>
        {showLabel && (
          <span className="text-xs font-sans font-medium">Unavailable</span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark this article"}
      title={bookmarked ? "Saved" : "Save article"}
      className={clsx(
        "flex items-center gap-1.5 transition-colors",
        bookmarked
          ? "text-accent"
          : "text-ink-tertiary dark:text-zinc-500 hover:text-accent",
        className
      )}
    >
      <svg
        width="18"
        height="18"
        fill={bookmarked ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </svg>
      {showLabel && (
        <span className="text-xs font-sans font-medium">
          {bookmarked ? "Saved" : "Save"}
        </span>
      )}
    </button>
  );
}
