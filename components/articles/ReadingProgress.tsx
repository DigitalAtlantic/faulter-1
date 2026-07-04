"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ReadingProgress
 *
 * H-2 fix: the previous implementation set `style={{ width: `${progress}%` }}`
 * directly on the element, which requires `style-src 'unsafe-inline'` in the
 * CSP.  We now set a CSS custom property (--rp-width) via the DOM API instead.
 * JavaScript DOM style mutations (element.style.setProperty) are governed by
 * `script-src`, not `style-src`, so they work without `'unsafe-inline'`.
 * The bar's width rule lives in globals.css: `width: var(--rp-width, 0%)`.
 */
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const article = document.getElementById("article-content");
      if (!article) return;
      const { top, height } = article.getBoundingClientRect();
      const windowH = window.innerHeight;
      const scrolled = Math.max(0, -top);
      const total = height - windowH;
      setProgress(total > 0 ? Math.min(100, (scrolled / total) * 100) : 0);
    };
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  // Set the CSS custom property via DOM instead of a style attribute so the
  // production CSP does not need `style-src 'unsafe-inline'`.
  useEffect(() => {
    barRef.current?.style.setProperty("--rp-width", `${progress}%`);
  }, [progress]);

  return (
    <div
      ref={barRef}
      className="reading-progress-bar"
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Reading progress"
    />
  );
}
