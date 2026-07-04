// H-1 FIX — Bookmarks page loading skeleton.
// bookmarks/page.tsx is a "use client" component. There are two blank-page
// phases without this file:
//   1. JS bundle download + hydration (Next.js SSR sends minimal HTML)
//   2. The !mounted branch while localStorage is read + the Server Action runs
//
// Phase 1 is covered by this file (renders from the Suspense boundary).
// Phase 2 is already handled by the inline !mounted skeleton inside the page.
// Together they eliminate all blank-flash for this route.
//
// The shape here matches the page header and the !mounted card grid exactly.
export default function Loading() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8 animate-pulse">
      {/* Breadcrumb: Home / Saved Stories */}
      <div className="flex items-center gap-2 mb-6">
        <div className="h-2.5 w-10 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-2.5 w-2  bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-2.5 w-24 bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* Page header row: h1 + count on left, clear-all button on right */}
      <div className="mb-8 pb-6 border-b-2 border-paper-secondary dark:border-zinc-700 flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-9 w-56 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-3  w-28 bg-paper-secondary dark:bg-zinc-800" />
        </div>
        {/* Clear-all ghost button */}
        <div className="h-9 w-20 border border-border dark:border-border-dark bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* Article grid — 3 columns, matches the page's !mounted skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <div className="aspect-[16/10] bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-4 w-3/4 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-4 w-1/2 bg-paper-secondary dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
