import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Saved Articles",
  description: "Your bookmarked Faulter stories, saved locally in your browser.",
  // Bookmarks is a personalised page with no canonical URL value.
  robots: { index: false, follow: false },
};

export default function BookmarksLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
