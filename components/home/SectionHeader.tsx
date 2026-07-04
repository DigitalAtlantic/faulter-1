import Link from "next/link";

interface SectionHeaderProps {
  title: string;
  href?: string;
  linkLabel?: string;
}

export function SectionHeader({ title, href, linkLabel = "See all" }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6 pb-3 border-b-2 border-ink dark:border-zinc-100">
      <h2 className="font-serif text-xl font-bold text-ink dark:text-zinc-100">{title}</h2>
      {href && (
        <Link
          href={href}
          className="text-xs font-sans font-semibold uppercase tracking-widest text-accent hover:text-accent-dark transition-colors"
        >
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}
