// Prevent this module from being imported in Client Components.
// lib/authors.ts contains staff email addresses — if a "use client" file
// ever imports it, Next.js will throw a build error instead of silently
// shipping PII into the browser bundle.
import "server-only";

import { Author } from "@/types";

/** Full author records — includes email. Never expose to JSX or API responses. */
export const authors: Author[] = [
  {
    id: "a1",
    name: "Eleanor Hartwell",
    slug: "eleanor-hartwell",
    bio: "Eleanor Hartwell is a senior international correspondent with over 15 years of experience covering geopolitics and global affairs. She has reported from more than 40 countries.",
    avatar: "/avatars/eleanor-hartwell.svg",
    role: "Senior International Correspondent",
    twitter: "ehartwell",
    email: "e.hartwell@faulter.news",
    articleCount: 312,
  },
  {
    id: "a2",
    name: "Marcus Chen",
    slug: "marcus-chen",
    bio: "Marcus Chen covers technology and innovation from Silicon Valley. A former engineer, he brings deep technical understanding to complex stories.",
    avatar: "/avatars/marcus-chen.svg",
    role: "Technology Editor",
    twitter: "marcuschen_tech",
    email: "m.chen@faulter.news",
    articleCount: 245,
  },
  {
    id: "a3",
    name: "Priya Sharma",
    slug: "priya-sharma",
    bio: "Priya Sharma is Faulter's chief economics correspondent, specializing in emerging markets and global financial systems.",
    avatar: "/avatars/priya-sharma.svg",
    role: "Chief Economics Correspondent",
    twitter: "priyasharma_econ",
    email: "p.sharma@faulter.news",
    articleCount: 198,
  },
  {
    id: "a4",
    name: "James Okafor",
    slug: "james-okafor",
    bio: "James Okafor reports on African politics and society. Based in Lagos, he covers the continent's most pressing stories with nuance and depth.",
    avatar: "/avatars/james-okafor.svg",
    role: "Africa Correspondent",
    twitter: "james_okafor",
    email: "j.okafor@faulter.news",
    articleCount: 167,
  },
  {
    id: "a5",
    name: "Sofia Marchetti",
    slug: "sofia-marchetti",
    bio: "Sofia Marchetti is a science journalist based in Geneva. She has a PhD in molecular biology and has been translating complex science for general audiences since 2012.",
    avatar: "/avatars/sofia-marchetti.svg",
    role: "Science & Health Editor",
    twitter: "sofiamarchetti",
    email: "s.marchetti@faulter.news",
    articleCount: 221,
  },
  {
    id: "a6",
    name: "David Reinholt",
    slug: "david-reinholt",
    bio: "David Reinholt is a veteran political analyst and opinion writer. A former White House correspondent, he now writes the widely-read 'Inside the Beltway' column.",
    avatar: "/avatars/david-reinholt.svg",
    role: "Senior Political Analyst",
    twitter: "drreinholt",
    email: "d.reinholt@faulter.news",
    articleCount: 408,
  },
  {
    id: "a7",
    name: "Amara Nwosu",
    slug: "amara-nwosu",
    bio: "Amara Nwosu covers culture, entertainment, and the arts. Her feature writing has been recognized by the Society of Professional Journalists.",
    avatar: "/avatars/amara-nwosu.svg",
    role: "Culture & Entertainment Writer",
    twitter: "amaranwosu",
    email: "a.nwosu@faulter.news",
    articleCount: 134,
  },
  {
    id: "a8",
    name: "Tomás Rivera",
    slug: "tomas-rivera",
    bio: "Tomás Rivera is Faulter's lead sports correspondent. He covers international football and the Olympic movement with a special focus on Latin America.",
    avatar: "/avatars/tomas-rivera.svg",
    role: "Sports Correspondent",
    twitter: "tomas_sports",
    email: "t.rivera@faulter.news",
    articleCount: 289,
  },
];

// ─── Public author type (no PII) ─────────────────────────────────────────────

/** Author fields safe to render in JSX or return from public API routes. */
export type PublicAuthor = Omit<Author, "email">;

/**
 * Returns the authors array with the `email` field stripped.
 *
 * Use this in any component or route that renders author data publicly.
 * The raw `authors` array (which includes email) should only be used
 * server-side for internal operations (e.g. sending notifications).
 */
export function getPublicAuthors(): PublicAuthor[] {
  return authors.map(({ email: _email, ...rest }) => rest);
}
