import Link from "next/link";
import { NewsletterSignup } from "@/components/ui/NewsletterSignup";

// Fixes the dead /newsletter link rendered in the sidebar of
// app/article/[slug]/page.tsx ("Subscribe — it's free" → href="/newsletter"),
// which previously had no matching route and 404'd.
//
// This is a distinct, server-rendered page rather than a redirect to
// /subscribe: /subscribe is itself a "use client" page (see its own
// comments) built around a bespoke inline form, whereas this page reuses
// the shared NewsletterSignup component ("inline" variant) already used
// elsewhere on the site (e.g. FooterNewsletter), so the route stays a thin,
// server-rendered wrapper instead of duplicating client-side form logic.

// FINDING 4 fix: declare static rendering intent explicitly.
// The shell is fully build-time static — no DB/CMS data, no dynamic APIs.
// next.config.mjs sets CDN-Cache-Control: max-age=86400 for /newsletter,
// consistent with a build-time-only page.
// Declaring this:
//   (a) makes the intent auditable and consistent with every other page in
//       the app (all of which carry an explicit revalidate);
//   (b) prevents a future developer from unknowingly defeating ISR by adding
//       server-side data fetching without also adding an explicit revalidate TTL.
//
// FINDING 3 (cache-config alignment): revalidate = false means this page is
// built once at deploy time and never regenerated on the server. Combined
// with next.config.mjs's CDN-Cache-Control: max-age=86400,
// stale-while-revalidate=86400 for this route, Cloudflare may continue
// serving a pre-deploy snapshot for up to ~48h (24h edge TTL + 24h SWR)
// after a redeploy. There is no on-demand revalidation webhook wired up for
// /newsletter (see app/api/revalidate/route.ts).
//
// This is fine today because the content here never changes outside of a
// full redeploy. BUT: if this page's copy or the NewsletterSignup content it
// renders ever becomes content-driven (CMS/DB-backed) or is edited
// out-of-band from a deploy, you MUST do one of the following or visitors
// can see stale HTML for up to 48 hours:
//   1. Trigger a Cloudflare cache purge for /newsletter after the edit, or
//   2. Add "/newsletter" to the on-demand revalidation webhook
//      (app/api/revalidate/route.ts) and switch this back to a
//      time-based `revalidate` value (or call revalidatePath("/newsletter")
//      from the webhook), or
//   3. Do a full redeploy, which rebuilds this route fresh at the origin
//      (though the CDN may still serve the old edge copy until its TTL
//      and stale-while-revalidate window elapse).
export const revalidate = false; // static: HTML is build-time only, no DB/CMS data

export default function NewsletterPage() {
  return (
    <div className="max-w-2xl mx-auto px-5 py-16">
      <div className="text-center mb-10">
        <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-6">Newsletter</p>
        <h1 className="font-serif text-4xl lg:text-5xl font-black text-ink dark:text-zinc-100 mb-4 leading-tight">
          The Faulter Morning Briefing
        </h1>
        <p className="text-lg font-sans text-ink-secondary dark:text-zinc-400 leading-relaxed">
          The day&apos;s most important stories — from our correspondents around the world —
          delivered to your inbox every morning before 8am. Free, always.
        </p>
      </div>

      <NewsletterSignup variant="inline" />

      <p className="text-xs text-ink-muted dark:text-zinc-600 font-sans text-center mt-6">
        No spam. Unsubscribe at any time. See our{" "}
        <Link href="/privacy" className="hover:text-accent underline">Privacy Policy</Link>.
      </p>

      <div className="mt-16 pt-10 border-t border-border dark:border-border-dark grid grid-cols-1 sm:grid-cols-3 gap-8 text-left">
        {[
          { label: "Daily",   title: "Every morning",        body: "Delivered by 8am on weekdays, 9am on weekends." },
          { label: "Trusted", title: "Independent reporting", body: "No agenda, no sponsorship. Just journalism." },
          { label: "Free",    title: "Always free",           body: "The Morning Briefing is free, forever." },
        ].map((item) => (
          <div key={item.title}>
            <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-2">{item.label}</p>
            <h3 className="font-serif font-bold text-ink dark:text-zinc-100 mb-1">{item.title}</h3>
            <p className="text-sm text-ink-secondary dark:text-zinc-400">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
