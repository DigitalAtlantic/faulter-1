import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // These CSS variables are injected by next/font in layout.tsx
        serif: ["var(--font-playfair)", "Georgia", "serif"],
        sans: ["var(--font-source-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        accent: {
          DEFAULT: "#C41E3A",
          dark: "#A01830",
          light: "#E02244",
        },
        ink: {
          DEFAULT: "#111111",
          secondary: "#3A3A3A",
          tertiary: "#6B6B6B",
          muted: "#9A9A9A",
        },
        paper: {
          DEFAULT: "#FFFFFF",
          warm: "#FAFAF8",
          secondary: "#F4F4F2",
        },
        border: {
          DEFAULT: "#E2E2E0",
          dark: "#2A2A2A",
        },
      },
    },
  },
  plugins: [],
};
export default config;
