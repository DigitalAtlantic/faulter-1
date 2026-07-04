"use client";

/**
 * components/ads/AdSlot.tsx — Universal ad slot renderer.
 *
 * Reads NEXT_PUBLIC_AD_PROVIDER and renders the correct ad unit.
 * Adding a new provider: implement its branch in renderAd() and
 * add its config in lib/ads/config.ts. No other file needs touching.
 */

import { useEffect, useRef, useState } from "react";
import {
  AD_SLOTS,
  getActiveProvider,
  getSlotProviderConfig,
  type AdProvider,
  type AdSlotId,
  type AdsterraScriptSrc,
} from "@/lib/ads/config";

interface AdSlotProps {
  slotId: AdSlotId;
  /**
   * Force a specific provider (useful for Storybook / preview).
   * Omit to use NEXT_PUBLIC_AD_PROVIDER.
   */
  providerOverride?: AdProvider;
  className?: string;
}

const VALID_PROVIDERS: AdProvider[] = [
  "adsterra",
  "adsense",
  "mediavine",
  "raptive",
  "direct",
  "none",
];

// MED-2 fix: warn-once gate so a misconfigured deployment logs one clear,
// actionable message per server process instead of once per AdSlot render
// (a single page can render 5 slots — top/mid-1/mid-2/bottom/sidebar).
let _adSlotErrorWarnedOnce = false;

export function AdSlot({ slotId, providerOverride, className = "" }: AdSlotProps) {
  const slot = AD_SLOTS[slotId];

  // MED-2 fix: getActiveProvider() intentionally throws in a real production
  // deployment when NEXT_PUBLIC_AD_PROVIDER is set to a real provider but
  // every ID for that provider in lib/ads/config.ts is still a placeholder
  // (see the L-2 comment there) — the throw itself is correct and meant to
  // make a forgotten ad-network setup step impossible to miss.
  //
  // What was wrong was *where* that throw was allowed to surface: called
  // directly in this component's render body, an uncaught throw propagates
  // out of every single page that renders an ad slot — effectively the
  // entire site — and trips that route's error.tsx boundary for every
  // visitor, not just "no ad shown." Catching it here keeps the loud signal
  // (still logged to the server console, still visible in deployment log
  // streams on the very first render after a bad deploy) while limiting the
  // failure to "this slot shows no ad" instead of a full-page outage.
  let activeProvider: AdProvider;
  try {
    activeProvider = getActiveProvider();
  } catch (err) {
    if (!_adSlotErrorWarnedOnce) {
      _adSlotErrorWarnedOnce = true;
      console.error(
        "[AdSlot] getActiveProvider() threw — degrading to no ad for this " +
          "and all other ad slots on this page instead of crashing the " +
          "render. Fix the underlying configuration in lib/ads/config.ts " +
          "(see message below) or set NEXT_PUBLIC_AD_PROVIDER=none.\n" +
          (err instanceof Error ? err.message : String(err))
      );
    }
    activeProvider = "none";
  }

  // providerOverride is already typed as AdProvider, but guard at runtime
  // in case the value arrives from a JS caller without type checking.
  const provider: AdProvider =
    providerOverride && VALID_PROVIDERS.includes(providerOverride)
      ? providerOverride
      : activeProvider;

  const providerConfig = getSlotProviderConfig(slotId, provider);

  if (provider === "none" || !providerConfig) return null;

  return (
    <div
      className={`ad-slot-wrapper w-full flex flex-col items-center my-4 ${className}`}
      aria-label={`Advertisement: ${slot.label}`}
    >
      <p className="text-[10px] font-sans font-semibold uppercase tracking-widest text-ink-muted dark:text-zinc-600 mb-1 select-none">
        Advertisement
      </p>

      <div
        className="ad-slot-container overflow-hidden"
        style={{ maxWidth: slot.desktopSize.w, width: "100%" }}
      >
        {provider === "adsterra" && (
          <AdsterraUnit slotId={slotId} scriptSrc={providerConfig.scriptSrc} />
        )}
        {provider === "adsense" && (
          <AdSenseUnit
            slotId={slotId}
            adSlot={providerConfig.id}
            publisherId={providerConfig.publisherId ?? ""}
          />
        )}
        {provider === "mediavine" && (
          <ManagedNetworkUnit slotId={slotId} unitId={providerConfig.id} network="Mediavine" />
        )}
        {provider === "raptive" && (
          <ManagedNetworkUnit slotId={slotId} unitId={providerConfig.id} network="Raptive" />
        )}
        {provider === "direct" && (
          <DirectUnit slotId={slotId} unitId={providerConfig.id} />
        )}
      </div>
    </div>
  );
}

// ─── Adsterra ────────────────────────────────────────────────────────────────

