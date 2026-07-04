export default function Loading() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8 animate-pulse">
      {/* Hero skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
        <div className="lg:col-span-2 aspect-[21/9] bg-paper-secondary dark:bg-zinc-800" />
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2 border-b border-border dark:border-border-dark pb-5">
              <div className="h-3 w-14 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-5 w-full bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-5 w-4/5 bg-paper-secondary dark:bg-zinc-800" />
              <div className="h-3 w-24 bg-paper-secondary dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
        <div className="grid grid-cols-3 gap-6">
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
        <div className="hidden lg:block space-y-4">
          <div className="h-48 bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-64 bg-paper-secondary dark:bg-zinc-800" />
        </div>
      </div>
    </div>
  );
}
