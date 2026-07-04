"use client";

/**
 * components/ads/SmartLinkWrapper.tsx — Provider-agnostic smart/direct link wrapper.
 *
 * Wraps any clickable element (button, logo, "Read More" link) so that when
 * clicked it first opens the monetisation smart link in a new tab, then
 * immediately follows the original href — preserving UX while generating revenue.
 *
 * USAGE:
 *   <SmartLinkWrapper href="/news/some-article">
 *     <button>Read More</button>
 *   </SmartLinkWrapper>
 *
 *   Or with an explicit override (e.g. for A/B testing a different smart link):
 *   <SmartLinkWrapper href="/news/some-article" smartLinkUrl="https://smartlink.adsterra.com/...">
 *     <button>Read More</button>
 *   </SmartLinkWrapper>
 *
 * ENV VARS:
 *   NEXT_PUBLIC_SMART_LINK_URL        — Adsterra (or other provider) smart link URL.
 *                                        Must be a full https:// URL on an allowed host.
 *                                        Leave unset to disable without changing JSX.
 *   NEXT_PUBLIC_SMART_LINK_CONFIRMED  — M-2 fix: second, independent key. Must be the
 *                                        exact string "true" or the smart link stays
 *                                        disabled even if a valid URL is configured.
 *                                        See the M-2 GOVERNANCE section below for why
 *                                        this exists — do not set it as a reflex action
 *                                        alongside NEXT_PUBLIC_SMART_LINK_URL.
 *   NEXT_PUBLIC_AD_PROVIDER            — When "none", wrapper is passthrough regardless.
 *
 * SECURITY:
 *   - Smart link URLs are validated for https:// scheme and an explicit host allowlist
 *     before window.open is called. javascript: URIs and unexpected domains are silently
 *     dropped — the click still navigates to the original href.
 *   - noopener,noreferrer is enforced on every window.open call.
 *
 * ── M-2 GOVERNANCE: this is a product/legal decision, not just a security one ──
 *
 * A security review of the implementation found it clean (https-only + host
 * allowlist, noopener/noreferrer, modifier-key bypass, off by default) — this is
 * NOT an injection vector. It was flagged anyway, for two reasons that code alone
 * cannot fix:
 *
 *   (a) Adsterra "smart links" are a network commonly associated with redirect
 *       chains that can land on scareware / fake-update / scam pages. Once the
 *       URL leaves this codebase, the destination is the ad network's call, not
 *       this component's — that creates downstream reputational and Google Safe
 *       Browsing risk no amount of allowlisting here can fully contain.
 *   (b) Opening a second tab on click is a real behavior change the reader did
 *       not ask for. It needs a deliberate disclosure (see DISCLOSURE below) and
 *       a deliberate sign-off before it ships live — not just "the URL happened
 *       to be set in this environment."
 *
 * To make that sign-off an explicit, separate action instead of an accidental
 * side effect of copying a `.env` file between environments, activation now
 * requires BOTH of:
 *   1. NEXT_PUBLIC_SMART_LINK_URL set to a valid https:// URL on an allowed host, AND
 *   2. NEXT_PUBLIC_SMART_LINK_CONFIRMED="true"
 *
 * If only (1) is set, the wrapper stays disabled (passthrough) and logs a single
 * console warning explaining why — so the gap is visible during testing rather
 * than discovered after the fact. Treat flipping (2) on as its own go/no-go
 * decision made consciously by whoever owns product + legal sign-off for this
 * site, not an automatic consequence of "launch."
 *
 * ── M-2 DISCLOSURE: the new-tab behavior is no longer silent ──────────────────
 *
 * Previously this component rendered with "no visual change to the wrapped
 * element," so a reader had no way to know a second tab was about to open.
 * When the smart link is active, a small inline glyph now renders next to the
 * wrapped element with an accessible name ("Opens a sponsored page in a new
 * tab") and a hover tooltip — visible to sighted users and announced to screen
 * readers. It is intentionally unobtrusive (it does not change the wrapped
 * element's own appearance or click target) but it is no longer literally
 * undisclosed. When the wrapper is disabled, nothing extra renders at all.
 */

import { type ReactNode, useCallback } from "react";
import { getActiveProvider } from "@/lib/ads/config";

// ─── Allowlist ────────────────────────────────────────────────────────────────
// Add the exact hostnames your smart link URLs are served from.
// Any URL whose hostname is not in this list is silently dropped.
const ALLOWED_SMART_LINK_HOSTS: ReadonlySet<string> = new Set([
  "smartlink.adsterra.com",
  "www.adsterra.com",
  // Add additional provider hostnames here as needed, e.g.:
  // "go.skimresources.com",
]);

function isSafeSmartLinkUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && ALLOWED_SMART_LINK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

// ─── M-2 fix: explicit second key, independent of the URL itself ──────────────
// NEXT_PUBLIC_SMART_LINK_URL alone used to be sufficient to enable pop-under
// behavior in production. Requiring this second, unrelated-looking flag means
// nobody enables the feature by accident (e.g. carrying a staging .env into
// prod) — someone has to deliberately add this exact line knowing what it does.
function isSmartLinkConfirmed(): boolean {
  return process.env.NEXT_PUBLIC_SMART_LINK_CONFIRMED === "true";
}

let _smartLinkUnconfirmedWarnedOnce = false;

/**
 * Logs once (per server instance / browser session) when a valid smart link
 * URL is configured but the separate confirmation flag is missing, so the gap
 * is visible during development/QA instead of silently doing nothing forever.
 */
