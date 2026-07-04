// M-10 FIX -- Per-route loading skeleton.
// Without this file, a cold ISR miss on an author page would show a blank
// content area until the full server render completes.  This skeleton renders
// immediately from the nearest Suspense boundary while the page streams in.
export default function Loading() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8 animate-pulse">
      {/* Author header skeleton */}
      <div className="flex items-center gap-5 mb-10 pb-8 border-b border-border dark:border-border-dark">
        <div className="w-20 h-20 rounded-full bg-paper-secondary dark:bg-zinc-800 shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-6 w-48 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-3 w-32 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-3 w-full max-w-sm bg-paper-secondary dark:bg-zinc-800" />
        </div>
      </div>

      {/* Article grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="aspect-[16/10] bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-3 w-14 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-4 w-full bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-4 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-3 w-20 bg-paper-secondary dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
