"use client";

import Image, { ImageProps } from "next/image";
import { useState, useEffect } from "react";

const DEFAULT_IMAGE = "/article-images/default-news.svg";

/**
 * A drop-in replacement for next/image that falls back to a local placeholder
 * when the primary `src` fails to load (404, network timeout, etc.).
 *
 * Usage: swap <Image ... /> for <FallbackImage ... /> — all props are identical.
 */
export function FallbackImage({ src, alt, onError, ...props }: ImageProps) {
  const [imgSrc, setImgSrc] = useState(src);
  const [didFallback, setDidFallback] = useState(false);

  // L-2 fix: if a parent re-renders the same component instance with a new
  // src prop (no key change), the useState initialiser above won't re-run.
  // Sync imgSrc and reset the fallback flag so the new image is attempted.
  // Current call sites all supply key={article.id} which forces a remount on
  // data change, so this is not currently exploitable — but without this
  // effect any future caller that omits the key would silently show stale art.
  useEffect(() => {
    setImgSrc(src);
    setDidFallback(false);
  }, [src]);

  function handleError() {
    if (!didFallback) {
      setDidFallback(true);
      setImgSrc(DEFAULT_IMAGE);
    }
    // Call the caller's own onError if they supplied one.
    if (typeof onError === "function") onError({} as React.SyntheticEvent<HTMLImageElement>);
  }

  return (
    <Image
      {...props}
      src={imgSrc}
      alt={alt}
      onError={handleError}
    />
  );
}
