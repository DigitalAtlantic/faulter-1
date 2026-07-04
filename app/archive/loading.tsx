// M-10 FIX -- Per-route loading skeleton.
// Without this file, a cold ISR miss on the archive page would show blank
// content until the full server render completes.  This skeleton renders
// immediately from the nearest Suspense boundary while the page streams in.
export default function Loading() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8 animate-pulse">
      {/* Page title skeleton */}
      <div className="mb-8 space-y-3 border-b border-border dark:border-border-dark pb-6">
        <div className="h-8 w-40 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-3 w-56 bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* Filter bar skeleton */}
      <div className="flex gap-3 mb-8 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-20 bg-paper-secondary dark:bg-zinc-800 rounded-full" />
        ))}
      </div>

      {/* Article list skeleton */}
      <div className="space-y-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-4 pb-5 border-b border-border dark:border-border-dark"
          >
            <div className="w-28 h-20 shrink-0 bg-paper-secondary dark:bg-zinc-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-14 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-4 w-2/3 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-3 w-20 bg-paper-secondary dark:bg-zinc-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
