// M-10 FIX -- Per-route loading skeleton.
// Without this file, the search page would show blank content until the server
// finishes rendering (including any data fetches).  This skeleton renders
// immediately from the nearest Suspense boundary while the page streams in.
export default function Loading() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8 animate-pulse">
      {/* Search bar skeleton */}
      <div className="mb-8 space-y-4">
        <div className="h-8 w-48 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-12 w-full max-w-2xl bg-paper-secondary dark:bg-zinc-800 rounded" />
      </div>

      {/* Results skeleton */}
      <div className="space-y-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-4 pb-6 border-b border-border dark:border-border-dark"
          >
            <div className="w-32 h-24 shrink-0 bg-paper-secondary dark:bg-zinc-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-16 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-5 w-full bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-5 w-3/4 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-3 w-24 bg-paper-secondary dark:bg-zinc-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
