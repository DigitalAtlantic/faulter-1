// Article (ad-layout) route loading skeleton.
//
// The article page uses a 2-column grid:
//   col 1 (main): fluid content — breadcrumb, header, image, prose, tags,
//                 ad slots, related stories
//   col 2 (sidebar): fixed 300 px, hidden below md breakpoint
//
// Every section below maps 1-to-1 to a section in page.tsx so the transition
// from skeleton → real content is seamless with no layout shift.
//
// `md:grid-cols-[1fr_300px]` matches the grid in page.tsx exactly.
export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* ── Top leaderboard ad placeholder (AD_SLOT_TOP) ──────────────────
          Matches: max-w-screen-xl mx-auto px-4 wrapping AdSlot */}
      <div className="max-w-screen-xl mx-auto px-4">
        <div className="h-[90px] bg-paper-secondary dark:bg-zinc-800 mb-2" />
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6">
        {/* ── Breadcrumb nav ─────────────────────────────────────────────
            Matches: nav mb-4 with Home › Category › Title */}
        <nav className="mb-4 flex items-center gap-2">
          <div className="h-3 w-10 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-3 w-2 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-3 w-20 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-3 w-2 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-3 w-48 bg-paper-secondary dark:bg-zinc-800" />
        </nav>

        {/* ── Two-column grid ────────────────────────────────────────────
            Matches: grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8 items-start */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8 items-start">

          {/* ── Left column: main article ─────────────────────────────── */}
          <main className="min-w-0">

            {/* Article header — category badge + h1 + excerpt + meta row */}
            <header className="mb-6">
              {/* Category badge (text-xs uppercase) */}
              <div className="h-4 w-20 bg-paper-secondary dark:bg-zinc-800 mb-2" />

              {/* h1 — two lines for a typical headline */}
              <div className="space-y-2 mt-2">
                <div className="h-9 w-full bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-9 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
              </div>

              {/* Excerpt / deck */}
              <div className="mt-3 space-y-2">
                <div className="h-5 w-full bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-5 w-11/12 bg-paper-secondary dark:bg-zinc-800" />
              </div>

              {/* Meta row: author avatar + name + date + reading time */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-paper-secondary dark:bg-zinc-800 shrink-0" />
                <div className="h-3 w-28 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-3 w-24 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-3 w-16 bg-paper-secondary dark:bg-zinc-800" />
              </div>
            </header>

            {/* Featured image — aspect-[16/9] with optional caption */}
            <div className="relative w-full aspect-[16/9] mb-6 overflow-hidden rounded-sm bg-paper-secondary dark:bg-zinc-800" />

            {/* Article body prose — simulate three paragraphs */}
            <div className="space-y-3 mb-6">
              {[1, 0.97, 0.93, 0.88, 1, 0.85].map((w, i) => (
                <div
                  key={i}
                  className="h-4 bg-paper-secondary dark:bg-zinc-800"
                  style={{ width: `${w * 100}%` }}
                />
              ))}
              <div className="h-4" />
              {[0.96, 1, 0.92, 0.87, 1, 0.7].map((w, i) => (
                <div
                  key={`b${i}`}
                  className="h-4 bg-paper-secondary dark:bg-zinc-800"
                  style={{ width: `${w * 100}%` }}
                />
              ))}
              <div className="h-4" />
              {[1, 0.94, 0.9, 0.6].map((w, i) => (
                <div
                  key={`c${i}`}
                  className="h-4 bg-paper-secondary dark:bg-zinc-800"
                  style={{ width: `${w * 100}%` }}
                />
              ))}
            </div>

            {/* Mid ad slots (AD_SLOT_MID_1, AD_SLOT_MID_2) */}
            <div className="h-[90px] bg-paper-secondary dark:bg-zinc-800 my-6" />

            {/* Tags row */}
            <div className="mt-8 flex flex-wrap gap-2">
              <div className="h-3 w-8 bg-paper-secondary dark:bg-zinc-800" />
              {[48, 56, 64, 40, 52].map((w, i) => (
                <div
                  key={i}
                  className="h-6 bg-paper-secondary dark:bg-zinc-800"
                  style={{ width: w }}
                />
              ))}
            </div>

            {/* Bottom ad slot (AD_SLOT_BOTTOM) */}
            <div className="h-[90px] bg-paper-secondary dark:bg-zinc-800 mt-8" />

            {/* Related articles — section heading + list */}
            <section className="mt-8 border-t border-border dark:border-border-dark pt-6">
              <div className="h-5 w-36 bg-paper-secondary dark:bg-zinc-800 mb-4" />
              <ul className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="space-y-1.5">
                    <div className="h-3 w-16 bg-paper-secondary dark:bg-zinc-800" />
                    <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
                    <div className="h-4 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
                  </li>
                ))}
              </ul>
            </section>
          </main>

          {/* ── Right column: sidebar (hidden below md) ───────────────── */}
          <aside className="hidden md:block">
            <div className="sticky top-2 space-y-6">
              {/* Sidebar ad (AD_SLOT_SIDEBAR) — 300×600 */}
              <div className="h-[600px] bg-paper-secondary dark:bg-zinc-800" />
              {/* Newsletter promo below sidebar ad */}
              <div className="border border-border dark:border-border-dark p-4 space-y-2">
                <div className="h-3 w-24 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-5 w-40 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-9 w-full bg-paper-secondary dark:bg-zinc-800 mt-2" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
