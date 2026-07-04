/**
 * lib/ads/config.ts — Provider-agnostic ad slot configuration.
 *
 * HOW TO ADD A NEW PROVIDER:
 *   1. Add its key to AdProvider.
 *   2. Add a record in each slot's `providers` map keyed by that string.
 *   3. Set NEXT_PUBLIC_AD_PROVIDER=<key> in your environment.
 *   Done — no component changes required.
 *
 * BEFORE LAUNCH:
 *   Replace every placeholder ID below (1111111, ca-pub-XXXXXXXXXXXXXXXX, etc.)
 *   with real values from your ad network dashboards. The app compiles and
 *   deploys with placeholder values but will serve no ads and generate no revenue.
 *
 * L-2 fix: the literal placeholder IDs are intentionally left in this file —
 *   real network IDs cannot be supplied without access to your AdSense /
 *   Adsterra / Mediavine / Raptive dashboards, and fabricating plausible-
 *   looking values would be worse than an obvious placeholder (it would
 *   silently fail in production while looking configured). What changed is
 *   that getActiveProvider() below now actively checks for this exact
 *   situation: if NEXT_PUBLIC_AD_PROVIDER is switched away from "none" while
 *   that provider's IDs are still on the placeholder list, it throws in a
 *   real production deployment (and logs once otherwise) instead of quietly
 *   serving broken/empty ad slots.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdProvider =
  | "adsterra"
  | "adsense"
  | "mediavine"
  | "raptive"
  | "direct"
  | "none";

export interface AdSize {
  w: number;
  h: number;
}

/**
 * HIGH-2 fix: scriptSrc is deliberately NOT typed as `string`.
 *
 * components/ads/AdSlot.tsx's AdsterraUnit passes this value straight into
 * `document.createElement("script").src`, bypassing lib/sanitize.ts
 * entirely. The double-submit CSRF pattern requires the csrf_token cookie
 * to be httpOnly: false (see lib/csrf.ts), which means the entire CSRF
 * defence collapses the moment any single XSS path exists on this origin —
 * an attacker-influenced script `src` here would be exactly such a path.
 *
 * AdsterraScriptSrc is a template-literal type anchored to the one
 * hardcoded origin this app is allowed to load an Adsterra banner script
 * from. It only accepts:
 *   - a string literal matching this exact shape (what every entry in
 *     AD_SLOTS below already is), or
 *   - a template literal built from string literals/segments that still
 *     resolves to that shape.
 *
 * It does NOT accept a plain `string`-typed value — a CMS field, a URL
 * search param, request body data, anything not known at compile time —
 * even if that value happens to start with the right domain. Assigning one
 * is a compile error, not a runtime check, so a future change that wires a
 * dynamic value into scriptSrc fails the build instead of shipping a
 * same-origin XSS path. If a legitimate need to template this value at
 * runtime ever comes up, do it with `as AdsterraScriptSrc` at the single
 * call site after manually verifying the source — never widen this type
 * back to `string`.
 */
export type AdsterraScriptSrc =
  `https://www.highperformanceformat.com/${string}/invoke.js`;

export interface ProviderSlotConfig {
  /** Adsterra: zone ID. AdSense: slot ID. Mediavine/Raptive: unit path. */
  id: string;
  /** Adsterra banner invoke.js script src. See AdsterraScriptSrc above. */
  scriptSrc?: AdsterraScriptSrc;
  /** AdSense publisher ID (e.g. "ca-pub-XXXXXXXXXXXXXXXX") */
  publisherId?: string;
  /** Mediavine / Raptive unit path override */
  unitPath?: string;
}

export interface AdSlotConfig {
  label: string;
  desktopSize: AdSize;
  mobileSize: AdSize;
  /**
   * Partial so slots don't need an entry for every provider.
   * Not `as const` — that makes the nested Partial readonly in a way
   * that conflicts with index-access narrowing at call sites.
   */
  providers: Partial<Record<AdProvider, ProviderSlotConfig>>;
}

// ─── Slot IDs ─────────────────────────────────────────────────────────────────

export const AD_SLOT_TOP = "AD_SLOT_TOP" as const;
export const AD_SLOT_MID_1 = "AD_SLOT_MID_1" as const;
export const AD_SLOT_MID_2 = "AD_SLOT_MID_2" as const;
export const AD_SLOT_BOTTOM = "AD_SLOT_BOTTOM" as const;
export const AD_SLOT_SIDEBAR = "AD_SLOT_SIDEBAR" as const;

