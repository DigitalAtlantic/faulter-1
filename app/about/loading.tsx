// H-1 FIX — About page loading skeleton.
// about/page.tsx is now fully static (the root layout no longer calls
// headers() on every request — see the CSP-strategy comment in
// app/layout.tsx and middleware.ts). This skeleton still covers the brief
// loading state during navigation/build and ensures visual continuity with
// the real page.
//
// Four sections match the page exactly:
//   1. Mission — eyebrow, h1, three prose paragraphs
//   2. Editorial standards — h2, 3-column cards with accent gutter
//   3. Our Journalists — h2, 4-column author grid (square avatar + bio)
//   4. Corrections — h2, two paragraphs
export default function Loading() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8 animate-pulse">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-8">
        <div className="h-2.5 w-10 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-2.5 w-2  bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-2.5 w-12 bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* ── Section 1: Mission ───────────────────────────────────────────── */}
      <section className="max-w-3xl mb-16 space-y-4">
        {/* Eyebrow */}
        <div className="h-2.5 w-24 bg-paper-secondary dark:bg-zinc-800" />
        {/* h1 — two long lines */}
        <div className="space-y-2">
          <div className="h-10 w-full bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-10 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
        </div>
        {/* Three prose paragraphs */}
        {[
          [1, 0.97, 0.93, 0.88, 0.95, 0.7],
          [1, 0.96, 0.91, 0.85, 0.9, 0.75],
          [1, 0.92, 0.8],
        ].map((lines, p) => (
          <div key={p} className="space-y-2">
            {lines.map((w, j) => (
              <div
                key={j}
                className="h-4 bg-paper-secondary dark:bg-zinc-800"
                style={{ width: `${w * 100}%` }}
              />
            ))}
          </div>
        ))}
      </section>

      <div className="border-t border-border dark:border-border-dark mb-16" />

      {/* ── Section 2: Editorial standards — 3-column card grid ─────────── */}
      <section className="mb-16">
        <div className="h-7 w-56 bg-paper-secondary dark:bg-zinc-800 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-l-4 border-paper-secondary dark:border-zinc-700 pl-5 space-y-2">
              <div className="h-5 w-32 bg-paper-secondary dark:bg-zinc-800" />
              <div className="space-y-1.5">
                <div className="h-3 w-full  bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-3 w-11/12 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-3 w-4/5   bg-paper-secondary dark:bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-border dark:border-border-dark mb-16" />

      {/* ── Section 3: Our Journalists — 4-column author grid ───────────── */}
      <section className="mb-16">
        <div className="h-7 w-40 bg-paper-secondary dark:bg-zinc-800 mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="space-y-2">
              {/* Square author avatar */}
              <div className="w-full aspect-square bg-paper-secondary dark:bg-zinc-800 mb-4" />
              {/* Name */}
              <div className="h-5 w-32 bg-paper-secondary dark:bg-zinc-800" />
              {/* Role */}
              <div className="h-2.5 w-24 bg-paper-secondary dark:bg-zinc-800" />
              {/* Bio — 3 lines */}
              <div className="space-y-1.5 mt-2">
                <div className="h-3 w-full  bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-3 w-10/12 bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-3 w-4/5   bg-paper-secondary dark:bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-border dark:border-border-dark mb-16" />

      {/* ── Section 4: Corrections policy ───────────────────────────────── */}
      <section className="max-w-3xl mb-16 space-y-4">
        <div className="h-7 w-52 bg-paper-secondary dark:bg-zinc-800 mb-4" />
        {[
          [1, 0.96, 0.91, 0.88, 0.7],
          [1, 0.93, 0.85, 0.65],
        ].map((lines, p) => (
          <div key={p} className="space-y-2">
            {lines.map((w, j) => (
              <div
                key={j}
                className="h-4 bg-paper-secondary dark:bg-zinc-800"
                style={{ width: `${w * 100}%` }}
              />
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
