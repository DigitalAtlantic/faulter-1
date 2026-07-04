import { ImageResponse } from "next/og";
import { siteName, siteDescription } from "@/lib/site";

// Next.js will serve this as /opengraph-image.png and wire it into <meta og:image>
// Note: `runtime = "edge"` is NOT set here. ImageResponse from next/og works
// with the default Node.js runtime in Next.js 14+. Using the edge runtime was
// previously recommended for faster cold starts but is no longer required and
// emits a build warning ("Using edge runtime … disables static generation")
// that is misleading for a metadata image route. The Node.js runtime is used
// instead to keep the build output clean.
export const alt = `${siteName} — Independent News`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#111111",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          padding: "64px",
          fontFamily: "Georgia, serif",
        }}
      >
        {/* Accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "6px",
            background: "#C41E3A",
          }}
        />
        {/* Wordmark */}
        <div
          style={{
            fontSize: 96,
            fontWeight: 900,
            color: "#FFFFFF",
            letterSpacing: "-2px",
            lineHeight: 1,
            marginBottom: "16px",
          }}
        >
          {siteName}
        </div>
        {/* Tagline */}
        <div
          style={{
            fontSize: 28,
            color: "#9A9A9A",
            fontFamily: "system-ui, sans-serif",
            fontWeight: 400,
            maxWidth: "900px",
            lineHeight: 1.4,
          }}
        >
          {siteDescription}
        </div>
      </div>
    ),
    { ...size }
  );
}
