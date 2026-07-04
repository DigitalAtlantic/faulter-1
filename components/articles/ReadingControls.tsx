"use client";

import { useState } from "react";
import clsx from "clsx";

const sizes = ["sm", "md", "lg", "xl"] as const;
type TextSize = (typeof sizes)[number];

export function ReadingControls() {
  const [size, setSize] = useState<TextSize>("md");

  const apply = (s: TextSize) => {
    setSize(s);
    const article = document.getElementById("article-content");
    if (!article) return;
    sizes.forEach((sz) => article.classList.remove(`text-size-${sz}`));
    article.classList.add(`text-size-${s}`);
  };

  return (
    <div className="flex items-center gap-1" title="Text size">
      <span className="text-xs font-sans text-ink-muted dark:text-zinc-500 mr-1">A</span>
      {sizes.map((s) => (
        <button
          key={s}
          onClick={() => apply(s)}
          aria-label={`Text size ${s}`}
          className={clsx(
            "w-6 h-6 flex items-center justify-center text-xs font-sans border transition-colors",
            size === s
              ? "border-accent text-accent"
              : "border-border dark:border-border-dark text-ink-tertiary dark:text-zinc-500 hover:border-accent hover:text-accent"
          )}
        >
          {s === "sm" ? "S" : s === "md" ? "M" : s === "lg" ? "L" : "XL"}
        </button>
      ))}
    </div>
  );
}
