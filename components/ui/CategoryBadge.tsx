import Link from "next/link";
import clsx from "clsx";

interface CategoryBadgeProps {
  name: string;
  slug: string;
  className?: string;
  asLink?: boolean;
}

export function CategoryBadge({
  name,
  slug,
  className,
  asLink = true,
}: CategoryBadgeProps) {
  const classes = clsx(
    "inline-block text-[10px] font-sans font-bold uppercase tracking-widest text-accent hover:text-accent-dark transition-colors",
    className
  );

  if (asLink) {
    return (
      <Link href={`/category/${slug}`} className={classes}>
        {name}
      </Link>
    );
  }

  return <span className={classes}>{name}</span>;
}
