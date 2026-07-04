"use client";

import { useState, useEffect } from "react";
import { formatRelativeTime } from "@/lib/utils";

interface RelativeTimeProps {
  dateTime: string;
  title?: string;
  className?: string;
}

/**
 * Finding 7 fix: render an absolute date server-side so cached pages never
 * show a blank <time> element until JS hydrates.
 *
 * Strategy:
 *   - Server (and initial client render): display an absolute date string,
 *     e.g. "Jun 25, 2026", derived directly from the dateTime ISO prop.
 *     This is deterministic and timezone-agnostic for the date portion used
 *     here (year/month/day only, not hours), so there is no hydration
 *     mismatch for the vast majority of visitors.
 *   - After first client paint: useEffect swaps the absolute date for the
 *     relative label ("2h ago", "3d ago", …) that reflects the visitor's
 *     actual clock rather than ISR generation time.
 *
 * suppressHydrationWarning is kept on <time> to silence the expected diff
 * between the server's absolute date and the client's relative label.
 */
function formatAbsoluteDate(dateTime: string): string {
  return new Date(dateTime).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RelativeTime({ dateTime, title, className }: RelativeTimeProps) {
  // Initialise with the absolute date so cached/SSR HTML is never blank.
  const [label, setLabel] = useState<string>(() => formatAbsoluteDate(dateTime));

  useEffect(() => {
    // Replace with the live relative label once the client has the real clock.
    setLabel(formatRelativeTime(dateTime));
  }, [dateTime]);

  return (
    <time
      dateTime={dateTime}
      title={title}
      className={className}
      suppressHydrationWarning
    >
      {label}
    </time>
  );
}
