// H-1 FIX — Contact page loading skeleton.
// contact/page.tsx is a "use client" component.  On a cold ISR miss or first
// visit, Next.js must download, parse, and hydrate the JS bundle before
// anything interactive appears.  This skeleton fills that gap immediately,
// eliminating the blank-page flash.
//
// Every block below matches a real section in contact/page.tsx so the
// transition from skeleton → hydrated content has no layout shift.
export default function Loading() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8 animate-pulse">
      {/* Breadcrumb: Home / Contact */}
      <div className="flex items-center gap-2 mb-8">
        <div className="h-2.5 w-10 bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-2.5 w-2  bg-paper-secondary dark:bg-zinc-800" />
        <div className="h-2.5 w-14 bg-paper-secondary dark:bg-zinc-800" />
      </div>

      {/* Two-column grid: info left, form right.
          Matches: grid grid-cols-1 lg:grid-cols-2 gap-16 max-w-4xl */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 max-w-4xl">

        {/* ── Left: heading + contact types ─────────────────────────────── */}
        <div>
          {/* Eyebrow label */}
          <div className="h-2.5 w-20 bg-paper-secondary dark:bg-zinc-800 mb-4" />
          {/* h1 */}
          <div className="space-y-2 mb-6">
            <div className="h-9 w-full  bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-9 w-4/5  bg-paper-secondary dark:bg-zinc-800" />
          </div>
          {/* Intro paragraph */}
          <div className="space-y-2 mb-8">
            <div className="h-4 w-full  bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-4 w-11/12 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-4 w-3/4   bg-paper-secondary dark:bg-zinc-800" />
          </div>
          {/* Four contact-type blocks, each with border-l-4 accent gutter */}
          <div className="space-y-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border-l-4 border-paper-secondary dark:border-zinc-700 pl-4 space-y-1.5">
                <div className="h-4 w-24  bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-3 w-48  bg-paper-secondary dark:bg-zinc-800" />
                <div className="h-3 w-36  bg-paper-secondary dark:bg-zinc-800" />
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: form ───────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Name field */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-10 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-11 w-full border border-border dark:border-border-dark bg-paper-secondary dark:bg-zinc-800" />
          </div>
          {/* Email field */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-10 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-11 w-full border border-border dark:border-border-dark bg-paper-secondary dark:bg-zinc-800" />
          </div>
          {/* Subject select */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-14 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-11 w-full border border-border dark:border-border-dark bg-paper-secondary dark:bg-zinc-800" />
          </div>
          {/* Message textarea — matches rows={6} */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-16 bg-paper-secondary dark:bg-zinc-800" />
            <div className="h-36 w-full border border-border dark:border-border-dark bg-paper-secondary dark:bg-zinc-800" />
          </div>
          {/* Submit button */}
          <div className="h-12 w-full bg-paper-secondary dark:bg-zinc-800" />
        </div>
      </div>
    </div>
  );
}