function warnIfUnconfirmed(urlIsConfiguredAndSafe: boolean, confirmed: boolean): void {
  if (!urlIsConfiguredAndSafe || confirmed || _smartLinkUnconfirmedWarnedOnce) return;
  _smartLinkUnconfirmedWarnedOnce = true;
  console.warn(
    "[SmartLinkWrapper] NEXT_PUBLIC_SMART_LINK_URL is set to a valid, allowed " +
      "URL, but NEXT_PUBLIC_SMART_LINK_CONFIRMED is not the exact string \"true\" " +
      "— the smart link stays disabled. This is intentional (see M-2 GOVERNANCE " +
      "in components/ads/SmartLinkWrapper.tsx): enabling a pop-under smart link " +
      "is a product/legal decision, not an automatic consequence of setting a " +
      "URL. Set NEXT_PUBLIC_SMART_LINK_CONFIRMED=true only after that sign-off."
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SmartLinkWrapperProps {
  /**
   * The destination the user navigates to after clicking.
   *
   * SmartLinkWrapper does NOT use this value internally — navigation to this
   * URL is handled by the wrapped child element (e.g. a Next.js <Link> or
   * <a>). The prop is declared here for documentation and type-safety purposes
   * so call-sites make the destination explicit, but the component body never
   * reads it directly. Prefixed `_href` in the destructure to suppress the
   * no-unused-vars lint warning while keeping the prop in the public API.
   */
  href: string;
  /**
   * Smart link URL override (e.g. for A/B testing). Must be a full https://
   * URL on an allowed host — see ALLOWED_SMART_LINK_HOSTS above.
   * Defaults to NEXT_PUBLIC_SMART_LINK_URL.
   */
  smartLinkUrl?: string;
  children: ReactNode;
  /** Extra CSS classes on the wrapping span. */
  className?: string;
  /**
   * aria-label for the wrapping element if children are not text.
   *
   * L-3 note: this prop is intentionally unused in the component body.
   * The inner <span> carries role="none", which removes it from the
   * accessibility tree entirely — ARIA spec §5.2.8.4 prohibits aria-label
   * on role="none" elements because the role strips any accessible name
   * computation.  The wrapped children (button, link) carry their own labels.
   * Prefixed _ariaLabel to match the project's lint convention for
   * intentionally-unused props.
   *
   * This is unrelated to the M-2 disclosure glyph below, which is a sibling
   * element outside the role="none" span and carries its own accessible name
   * — it is not affected by the role="none" restriction.
   */
  _ariaLabel?: string;
}

export function SmartLinkWrapper({
  href: _href, // consumed by the child element, not by this wrapper — see JSDoc above
  smartLinkUrl,
  children,
  className = "",
  _ariaLabel,
}: SmartLinkWrapperProps) {
  const resolvedSmartLink =
    smartLinkUrl ?? process.env.NEXT_PUBLIC_SMART_LINK_URL ?? "";
  const provider = getActiveProvider();

  const urlIsConfiguredAndSafe =
    provider !== "none" &&
    resolvedSmartLink.length > 0 &&
    isSafeSmartLinkUrl(resolvedSmartLink);
  const confirmed = isSmartLinkConfirmed();

  // M-2 fix: both the URL *and* the explicit confirmation flag are required.
  warnIfUnconfirmed(urlIsConfiguredAndSafe, confirmed);
  const smartLinkEnabled = urlIsConfiguredAndSafe && confirmed;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      if (!smartLinkEnabled) return;

      // Don't intercept modifier-key clicks (open in new tab, etc.).
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      // Open the smart link in a new tab (non-blocking).
      // isSafeSmartLinkUrl already validated the URL above.
      window.open(resolvedSmartLink, "_blank", "noopener,noreferrer");
      // The child's own click handler / href takes over normally.
    },
    [smartLinkEnabled, resolvedSmartLink]
  );

  // When disabled, render children unwrapped to avoid any DOM overhead.
  // This is also what renders whenever the URL is set but unconfirmed
  // (see warnIfUnconfirmed above) — the feature stays fully inert.
  if (!smartLinkEnabled) {
    return <>{children}</>;
  }

  return (
    <span className="inline-flex items-start gap-1">
      <span
        onClick={handleClick}
        className={`inline-block cursor-pointer ${className}`}
        // aria-label is intentionally omitted: role="none" is a presentational
        // role that removes the element from the accessibility tree entirely.
        // ARIA spec §5.2.8.4 — aria-label MUST NOT be used on elements with
        // role="none" because the role strips any accessible name computation.
        // The wrapped children (button, link) carry their own accessible labels.
        role="none"
      >
        {children}
      </span>
      {/*
       * M-2 disclosure: a small, unobtrusive glyph + accessible name so the
       * new-tab behavior is no longer silent. Sighted users get a hover
       * tooltip; screen reader users get the sr-only text below. This is a
       * sibling of the role="none" span above, not a child of it, so it is
       * unaffected by the ARIA restriction on that element (see L-3 note on
       * the `_ariaLabel` prop above).
       */}
      <span
        className="mt-0.5 shrink-0 text-ink-muted dark:text-zinc-500"
        title="This link also opens a sponsored page in a new tab"
      >
        <svg
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
        </svg>
        <span className="sr-only">Opens a sponsored page in a new tab</span>
      </span>
    </span>
  );
}