// HIGH-2 fix: scriptSrc here is typed as AdsterraScriptSrc, not `string` —
// see the type definition in lib/ads/config.ts for the full rationale. This
// value is passed directly to `script.src` below with no sanitization, and
// the csrf_token cookie is httpOnly: false (see lib/csrf.ts), so any single
// XSS path on this origin — including an attacker-influenced script src —
// would be enough to defeat CSRF protection. Restricting the type means a
// future change that wires a CMS/query-param/user-controlled value into
// this prop fails to compile instead of shipping that path.
function AdsterraUnit({
  slotId,
  scriptSrc,
}: {
  slotId: AdSlotId;
  scriptSrc?: AdsterraScriptSrc;
}) {
  const slot = AD_SLOTS[slotId];
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!scriptSrc || !containerRef.current || loaded) return;

    const container = containerRef.current; // capture ref value to avoid stale closure in cleanup
    const script = document.createElement("script");
    script.src = scriptSrc;
    script.async = true;
    script.setAttribute("data-cfasync", "false"); // Prevents Cloudflare Rocket Loader from deferring ad scripts
    container.appendChild(script);
    setLoaded(true);

    return () => {
      // Use the captured local variable — containerRef.current may be null by cleanup time.
      // Remove only the script we injected rather than nuking all innerHTML.
      const injected = container.querySelector(`script[src="${scriptSrc}"]`);
      if (injected) injected.remove();
      // HIGH-2 fix: container.innerHTML = "" previously cleared any leftover
      // nodes here. Even though this call only ever set it to an empty
      // string, innerHTML assignment in a component sitting right next to
      // dynamic <script> injection was flagged as unnecessary proximity
      // risk in the security audit — it is the kind of line a future edit
      // could change into `container.innerHTML = someValue` without anyone
      // noticing it sits in the ad-script cleanup path. replaceChildren()
      // with no arguments does the same "empty this container" job via the
      // DOM API instead of the HTML parser, with no string-parsing surface
      // at all.
      container.replaceChildren();
    };
  }, [scriptSrc, loaded]);

  if (!scriptSrc) {
    return <AdFallback slotId={slotId} label="Adsterra — no scriptSrc configured" />;
  }

  return (
    <div
      ref={containerRef}
      data-ad-slot={slotId}
      data-ad-provider="adsterra"
      className="w-full"
      // Reserve the mobile height so the layout does not shift when the script loads.
      style={{ minHeight: slot.mobileSize.h }}
    />
  );
}

// ─── Google AdSense ───────────────────────────────────────────────────────────

function AdSenseUnit({
  slotId,
  adSlot,
  publisherId,
}: {
  slotId: AdSlotId;
  adSlot: string;
  publisherId: string;
}) {
  const slot = AD_SLOTS[slotId];
  // Guard against the React 18 Strict Mode double-invoke: effects run twice
  // in development, which would push the same <ins> element twice and produce
  // a broken or duplicate ad unit.
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    try {
      // @ts-expect-error — adsbygoogle injected by the AdSense loader script.
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* AdSense SDK not yet loaded — it picks up existing <ins> on its own init */
    }
  }, []);

  if (!publisherId || !adSlot) {
    return <AdFallback slotId={slotId} label="AdSense — publisherId or adSlot missing" />;
  }

  return (
    <ins
      className="adsbygoogle block"
      style={{ display: "block" }}
      data-ad-client={publisherId}
      data-ad-slot={adSlot}
      data-ad-format="auto"
      data-full-width-responsive="true"
      data-ad-layout-key={`-${slot.desktopSize.w}x${slot.desktopSize.h}`}
    />
  );
}

// ─── Mediavine / Raptive ──────────────────────────────────────────────────────

function ManagedNetworkUnit({
  slotId,
  unitId,
  network,
}: {
  slotId: AdSlotId;
  unitId: string;
  network: "Mediavine" | "Raptive";
}) {
  const slot = AD_SLOTS[slotId];
  return (
    <div
      id={unitId}
      data-ad-slot={slotId}
      data-ad-provider={network.toLowerCase()}
      // Use mobileSize.h as the floor so we don't reserve 250px of blank space
      // on a 320px viewport when the mobile ad is only 50px tall.
      style={{ minHeight: slot.mobileSize.h, width: "100%" }}
      className="w-full"
    />
  );
}

// ─── Direct / House Ads ───────────────────────────────────────────────────────

function DirectUnit({ slotId, unitId }: { slotId: AdSlotId; unitId: string }) {
  const slot = AD_SLOTS[slotId];
  return (
    <div
      data-ad-slot={slotId}
      data-ad-provider="direct"
      data-unit-id={unitId}
      style={{ width: slot.desktopSize.w, height: slot.desktopSize.h, maxWidth: "100%" }}
      className="bg-paper-secondary dark:bg-zinc-900 border border-dashed border-border dark:border-border-dark flex items-center justify-center"
    >
      {/* Replace with your direct creative:
          <a href="https://advertiser.example" target="_blank" rel="noopener sponsored">
            <img src="/ads/creative-banner.jpg" alt="Advertiser Name"
                 width={slot.desktopSize.w} height={slot.desktopSize.h} />
          </a> */}
      <span className="text-xs text-ink-muted dark:text-zinc-600 font-sans">
        Direct Ad — {slot.desktopSize.w}×{slot.desktopSize.h}
      </span>
    </div>
  );
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function AdFallback({ slotId, label }: { slotId: AdSlotId; label: string }) {
  const slot = AD_SLOTS[slotId];
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div
      className="border border-dashed border-border dark:border-border-dark flex items-center justify-center bg-paper-secondary dark:bg-zinc-900 text-center p-4"
      style={{ width: "100%", minHeight: slot.desktopSize.h }}
    >
      <div>
        <p className="text-xs font-mono text-ink-muted dark:text-zinc-500">{label}</p>
        <p className="text-xs text-ink-muted dark:text-zinc-600 mt-1">
          {slot.desktopSize.w}×{slot.desktopSize.h} (desktop) ·{" "}
          {slot.mobileSize.w}×{slot.mobileSize.h} (mobile)
        </p>
      </div>
    </div>
  );
}
