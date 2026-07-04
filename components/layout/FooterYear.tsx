"use client";

/**
 * FINDING 1 fix: convert FooterYear to a client component so the copyright
 * year is always correct, even when a long-lived ISR cache spans New Year's.
 *
 * How it works:
 * - BUILD_YEAR is evaluated once at build time (module initialisation).
 *   It is used as the server-render / first-paint value so SSR and the initial
 *   client render agree, eliminating any React hydration mismatch.
 * - useEffect runs on the client after hydration and corrects the year if the
 *   cached HTML was built in a prior year (the New Year's window bug).
 * - suppressHydrationWarning is kept as a belt-and-suspenders guard for any
 *   remaining edge cases (e.g. server timezone vs. client timezone skew).
 *
 * Impact: zero effect on Cloudflare cache hit ratio or origin load.
 * Fixes: incorrect copyright year visible for up to 25 h after midnight Jan 1.
 */

import { useState, useEffect } from "react";

// Evaluated once when the module is first imported during the Next.js build.
// This value is baked into the server-rendered HTML and never changes between
// deployments, so server and client always agree on first render.
const BUILD_YEAR = new Date().getFullYear();

export function FooterYear() {
  const [year, setYear] = useState(BUILD_YEAR);

  useEffect(() => {
    // Correct the year on the client in case the ISR snapshot was generated
    // before New Year and is now being served in the following year.
    setYear(new Date().getFullYear());
  }, []);

  return <span suppressHydrationWarning>{year}</span>;
}
