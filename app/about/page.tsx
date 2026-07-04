import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getPublicAuthors } from "@/lib/authors";
import { absoluteUrl } from "@/lib/site";

// Static CSP fix: app/layout.tsx (the root layout, an ancestor of every
// route) no longer calls headers() on every request — see the CSP-strategy
// comment there and in middleware.ts for what changed. This page never made
// any Dynamic API calls of its own, so it is now fully static: built once at
// deploy time and served unchanged until the next deploy, exactly as
// `revalidate = false` describes.
export const revalidate = false;

export const metadata: Metadata = {
  title: "About Faulter",
  description:
    "Learn about Faulter — our editorial mission, our team of journalists, and the standards that guide our reporting.",
  alternates: {
    canonical: absoluteUrl("/about"),
  },
};

export default function AboutPage() {
  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-8" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-accent transition-colors">Home</Link>
        <span>/</span>
        <span>About</span>
      </nav>

      {/* Mission */}
      <section className="max-w-3xl mb-16">
        <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-4">
          About Faulter
        </p>
        <h1 className="font-serif text-4xl lg:text-5xl font-black text-ink dark:text-zinc-100 leading-tight mb-6">
          Independent journalism, held to the highest standard.
        </h1>
        <div className="space-y-5 text-[17px] font-sans leading-relaxed text-ink-secondary dark:text-zinc-400">
          <p>
            Faulter was founded on a simple conviction: that people deserve access
            to accurate, rigorous, and independent reporting on the events that shape
            their lives and their world. In an era of accelerating noise and
            diminishing trust, we believe that the discipline of professional
            journalism — verification before publication, fairness in presentation,
            accountability to readers above all — matters more than ever.
          </p>
          <p>
            We cover the world&apos;s most consequential stories across politics, business,
            technology, science, health, culture, and sport. Our correspondents and
            reporters operate from newsrooms and bureaux across the globe, bringing
            on-the-ground reporting and deep expertise to bear on complex, fast-moving
            stories.
          </p>
          <p>
            Faulter is editorially independent. We do not accept directions from
            commercial partners, advertisers, or investors on what we publish or
            how we cover it. Our journalism is funded by our readers.
          </p>
        </div>
      </section>

      <div className="border-t border-border dark:border-border-dark mb-16" />

      {/* Values */}
      <section id="standards" className="mb-16 scroll-mt-[4.5rem] lg:scroll-mt-[9.5rem]">
        <h2 className="font-serif text-3xl font-bold text-ink dark:text-zinc-100 mb-8">
          Editorial Standards
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              title: "Accuracy",
              body: "We verify every material fact before publication. We correct errors promptly and transparently. We distinguish clearly between news reporting and opinion.",
            },
            {
              title: "Independence",
              body: "Our editorial decisions are made by journalists, not by commercial departments. We disclose conflicts of interest and do not allow advertisers to influence coverage.",
            },
            {
              title: "Fairness",
              body: "We seek comment from all parties before publishing allegations. We present a full range of informed perspectives. We treat all people with the same standard of scrutiny.",
            },
            {
              title: "Transparency",
              body: "We name our sources wherever possible. When we use anonymous sources, we explain why. We are open about our methods, our funding, and our mistakes.",
            },
            {
              title: "Accountability",
              body: "We hold the powerful to account and give voice to those who are not. We protect confidential sources. We do not allow threats or legal pressure to silence public-interest journalism.",
            },
            {
              title: "Corrections",
              body: "When we get something wrong, we say so clearly and correct it without delay. Our corrections policy is public and our corrections are permanent parts of the record.",
            },
          ].map((item) => (
            <div key={item.title} className="border-l-4 border-accent pl-5">
              <h3 className="font-serif text-lg font-bold text-ink dark:text-zinc-100 mb-2">
                {item.title}
              </h3>
              <p className="text-sm text-ink-secondary dark:text-zinc-400 leading-relaxed">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-border dark:border-border-dark mb-16" />

      {/* Team */}
      <section id="team" className="mb-16 scroll-mt-[4.5rem] lg:scroll-mt-[9.5rem]">
        <h2 className="font-serif text-3xl font-bold text-ink dark:text-zinc-100 mb-8">
          Our Journalists
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {getPublicAuthors().map((author) => (
            <div key={author.id} className="group">
              <Link href={`/author/${author.slug}`}>
                <div className="relative w-full aspect-square overflow-hidden mb-4 grayscale group-hover:grayscale-0 transition-all duration-500">
                  <Image
                    src={author.avatar}
                    alt={author.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 50vw, 25vw"
                  />
                </div>
                <h3 className="font-serif text-lg font-bold text-ink dark:text-zinc-100 group-hover:text-accent transition-colors">
                  {author.name}
                </h3>
              </Link>
              <p className="text-xs text-accent font-sans font-semibold uppercase tracking-widest mt-0.5">
                {author.role}
              </p>
              <p className="text-sm text-ink-secondary dark:text-zinc-400 mt-2 leading-relaxed line-clamp-3">
                {author.bio}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div id="corrections" className="border-t border-border dark:border-border-dark mb-16 scroll-mt-[4.5rem] lg:scroll-mt-[9.5rem]" />

      {/* Corrections */}
      <section className="max-w-3xl mb-16">
        <h2 className="font-serif text-3xl font-bold text-ink dark:text-zinc-100 mb-4">
          Corrections Policy
        </h2>
        <div className="space-y-4 text-[17px] font-sans leading-relaxed text-ink-secondary dark:text-zinc-400">
          <p>
            Faulter is committed to accuracy. When errors are brought to our attention,
            we investigate them promptly, and if the error is confirmed, we correct the
            record clearly. Corrections appear at the top of the affected article with
            a date and description of what was changed.
          </p>
          <p>
            To report a factual error, please email{" "}
            <a href="mailto:corrections@faulter.news" className="text-accent hover:underline">
              corrections@faulter.news
            </a>{" "}
            with the URL of the article and a description of the error. We will respond
            within one business day.
          </p>
        </div>
      </section>
    </div>
  );
}
