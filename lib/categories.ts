import { Category } from "@/types";

export const categories: Category[] = [
  {
    id: "c1",
    name: "World",
    slug: "world",
    description: "Comprehensive coverage of international news, global conflicts, diplomacy, and events shaping the world.",
  },
  {
    id: "c2",
    name: "Politics",
    slug: "politics",
    description: "In-depth reporting on domestic and international political developments, elections, and governance.",
  },
  {
    id: "c3",
    name: "Business",
    slug: "business",
    description: "Markets, economics, corporate news, trade, and the forces driving the global economy.",
  },
  {
    id: "c4",
    name: "Technology",
    slug: "technology",
    description: "The latest in tech innovation, artificial intelligence, cybersecurity, and the digital world.",
  },
  {
    id: "c5",
    name: "Sports",
    slug: "sports",
    description: "Breaking sports news, match reports, analysis, and the stories behind the athletes.",
  },
  {
    id: "c6",
    name: "Entertainment",
    slug: "entertainment",
    description: "Film, music, television, culture, and the arts from around the world.",
  },
  {
    id: "c7",
    name: "Health",
    slug: "health",
    description: "Medical breakthroughs, public health, wellness, and the science of living well.",
  },
  {
    id: "c8",
    name: "Science",
    slug: "science",
    description: "Discoveries, research, space exploration, climate, and the frontiers of human knowledge.",
  },
  {
    id: "c9",
    name: "Opinion",
    slug: "opinion",
    description: "Analysis, commentary, and perspectives from Faulter editors and contributing writers.",
  },
];

export const getCategoryBySlug = (slug: string): Category | undefined => {
  return categories.find((c) => c.slug === slug);
};
