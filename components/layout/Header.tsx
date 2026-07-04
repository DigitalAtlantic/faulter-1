"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";
import { useRouter } from "next/navigation";
import { categories } from "@/lib/categories";

/**
 * Cache-audit fix (Finding 2): this used to call `getDateStr()` inside the
 * `useState` initializer below. `Header` is a "use client" component, but
 * Next.js still executes client components during SSR/SSG to produce the
 * initial HTML — so that initializer ran on the server at ISR-generation
 * time and baked that moment's date string into the cached HTML snapshot.
 * The route stayed fully ISR-cacheable (this is not a Dynamic API), but
 * every visitor who hit a cached copy saw the date from whenever the page
 * was last regenerated until client JS hydrated and corrected it.
 *
 * Fix: never call this on the server. `dateStr` now starts as `null` (see
 * useState below) and is only ever set inside a `useEffect`, which runs
 * client-side only, after hydration. No clock read happens during
 * SSR/ISR generation any more — mirrors the pattern already used in
 * components/ui/RelativeTime.tsx.
 */
function getDateStr(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const [isScrolled, setIsScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Cache-audit fix (Finding 2): seed as null — do NOT call getDateStr()
  // here. This initializer runs during SSR/ISR generation (Header is a
  // Client Component, but Next.js still executes it on the server to
  // produce the initial HTML), so calling getDateStr() here would bake
  // the server's render-time date into the cached HTML again. The actual
  // value is set below in a useEffect, which only ever runs in the browser
  // after hydration.
  const [dateStr, setDateStr] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Cache-audit fix (Finding 2): this is now the ONLY place getDateStr() is
  // called. Runs client-side only, after mount, using the visitor's local
  // timezone — never on the server, so no clock value reaches cached HTML.
  useEffect(() => {
    setDateStr(getDateStr());
  }, []);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setSearchOpen(false);
          setSearchQuery("");
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [searchOpen]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchOpen(false);
      setSearchQuery("");
    }
  };

  return (
    <>
      {/* Search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-20 px-4">
          <div className="bg-paper dark:bg-zinc-900 w-full max-w-2xl shadow-2xl">
            <form onSubmit={handleSearch} className="flex items-center border-b-2 border-accent">
              <span className="pl-4 text-ink-tertiary dark:text-zinc-400">
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              </span>
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search stories, topics, authors…"
                className="flex-1 px-4 py-5 text-lg bg-transparent text-ink dark:text-zinc-100 placeholder-ink-muted dark:placeholder-zinc-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="px-5 py-5 text-ink-tertiary dark:text-zinc-400 hover:text-ink dark:hover:text-zinc-100"
                aria-label="Close search"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </form>
            <div className="p-4 text-sm text-ink-tertiary dark:text-zinc-500">
              Press Enter to search or Escape to close
            </div>
          </div>
        </div>
      )}

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-paper dark:bg-zinc-950 lg:hidden overflow-y-auto">
          <div className="flex justify-between items-center px-5 py-4 border-b border-border dark:border-border-dark">
            <Link
              href="/"
              className="font-serif text-2xl font-black tracking-tight text-ink dark:text-zinc-100"
              onClick={() => setMobileMenuOpen(false)}
            >
              Faulter
            </Link>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-2"
              aria-label="Close menu"
            >
              <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <nav className="p-5 space-y-1">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/category/${cat.slug}`}
                className="block py-3 px-4 text-lg font-sans font-medium text-ink dark:text-zinc-100 
                           border-b border-border dark:border-border-dark hover:text-accent transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {cat.name}
              </Link>
            ))}
            <div className="pt-4 space-y-2">
              <Link href="/about" className="block py-2 text-ink-secondary dark:text-zinc-400 hover:text-accent" onClick={() => setMobileMenuOpen(false)}>About</Link>
              <Link href="/contact" className="block py-2 text-ink-secondary dark:text-zinc-400 hover:text-accent" onClick={() => setMobileMenuOpen(false)}>Contact</Link>
              <Link href="/archive" className="block py-2 text-ink-secondary dark:text-zinc-400 hover:text-accent" onClick={() => setMobileMenuOpen(false)}>Archive</Link>
            </div>
          </nav>
        </div>
      )}

      <header
        className={`sticky top-0 z-30 bg-paper dark:bg-zinc-950 transition-shadow ${
          isScrolled ? "shadow-sm" : ""
        }`}
      >
        {/* Top bar: date + social + utils */}
        <div className="border-b border-border dark:border-border-dark hidden lg:block">
          <div className="max-w-screen-xl mx-auto px-5 flex justify-between items-center h-9 text-xs text-ink-tertiary dark:text-zinc-500">
            {/* Cache-audit fix (Finding 2): renders empty until the
                useEffect above sets the real value client-side. The parent
                bar has a fixed h-9 height, so this causes no layout shift. */}
            <span suppressHydrationWarning>{dateStr ?? ""}</span>
            <div className="flex items-center gap-5">
              <Link href="/subscribe" className="hover:text-accent transition-colors">Subscribe</Link>
              <span className="text-border dark:text-border-dark">|</span>
              <a href="https://twitter.com/faulternews" className="hover:text-accent" aria-label="X (Twitter)" rel="noopener noreferrer" target="_blank">
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 5.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>

              <a href="/rss.xml" className="hover:text-accent" aria-label="RSS Feed">
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Main header: logo + search + theme */}
        <div className="border-b border-border dark:border-border-dark">
          <div className="max-w-screen-xl mx-auto px-5 flex items-center justify-between h-16">
            {/* Mobile menu button */}
            <button
              className="lg:hidden p-2 -ml-2 text-ink dark:text-zinc-100"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M3 12h18M3 6h18M3 18h18"/>
              </svg>
            </button>

            {/* Logo */}
            <Link
              href="/"
              className="font-serif text-3xl lg:text-4xl font-black tracking-tight text-ink dark:text-zinc-100 hover:text-accent transition-colors flex-shrink-0"
              aria-label="Faulter Home"
            >
              Faulter
            </Link>

            {/* Right controls */}
            <div className="flex items-center gap-2">
              {/* Search */}
              <button
                onClick={() => setSearchOpen(true)}
                className="p-2 text-ink-secondary dark:text-zinc-400 hover:text-accent dark:hover:text-accent transition-colors"
                aria-label="Open search"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              </button>

              {/* Bookmarks */}
              <Link
                href="/bookmarks"
                className="hidden sm:flex p-2 text-ink-secondary dark:text-zinc-400 hover:text-accent transition-colors"
                aria-label="Saved articles"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
                </svg>
              </Link>

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="p-2 text-ink-secondary dark:text-zinc-400 hover:text-accent dark:hover:text-accent transition-colors"
                aria-label="Toggle dark mode"
              >
                {theme === "dark" ? (
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                )}
              </button>

              {/* Subscribe CTA */}
              <Link
                href="/subscribe"
                className="hidden md:block ml-2 bg-accent hover:bg-accent-dark text-white text-xs font-sans font-bold uppercase tracking-widest px-4 py-2 transition-colors"
              >
                Subscribe
              </Link>
            </div>
          </div>
        </div>

        {/* Category navigation */}
        <nav
          className="hidden lg:block border-b border-border dark:border-border-dark bg-paper dark:bg-zinc-950"
          aria-label="Category navigation"
        >
          <div className="max-w-screen-xl mx-auto px-5 flex items-center gap-0 overflow-x-auto">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/category/${cat.slug}`}
                className="px-4 py-3 text-xs font-sans font-semibold uppercase tracking-widest text-ink-secondary dark:text-zinc-400 
                           hover:text-accent dark:hover:text-accent border-b-2 border-transparent hover:border-accent 
                           transition-colors whitespace-nowrap"
              >
                {cat.name}
              </Link>
            ))}
            <Link
              href="/archive"
              className="px-4 py-3 text-xs font-sans font-semibold uppercase tracking-widest text-ink-muted dark:text-zinc-500
                         hover:text-accent border-b-2 border-transparent hover:border-accent transition-colors whitespace-nowrap ml-auto"
            >
              Archive
            </Link>
          </div>
        </nav>
      </header>
    </>
  );
}
