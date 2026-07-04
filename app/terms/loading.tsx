// H-1 FIX — Terms of Service page loading skeleton.
// terms/page.tsx is now fully static (the root layout no longer calls
// headers() on every request — see the CSP-strategy comment in
// app/layout.tsx and middleware.ts). This skeleton still covers the brief
// loading state during navigation/build. The shape mirrors the actual page:
// breadcrumb, h1 header, then the numbered section list with h2 + body
// paragraph pairs.
export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-8 animate-pulse">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-8">
        <div className="h-2.5 w-10 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-2.5 w-2  bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-2.5 w-28 bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* Page header */}
      <div className="mb-10 space-y-3">
        <div className="h-9 w-56 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-3  w-32 bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* 9 section blocks — matches TermsPage sections array */}
      <div className="space-y-8">
        {[
          { h: 44, lines: [1, 0.92, 0.85] },
          { h: 44, lines: [1, 0.95, 1, 0.88, 0.7] },
          { h: 44, lines: [1, 0.96, 0.91, 0.78] },
          { h: 44, lines: [1, 0.9, 0.6] },
          { h: 44, lines: [1, 0.93, 0.82, 0.7] },
          { h: 44, lines: [1, 0.88, 0.65] },
          { h: 44, lines: [1, 0.85] },
          { h: 44, lines: [1, 0.9, 0.72] },
          { h: 44, lines: [0.6] },
        ].map((section, i) => (
          <section key={i} className="space-y-3">
            <div className="h-5" style={{ width: section.h + 4 * i }} >
              <div className="h-5 bg-paper-secondary dark:bg-zinc-800 w-full" />
            </div>
            <div className="space-y-2">
              {section.lines.map((w, j) => (
                <div
                  key={j}
                  className="h-4 bg-paper-secondary dark:bg-zinc-800"
                  style={{ width: `${w * 100}%` }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