export type AdSlotId =
  | typeof AD_SLOT_TOP
  | typeof AD_SLOT_MID_1
  | typeof AD_SLOT_MID_2
  | typeof AD_SLOT_BOTTOM
  | typeof AD_SLOT_SIDEBAR;

// ─── Slot Map ─────────────────────────────────────────────────────────────────

/**
 * Central registry. Update `providers` records when you add/swap providers.
 *
 * ⚠️  All zone IDs below are PLACEHOLDER VALUES.
 *     Replace with real IDs from your ad network dashboards before go-live.
 *
 * Adsterra banner script URL format:
 *   https://www.highperformanceformat.com/<ZONE_ID>/invoke.js
 */
export const AD_SLOTS: Record<AdSlotId, AdSlotConfig> = {
  [AD_SLOT_TOP]: {
    label: "Top Banner",
    desktopSize: { w: 970, h: 250 },
    mobileSize: { w: 320, h: 50 },
    providers: {
      adsterra: {
        id: "1111111", // ⚠️ replace with real Adsterra zone ID
        scriptSrc: "https://www.highperformanceformat.com/1111111/invoke.js",
      },
      adsense: {
        id: "1234567890", // ⚠️ replace with real AdSense slot ID
        publisherId: "ca-pub-XXXXXXXXXXXXXXXX", // ⚠️ replace with real publisher ID
      },
      mediavine: { id: "faulter-top-banner" }, // ⚠️ replace with real unit name
      raptive: { id: "faulter-top-banner" },   // ⚠️ replace with real unit name
      direct: { id: "direct-top" },
    },
  },

  [AD_SLOT_MID_1]: {
    label: "Mid-Content Banner 1",
    desktopSize: { w: 728, h: 90 },
    mobileSize: { w: 300, h: 250 },
    providers: {
      adsterra: {
        id: "2222222", // ⚠️ replace
        scriptSrc: "https://www.highperformanceformat.com/2222222/invoke.js",
      },
      adsense: {
        id: "2345678901", // ⚠️ replace
        publisherId: "ca-pub-XXXXXXXXXXXXXXXX", // ⚠️ replace
      },
      mediavine: { id: "faulter-mid-1" }, // ⚠️ replace
      raptive: { id: "faulter-mid-1" },   // ⚠️ replace
      direct: { id: "direct-mid-1" },
    },
  },

  [AD_SLOT_MID_2]: {
    label: "Mid-Content Banner 2",
    desktopSize: { w: 728, h: 90 },
    mobileSize: { w: 300, h: 250 },
    providers: {
      adsterra: {
        id: "3333333", // ⚠️ replace
        scriptSrc: "https://www.highperformanceformat.com/3333333/invoke.js",
      },
      adsense: {
        id: "3456789012", // ⚠️ replace
        publisherId: "ca-pub-XXXXXXXXXXXXXXXX", // ⚠️ replace
      },
      mediavine: { id: "faulter-mid-2" }, // ⚠️ replace
      raptive: { id: "faulter-mid-2" },   // ⚠️ replace
      direct: { id: "direct-mid-2" },
    },
  },

  [AD_SLOT_BOTTOM]: {
    label: "Bottom Banner",
    desktopSize: { w: 970, h: 250 },
    mobileSize: { w: 300, h: 250 },
    providers: {
      adsterra: {
        id: "4444444", // ⚠️ replace
        scriptSrc: "https://www.highperformanceformat.com/4444444/invoke.js",
      },
      adsense: {
        id: "4567890123", // ⚠️ replace
        publisherId: "ca-pub-XXXXXXXXXXXXXXXX", // ⚠️ replace
      },
      mediavine: { id: "faulter-bottom" }, // ⚠️ replace
      raptive: { id: "faulter-bottom" },   // ⚠️ replace
      direct: { id: "direct-bottom" },
    },
  },

  [AD_SLOT_SIDEBAR]: {
    label: "Sidebar",
    desktopSize: { w: 300, h: 600 },
    mobileSize: { w: 300, h: 250 },
    providers: {
      adsterra: {
        id: "5555555", // ⚠️ replace
        scriptSrc: "https://www.highperformanceformat.com/5555555/invoke.js",
      },
      adsense: {
        id: "5678901234", // ⚠️ replace
        publisherId: "ca-pub-XXXXXXXXXXXXXXXX", // ⚠️ replace
      },
      mediavine: { id: "faulter-sidebar" }, // ⚠️ replace
      raptive: { id: "faulter-sidebar" },   // ⚠️ replace
      direct: { id: "direct-sidebar" },
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// L-2 fix: every literal below is one of the placeholder values that ships
// in AD_SLOTS — see "BEFORE LAUNCH" at the top of this file. They are
// listed here (not inferred from a regex) so the check below is exact and
// cannot accidentally flag a real ID that happens to look similar.
//
// This file cannot supply real ad network IDs itself — those only exist in
// your AdSense / Adsterra / Mediavine / Raptive dashboards. What this guard
// does instead is make it impossible to silently "enable" ads while the
// placeholders are still in place: flipping NEXT_PUBLIC_AD_PROVIDER away
// from "none" without having replaced the matching IDs now fails loudly in
// production rather than rendering empty/broken ad slots that look
// configured.
const _PLACEHOLDER_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "1111111",
  "2222222",
  "3333333",
  "4444444",
  "5555555",
  "1234567890",
  "2345678901",
  "3456789012",
  "4567890123",
  "5678901234",
  "ca-pub-XXXXXXXXXXXXXXXX",
]);

/** True if every configured id/publisherId for `provider` is still a placeholder. */
function providerStillUsesPlaceholders(provider: AdProvider): boolean {
  if (provider === "none" || provider === "direct") return false;
  return Object.values(AD_SLOTS).every((slot) => {
    const cfg = slot.providers[provider];
    if (!cfg) return true;
    const idIsPlaceholder = _PLACEHOLDER_PROVIDER_IDS.has(cfg.id);
    const pubIdIsPlaceholder =
      cfg.publisherId === undefined || _PLACEHOLDER_PROVIDER_IDS.has(cfg.publisherId);
    return idIsPlaceholder && pubIdIsPlaceholder;
  });
}

/** Mirrors the isRealProduction() heuristic used elsewhere (middleware.ts, lib/unsubscribe.ts). */
function isRealProduction(): boolean {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return (
    process.env.NODE_ENV === "production" &&
    siteUrl.startsWith("https://") &&
    !siteUrl.includes("localhost")
  );
}

let _adPlaceholderWarnedOnce = false;

/** Returns the active provider from the env, defaulting to "none". */
export function getActiveProvider(): AdProvider {
  const raw = process.env.NEXT_PUBLIC_AD_PROVIDER ?? "none";
  const valid: AdProvider[] = [
    "adsterra",
    "adsense",
    "mediavine",
    "raptive",
    "direct",
    "none",
  ];
  const provider = valid.includes(raw as AdProvider) ? (raw as AdProvider) : "none";

  if (provider !== "none" && providerStillUsesPlaceholders(provider)) {
    if (isRealProduction()) {
      // Real deployment, ads "enabled", but every ID is still the placeholder
      // from public source — fail loudly rather than serving broken slots.
      //
      // MED-2: this throw is caught at the call site in
      // components/ads/AdSlot.tsx, which logs the same message and degrades
      // to "no ad" for the slot instead of letting the exception crash the
      // whole page render. Keep throwing here rather than just logging —
      // AdSlot's catch block is what makes this safe to call from a render
      // path; a caller invoking getActiveProvider() outside a render (e.g.
      // a future startup/health-check script) still gets a real exception.
      throw new Error(
        `NEXT_PUBLIC_AD_PROVIDER is set to "${provider}" but every ad slot for ` +
          `that provider in lib/ads/config.ts still uses its placeholder ID. ` +
          `Replace the placeholder IDs with real values from your ${provider} ` +
          `dashboard before enabling ads, or set NEXT_PUBLIC_AD_PROVIDER=none.`
      );
    }
    if (!_adPlaceholderWarnedOnce) {
      _adPlaceholderWarnedOnce = true;
      console.error(
        `[ads/config] NEXT_PUBLIC_AD_PROVIDER="${provider}" but its ad slot IDs ` +
          `in lib/ads/config.ts are still placeholders. Ads will not render ` +
          `correctly until you replace them with real ${provider} IDs.`
      );
    }
  }

  return provider;
}

/** Returns provider config for a slot, or null if unconfigured / provider is "none". */
export function getSlotProviderConfig(
  slotId: AdSlotId,
  provider: AdProvider
): ProviderSlotConfig | null {
  if (provider === "none") return null;
  return AD_SLOTS[slotId].providers[provider] ?? null;
}
