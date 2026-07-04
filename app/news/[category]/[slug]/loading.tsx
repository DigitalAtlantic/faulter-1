// H-1 FIX — Article route loading skeleton.
// The article page is the highest-traffic route on the site.
// CRIT-1 correction: this route is fully dynamically rendered on every
// request (see app/news/[category]/[slug]/page.tsx) -- there is no
// build-time pre-rendering to fall back on, only a CDN-edge cache. So this
// boundary is hit on every CDN cache-miss, not just an occasional cold path.
// Without this file Next.js shows a blank white page until the full RSC
// payload streams in.  With it, the nearest Suspense boundary (the root
// layout) renders this skeleton immediately while the real page loads.
//
// Every section below maps 1-to-1 to a section in page.tsx so the transition
// from skeleton → content is seamless with no layout shift.
export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* ── Breadcrumb bar ──────────────────────────────────────────────────
          Matches the bg-paper-warm strip above the main grid in page.tsx. */}
      <div className="bg-paper-warm dark:bg-zinc-900 border-b border-border dark:border-border-dark">
        <div className="max-w-screen-xl mx-auto px-5 py-2">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-10 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-2.5 w-2 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-2.5 w-20 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-2.5 w-2 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-2.5 w-48 bg-paper-secondary dark:bg-zinc-800" />
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-5 py-8">
        {/* ── Two-column grid: article + sidebar ──────────────────────────
            Matches: grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">

          {/* ── Left column: article ────────────────────────────────────── */}
          <div className="min-w-0 space-y-0">

            {/* Article header */}
            <header className="mb-6 space-y-4">
              {/* Category badge */}
              <div className="h-5 w-20 bg-paper-secondary dark:bg-zinc-800" />

              {/* h1 — three lines to mirror a long headline */}
              <div className="space-y-2">
                <div className="h-9 w-full bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-9 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-9 w-3/5 bg-paper-secondary dark:bg-zinc-800" />
              </div>

              {/* Excerpt — border-l-4 accent bar block */}
              <div className="border-l-4 border-paper-secondary dark:border-zinc-700 pl-4 space-y-2">
                <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-4 w-11/12 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-4 w-3/4 bg-paper-secondary dark:bg-zinc-800" />
              </div>

              {/* Meta row: avatar + author + date + reading time | controls */}
              <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-t border-b border-border dark:border-border-dark">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-paper-secondary dark:bg-zinc-800 shrink-0" />
                  <div className="space-y-1.5">
                    <div className="h-3.5 w-28 bg-paper-secondary dark:bg-zinc-800" />
                    <div className="h-2.5 w-36 bg-paper-secondary dark:bg-zinc-800" />
                  </div>
                </div>
                {/* Controls placeholder (reading controls + bookmark + share) */}
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 bg-paper-secondary dark:bg-zinc-800" />
                  <div className="h-8 w-24 bg-paper-secondary dark:bg-zinc-800" />
                  <div className="h-8 w-20 bg-paper-secondary dark:bg-zinc-800" />
                </div>
              </div>
            </header>

            {/* Featured image — aspect-[16/9] */}
            <figure className="mb-8">
              <div className="relative aspect-[16/9] bg-paper-secondary dark:bg-zinc-800" />
              {/* Optional caption line */}
              <div className="h-2.5 w-40 bg-paper-secondary dark:bg-zinc-800 mt-2" />
            </figure>

            {/* Article body — simulate several paragraphs of prose */}
            <div className="space-y-3 mb-8">
              {[1, 0.95, 0.9, 1, 0.85, 0.92, 1, 0.88].map((w, i) => (
                <div
                  key={i}
                  className="h-4 bg-paper-secondary dark:bg-zinc-800"
                  style={{ width: `${w * 100}%` }}
                />
              ))}
              {/* Paragraph break */}
              <div className="h-4" />
              {[0.97, 1, 0.93, 0.89, 1, 0.6].map((w, i) => (
                <div
                  key={`b${i}`}
                  className="h-4 bg-paper-secondary dark:bg-zinc-800"
                  style={{ width: `${w * 100}%` }}
                />
              ))}
              <div className="h-4" />
              {[1, 0.94, 0.88, 0.75].map((w, i) => (
                <div
                  key={`c${i}`}
                  className="h-4 bg-paper-secondary dark:bg-zinc-800"
                  style={{ width: `${w * 100}%` }}
                />
              ))}
            </div>

            {/* Tags row */}
            <div className="mt-8 pt-6 border-t border-border dark:border-border-dark flex flex-wrap gap-2">
              <div className="h-4 w-8 bg-paper-secondary dark:bg-zinc-800" />
              {[48, 56, 64, 40, 52].map((w, i) => (
                <div key={i} className="h-6 bg-paper-secondary dark:bg-zinc-800" style={{ width: w }} />
              ))}
            </div>

            {/* Bottom share / bookmark row */}
            <div className="mt-8 pt-6 border-t border-border dark:border-border-dark flex flex-wrap items-center gap-4">
              <div className="h-8 w-24 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-8 w-28 bg-paper-secondary dark:bg-zinc-800" />
            </div>

            {/* Author box */}
            <div className="mt-10 p-6 border border-border dark:border-border-dark bg-paper-warm dark:bg-zinc-900">
              <div className="flex gap-4">
                <div className="w-16 h-16 rounded-full bg-paper-secondary dark:bg-zinc-800 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-2.5 w-24 bg-paper-secondary dark:bg-zinc-800" />
                  <div className="h-5 w-36 bg-paper-secondary dark:bg-zinc-800" />
                  <div className="h-2.5 w-28 bg-paper-secondary dark:bg-zinc-800" />
                  <div className="h-3 w-full bg-paper-secondary dark:bg-zinc-800" />
                  <div className="h-3 w-5/6 bg-paper-secondary dark:bg-zinc-800" />
                </div>
              </div>
            </div>

            {/* Newsletter inline block */}
            <div className="mt-8 p-8 border border-border dark:border-border-dark space-y-3">
              <div className="h-3 w-24 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-6 w-64 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-4 w-full max-w-sm bg-paper-secondary dark:bg-zinc-800" />
              <div className="flex gap-2 mt-2">
                <div className="h-11 flex-1 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-11 w-28 bg-paper-secondary dark:bg-zinc-800" />
              </div>
            </div>

            {/* Related stories — section heading + 3-column grid */}
            <section className="mt-10">
              <div className="mb-6 pb-3 border-b-2 border-paper-secondary dark:border-zinc-700">
                <div className="h-6 w-40 bg-paper-secondary dark:bg-zinc-800" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-3">
                    <div className="aspect-[16/10] bg-paper-secondary dark:bg-zinc-800" />
                    <div className="h-3 w-14 bg-paper-secondary dark:bg-zinc-800" />
                    <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
                    <div className="h-4 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
                    <div className="h-3 w-20 bg-paper-secondary dark:bg-zinc-800" />
                  </div>
                ))}
              </div>
            </section>

            {/* Prev / Next navigation */}
            <div className="mt-10 pt-8 border-t-2 border-paper-secondary dark:border-zinc-700 grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="h-2.5 w-14 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-4 w-3/4 bg-paper-secondary dark:bg-zinc-800" />
              </div>
              <div className="space-y-2 text-right">
                <div className="h-2.5 w-10 bg-paper-secondary dark:bg-zinc-800 ml-auto" />
                <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-4 w-4/5 bg-paper-secondary dark:bg-zinc-800 ml-auto" />
              </div>
            </div>
          </div>

          {/* ── Right column: sidebar (desktop only) ────────────────────── */}
          <div className="hidden lg:block space-y-4">
            <div className="h-48 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-64 bg-paper-secondary dark:bg-zinc-800" />
          </div>
        </div>
      </div>
    </div>
  );
}
