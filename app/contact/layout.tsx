import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with the Faulter editorial team. We welcome tips, feedback, and press enquiries.",
  alternates: {
    canonical: absoluteUrl("/contact"),
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
