// M-10 FIX -- Per-route loading skeleton.
// Without this file, a cold ISR miss on a category page would show a blank
// content area until the full server render completes.  This skeleton renders
// immediately from the nearest Suspense boundary while the page streams in.
export default function Loading() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8 animate-pulse">
      {/* Page title skeleton */}
      <div className="mb-8 space-y-3 border-b border-border dark:border-border-dark pb-6">
        <div className="h-3 w-20 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-8 w-64 bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* Article grid skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="aspect-[16/10] bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-3 w-14 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-4 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-3 w-20 bg-paper-secondary dark:bg-zinc-800" />
            </div>
          ))}
        </div>
        <div className="hidden lg:block space-y-4">
          <div className="h-48 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-64 bg-paper-secondary dark:bg-zinc-800" />
        </div>
      </div>
    </div>
  );
}
