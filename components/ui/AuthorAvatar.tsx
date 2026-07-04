"use client";

import Image from "next/image";
import { useCallback, useState } from "react";

interface AuthorAvatarProps {
  src: string;
  name: string;
  size?: number;
  className?: string;
}

/**
 * AuthorAvatar — wraps next/image with an inline SVG fallback.
 * If the external avatar URL fails (e.g. the avatar URL is unreachable),
 * the component falls back to a generated monogram avatar so the UI
 * never shows a broken image.
 *
 * H-2 fix: the fallback monogram previously set `style={{ width, height,
 * fontSize }}` as an HTML attribute, requiring `style-src 'unsafe-inline'`
 * in the CSP.  We now use a callback ref to set CSS custom properties via
 * the DOM API (element.style.setProperty), which is governed by `script-src`
 * rather than `style-src`.  The sizing rules live in globals.css:
 *   .author-avatar-monogram { width: var(--av-size); height: var(--av-size);
 *                              font-size: var(--av-font); }
 */
export function AuthorAvatar({
  src,
  name,
  size = 40,
  className = "",
}: AuthorAvatarProps) {
  const [errored, setErrored] = useState(false);

  // Derive initials from name, up to 2 characters
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  // Callback ref: fires when the monogram span mounts (i.e. when errored
  // becomes true).  Sets CSS custom properties so no style= attribute is
  // written to the HTML and no `unsafe-inline` is needed in style-src.
  const setMonogramRef = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!node) return;
      node.style.setProperty("--av-size", `${size}px`);
      node.style.setProperty("--av-font", `${(size * 0.38).toFixed(1)}px`);
    },
    [size]
  );

  if (errored) {
    return (
      <span
        ref={setMonogramRef}
        className={`author-avatar-monogram inline-flex items-center justify-center
                    rounded-full bg-accent text-white font-bold font-sans
                    flex-shrink-0 ${className}`}
        aria-label={name}
      >
        {initials}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      className={`rounded-full object-cover flex-shrink-0 ${className}`}
      onError={() => setErrored(true)}
    />
  );
}
