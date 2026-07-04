"use client";

/**
 * H-6 INVARIANT — theme MUST remain client-only.
 *
 * Theme is intentionally resolved in the browser (localStorage → OS preference)
 * so the server always renders identical HTML for every user, regardless of
 * their theme preference. M-3 fix: this comment used to say no route in this
 * app was served from a shared/CDN cache — that was true when it was written
 * but isn't any more. Several routes (/, /news/*, /author/*, /archive,
 * /about, /privacy, /terms, /category/*, /tag/*, /newsletter, /subscribe,
 * /contact, /bookmarks) are now statically generated or served via ISR and
 * receive a real `Cache-Control: public` header from next.config.mjs (see
 * the "Resolution: static-rendering fix" comment there). That makes this
 * invariant more important than ever, not less: Server Components must
 * never branch on user-specific state, since a cookie-personalised response
 * on any of those routes would now be cached and replayed to every other
 * visitor who hits the same path, not just a hypothetical future risk.
 *
 * DO NOT read a theme cookie in a Server Component or move theme resolution
 * into middleware. If you do, you must add `Vary: Cookie` to every cache
 * configuration that touches the affected route(s) — see the H-6 INVARIANT
 * references in middleware.ts.
 */
import { createContext, useContext, useLayoutEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
    let saved: Theme | null = null;
    try {
      saved = localStorage.getItem("faulter-theme") as Theme | null;
    } catch {
      // localStorage unavailable — fall back to OS preference
    }
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const initial = saved ?? (prefersDark ? "dark" : "light");
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("faulter-theme", next);
    } catch {
      // localStorage unavailable — theme change applies for this session only
    }
  };

  if (!mounted) {
    return (
      <ThemeContext.Provider value={{ theme: "light", toggleTheme }}>
        {children}
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
