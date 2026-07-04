// H-1 FIX — Subscribe page loading skeleton.
// subscribe/page.tsx is a "use client" component. This skeleton renders during
// the JS bundle download + hydration phase, eliminating the blank-page flash.
//
// Layout mirrors page.tsx: centred max-w-2xl column, headline block, form row,
// and the three value-prop cards at the bottom.
export default function Loading() {
  return (
    <div className="max-w-2xl mx-auto px-5 py-16 text-center animate-pulse">
      {/* Eyebrow label: "Newsletter" */}
      <div className="h-2.5 w-20 bg-paper-secondary dark:bg-zinc-800 mx-auto mb-6" />

      {/* h1 — two lines, large serif headline */}
      <div className="space-y-3 mb-4">
        <div className="h-11 w-full  bg-paper-secondary dark:bg-zinc-800 mx-auto" />
        <div className="h-11 w-5/6  bg-paper-secondary dark:bg-zinc-800 mx-auto" />
      </div>

      {/* Subtitle paragraph */}
      <div className="space-y-2 mb-10">
        <div className="h-5 w-full bg-paper-secondary dark:bg-zinc-800 mx-auto" />
        <div className="h-5 w-11/12 bg-paper-secondary dark:bg-zinc-800 mx-auto" />
        <div className="h-5 w-3/4   bg-paper-secondary dark:bg-zinc-800 mx-auto" />
      </div>

      {/* Email input + subscribe button row (max-w-md centred) */}
      <div className="flex gap-2 max-w-md mx-auto mb-3">
        <div className="h-12 flex-1 border border-border dark:border-border-dark bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-12 w-32   bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* Fine-print line */}
      <div className="h-2.5 w-56 bg-paper-secondary dark:bg-zinc-800 mx-auto" />

      {/* Three value-prop cards */}
      <div className="mt-16 pt-10 border-t border-border dark:border-border-dark grid grid-cols-1 sm:grid-cols-3 gap-8 text-left">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-2.5 w-12 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-5   w-36 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-3   w-full bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-3   w-4/5  bg-paper-secondary dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
