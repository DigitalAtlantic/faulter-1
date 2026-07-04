// H-1 FIX — Privacy Policy page loading skeleton.
// privacy/page.tsx is now fully static (the root layout no longer calls
// headers() on every request — see the CSP-strategy comment in
// app/layout.tsx and middleware.ts). This skeleton still covers the brief
// loading state during navigation/build, matching terms/loading.tsx.
//
// Shape mirrors privacy/page.tsx: breadcrumb, h1 header, 7 section blocks.
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
        <div className="h-9 w-48 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-3  w-32 bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* 7 section blocks — matches PrivacyPage sections array */}
      <div className="space-y-8">
        {[
          [1, 0.95, 1, 0.88],
          [1, 0.97, 0.93, 1, 0.9, 0.82, 0.75],
          [1, 0.96, 0.92, 1, 0.87, 0.78],
          [1, 0.9, 0.85, 0.7],
          [1, 0.88, 0.8],
          [1, 0.95, 1, 0.87, 0.93, 0.6],
          [1, 0.7],
        ].map((lines, i) => (
          <section key={i} className="space-y-3">
            <div className="h-5 w-48 bg-paper-secondary dark:bg-zinc-800" />
            <div className="space-y-2">
              {lines.map((w, j) => (
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
