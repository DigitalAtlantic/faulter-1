// Loading skeleton for /newsletter, mirroring app/subscribe/loading.tsx.
// NewsletterSignup ("inline" variant) is a "use client" component, so this
// skeleton renders during the JS bundle download + hydration phase,
// eliminating the blank-page flash — same rationale as the subscribe
// page's H-1 fix.
export default function Loading() {
  return (
    <div className="max-w-2xl mx-auto px-5 py-16 animate-pulse">
      {/* Eyebrow label: "Newsletter" */}
      <div className="text-center mb-10">
        <div className="h-2.5 w-20 bg-paper-secondary dark:bg-zinc-800 mx-auto mb-6" />

        {/* h1 — two lines, large serif headline */}
        <div className="space-y-3 mb-4">
          <div className="h-11 w-full bg-paper-secondary dark:bg-zinc-800 mx-auto" />
          <div className="h-11 w-5/6 bg-paper-secondary dark:bg-zinc-800 mx-auto" />
        </div>

        {/* Subtitle paragraph */}
        <div className="space-y-2">
          <div className="h-5 w-full bg-paper-secondary dark:bg-zinc-800 mx-auto" />
          <div className="h-5 w-11/12 bg-paper-secondary dark:bg-zinc-800 mx-auto" />
          <div className="h-5 w-3/4 bg-paper-secondary dark:bg-zinc-800 mx-auto" />
        </div>
      </div>

      {/* NewsletterSignup "inline" variant skeleton */}
      <div className="border border-border dark:border-border-dark p-8">
        <div className="h-2.5 w-20 bg-paper-secondary dark:bg-zinc-700 mb-2" />
        <div className="h-7 w-72 bg-paper-secondary dark:bg-zinc-700 mb-2" />
        <div className="h-4 w-80 bg-paper-secondary dark:bg-zinc-700 mb-5" />
        <div className="flex gap-2">
          <div className="h-11 flex-1 border border-border dark:border-border-dark bg-paper-secondary dark:bg-zinc-800" />
          <div className="h-11 w-28 bg-paper-secondary dark:bg-zinc-800" />
        </div>
      </div>

      {/* Fine-print line */}
      <div className="h-2.5 w-56 bg-paper-secondary dark:bg-zinc-800 mx-auto mt-6" />

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
