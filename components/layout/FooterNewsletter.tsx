"use client";

import { useState, useRef, useEffect } from "react";
import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { fetchCsrfToken, invalidateCsrfToken } from "@/lib/csrfToken.client";

type Status = "idle" | "submitting" | "success" | "error";

// M-2 fix: error messages keyed by HTTP status code.
// Never render raw API error strings — map status codes to fixed, safe strings
// so internal details cannot leak and copy can be changed without touching
// multiple places. Mirrors the pattern used in NewsletterSignup.tsx and
// app/subscribe/page.tsx to prevent any future /api/newsletter error path from
// surfacing an unfiltered server string in this component.
const NEWSLETTER_ERROR_MESSAGES: Record<number, string> = {
  400: "Please enter a valid email address.",
  403: "Your request couldn't be verified. Please refresh the page and try again.",
  413: "Request too large. Please try again.",
  415: "Unexpected content type. Please try again.",
  429: "Too many attempts. Please wait a while before trying again.",
  502: "We couldn't process your subscription right now. Please try again in a few minutes.",
};

export function FooterNewsletter() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  // Uncontrolled refs — see NewsletterSignup.tsx for the full explanation.
  // Short version: controlled value={email} causes React to overwrite autofill.
  const emailRef = useRef<HTMLInputElement>(null);
  const hpRef = useRef<HTMLInputElement>(null);
  const loadedAtRef = useRef<string>(new Date().toISOString());
  const csrfTokenRef = useRef<string>("");
  // S-1 fix: Cloudflare Turnstile challenge response token.
  // FooterNewsletter posts to /api/newsletter which calls verifyTurnstileToken()
  // server-side.  Without this token every submission returns 400 in production
  // (TURNSTILE_SECRET_KEY is set → missing token → { success: false }).
  // The invisible widget fires onSuccess as soon as Cloudflare completes the
  // challenge (typically within 1–2 s of page load) so the token is ready well
  // before the user clicks Subscribe.
  const turnstileTokenRef = useRef<string>("");
  // S-2 fix: ref to the Turnstile widget so we can call reset() after any
  // failed submission. Turnstile tokens are single-use — if the POST fails
  // the spent token is still in turnstileTokenRef and the next retry would
  // resend it, causing Cloudflare to reject with { success: false }. reset()
  // discards the old token and triggers a fresh silent challenge; we also
  // clear turnstileTokenRef so handleSubmit cannot inadvertently send a
  // stale value before onSuccess fires with the replacement token.
  const turnstileRef = useRef<TurnstileInstance>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    // Shared token cache — see lib/csrfToken.client.ts for rationale.
    fetchCsrfToken().then((token) => {
      if (token) csrfTokenRef.current = token;
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");
    const email = emailRef.current?.value ?? "";
    const hp = hpRef.current?.value ?? "";
    try {
      const reqHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfTokenRef.current) {
        reqHeaders["X-CSRF-Token"] = csrfTokenRef.current;
      }
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: reqHeaders,
        // S-1 fix: include Turnstile token so verifyTurnstileToken() receives
        // a real token rather than null.  When NEXT_PUBLIC_TURNSTILE_SITE_KEY
        // is unset the widget is not rendered and the field is omitted, matching
        // the dev-mode skip in verifyTurnstileToken() (no secret → { success: true }).
        body: JSON.stringify({
          email,
          _hp: hp,
          _loadedAt: loadedAtRef.current,
          ...(turnstileTokenRef.current ? { turnstileToken: turnstileTokenRef.current } : {}),
        }),
      });
      const _data = await res.json() as { error?: string };
      // L-1 fix: a 403 means the server rejected our CSRF token (expired or
      // replayed). Invalidate the cache so the next fetchCsrfToken() call
      // goes back to the server for a fresh token instead of retrying with
      // the same bad one.
      if (!res.ok) {
        if (res.status === 403) {
          // Invalidate the module-level cache and immediately prefetch a fresh
          // token into csrfTokenRef so the next retry attempt sends a valid one
          // rather than the same stale token that just caused the 403.
          invalidateCsrfToken();
          fetchCsrfToken().then((t) => { if (t) csrfTokenRef.current = t; });
        }
        setStatus("error");
        setErrorMsg(NEWSLETTER_ERROR_MESSAGES[res.status] ?? "Something went wrong. Please try again.");
        // S-2 fix: spent token — reset the widget so the next retry gets a
        // fresh challenge rather than resending a single-use token.
        turnstileRef.current?.reset();
        turnstileTokenRef.current = "";
        return;
      }
      setStatus("success");
      if (emailRef.current) emailRef.current.value = "";
    } catch {
      setStatus("error");
      setErrorMsg("Unable to subscribe. Please try again.");
      // S-2 fix: network failure also invalidates the token challenge cycle.
      turnstileRef.current?.reset();
      turnstileTokenRef.current = "";
    }
  };

  if (status === "success") {
    return <p className="text-sm text-green-400 font-sans py-2">✓ You&apos;re subscribed. Thank you.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {/* Honeypot — visually hidden, bots fill it, humans don't */}
      <label htmlFor="footer_nl_hp" className="sr-only">Leave this field blank</label>
      <input
        ref={hpRef}
        id="footer_nl_hp"
        type="text"
        name="_hp"
        defaultValue=""
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <input
        ref={emailRef}
        id="footer_nl_email"
        name="email"
        type="email"
        defaultValue=""
        placeholder="Your email address"
        required
        autoComplete="email"
        className={`w-full bg-zinc-800 border text-zinc-200 text-sm px-3 py-2.5
                   placeholder-zinc-500 focus:outline-none focus:border-accent transition-colors
                   ${status === "error" ? "border-red-500" : "border-zinc-700"}`}
      />
      {status === "error" && <p className="text-xs text-red-400" role="alert">{errorMsg}</p>}
      {/* S-1 fix: Turnstile invisible widget — mirrors the pattern used in
          NewsletterSignup.tsx and app/subscribe/page.tsx.
          Rendered only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set so that
          local dev without the key still works (verifyTurnstileToken skips
          the check when TURNSTILE_SECRET_KEY is absent).
          appearance="execute" means no visible challenge UI — Cloudflare
          silently evaluates browser signals and calls onSuccess.
          M-2 fix: action="newsletter" binds the issued token to this form,
          so /api/newsletter's verifyTurnstileToken("newsletter") call
          rejects a token actually solved on a different form (e.g. the
          contact widget), preventing cross-endpoint replay. */}
      {siteKey && (
        <Turnstile
          ref={turnstileRef}
          siteKey={siteKey}
          onSuccess={(token) => { turnstileTokenRef.current = token; }}
          options={{ appearance: "execute", action: "newsletter" }}
        />
      )}
      <button type="submit" disabled={status === "submitting"}
        className="w-full bg-accent hover:bg-accent-dark disabled:opacity-60 text-white text-xs font-bold uppercase tracking-widest py-2.5 transition-colors">
        {status === "submitting" ? "Subscribing…" : "Subscribe"}
      </button>
    </form>
  );
}
