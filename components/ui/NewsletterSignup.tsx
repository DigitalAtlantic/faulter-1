"use client";

import { useState, useRef, useEffect } from "react";
import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { fetchCsrfToken, invalidateCsrfToken } from "@/lib/csrfToken.client";

type Status = "idle" | "submitting" | "success" | "error";

interface NewsletterSignupProps {
  variant?: "sidebar" | "inline";
}

// M-6 fix: error messages keyed by HTTP status code.
// Never render raw API error strings — map status codes to fixed, safe strings
// so internal details cannot leak and copy can be changed without touching
// multiple places.
const NEWSLETTER_ERROR_MESSAGES: Record<number, string> = {
  400: "Please enter a valid email address.",
  403: "Your request couldn't be verified. Please refresh the page and try again.",
  413: "Request too large. Please try again.",
  415: "Unexpected content type. Please try again.",
  429: "Too many attempts. Please wait a while before trying again.",
  502: "We couldn't process your subscription right now. Please try again in a few minutes.",
};

export function NewsletterSignup({ variant = "sidebar" }: NewsletterSignupProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  // Uncontrolled refs — browser/extension autofill writes directly to the DOM
  // value without firing React's synthetic onChange, so a controlled
  // `value={email}` would immediately overwrite whatever was autofilled back
  // to the empty-string initial state. Using refs lets autofill work naturally
  // and we read the final value only at submit time.
  const emailRef = useRef<HTMLInputElement>(null);
  const hpRef = useRef<HTMLInputElement>(null);
  const loadedAtRef = useRef<string>(new Date().toISOString());
  // CSRF token for the double-submit cookie fallback.
  const csrfTokenRef = useRef<string>("");
  // M-6 fix: Turnstile challenge token. Set by the Turnstile widget's
  // onSuccess callback once the invisible challenge completes. Included in
  // the POST body so the /api/newsletter route can verify it server-side.
  // Without this, the route returns 400 in production when TURNSTILE_SECRET_KEY
  // is set because verifyTurnstileToken(null, ip) → { success: false }.
  const turnstileTokenRef = useRef<string>("");
  // S-2 fix: ref to the Turnstile widget so we can call reset() after any
  // failed submission. Turnstile tokens are single-use — if the POST fails
  // (quota exceeded, network error, bad CSRF, etc.) the spent token is still
  // in turnstileTokenRef and the next retry would send it again, causing
  // Cloudflare to reject with { success: false }. reset() discards the old
  // token and triggers a fresh silent challenge; we also clear turnstileTokenRef
  // so handleSubmit cannot inadvertently send an empty/stale value before
  // onSuccess fires with the replacement token.
  const turnstileRef = useRef<TurnstileInstance>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    // Shared token cache — all newsletter/form components on the page call
    // fetchCsrfToken() and receive the same Promise if a fetch is already
    // in-flight, or the cached token if one is still valid.  This eliminates
    // the burst of duplicate /api/csrf requests that React StrictMode's
    // double-invoke of effects caused during development.  See
    // lib/csrfToken.client.ts for the full rationale and expiry logic.
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
        body: JSON.stringify({
          email,
          _hp: hp,
          _loadedAt: loadedAtRef.current,
          // M-6 fix: include Turnstile token in every POST so the server-side
          // verifyTurnstileToken() call receives a real token rather than null.
          // When NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset the widget is not
          // rendered and the token remains ""; the API route skips verification
          // in that case because TURNSTILE_SECRET_KEY will also be unset.
          turnstileToken: turnstileTokenRef.current || undefined,
        }),
      });
      const _data = await res.json() as { error?: string };
      if (!res.ok) {
        // L-1 fix: a 403 means the server rejected our CSRF token (expired or
        // replayed). Invalidate the cache so the next fetchCsrfToken() call
        // goes back to the server for a fresh token instead of retrying with
        // the same bad one.
        if (res.status === 403) {
          // Invalidate the module-level cache and immediately prefetch a fresh
          // token into csrfTokenRef so the next retry attempt sends a valid one
          // rather than the same stale token that just caused the 403.
          invalidateCsrfToken();
          fetchCsrfToken().then((t) => { if (t) csrfTokenRef.current = t; });
        }
        setStatus("error");
        setErrorMsg(
          NEWSLETTER_ERROR_MESSAGES[res.status] ??
          "Something went wrong. Please try again."
        );
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
      setErrorMsg("Unable to subscribe. Please check your connection and try again.");
      // S-2 fix: network failure also invalidates the token challenge cycle.
      turnstileRef.current?.reset();
      turnstileTokenRef.current = "";
    }
  };

  if (variant === "inline") {
    return (
      <div className="bg-paper-warm dark:bg-zinc-900 border border-border dark:border-border-dark p-8 my-10">
        <div className="max-w-lg">
          <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-2">Newsletter</p>
          <h3 className="font-serif text-2xl font-bold text-ink dark:text-zinc-100 mb-2">
            The Faulter Morning Briefing
          </h3>
          <p className="text-sm text-ink-secondary dark:text-zinc-400 mb-5">
            The day&apos;s most important stories, delivered to your inbox before 8am.
          </p>
          {status === "success" ? (
            <p className="text-sm text-green-600 font-sans font-medium">✓ You&apos;re subscribed. Welcome to Faulter.</p>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="flex gap-2">
                {/* Honeypot — visually hidden, bots fill it, humans don't */}
                <label htmlFor="nl_inline_hp" className="sr-only">Leave this field blank</label>
                <input
                  ref={hpRef}
                  id="nl_inline_hp"
                  type="text"
                  name="_hp"
                  defaultValue=""
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="hidden honeypot"
                />
                <input
                  ref={emailRef}
                  id="nl_inline_email"
                  name="email"
                  type="email"
                  defaultValue=""
                  placeholder="Enter your email"
                  required
                  autoComplete="email"
                  className={`flex-1 border px-3 py-2.5 text-sm bg-paper dark:bg-zinc-950 text-ink dark:text-zinc-100
                              placeholder-ink-muted dark:placeholder-zinc-600 focus:outline-none focus:border-accent transition-colors
                              ${status === "error" ? "border-red-400" : "border-border dark:border-border-dark"}`}
                />
                <button type="submit" disabled={status === "submitting"}
                  className="bg-accent hover:bg-accent-dark disabled:opacity-60 text-white text-xs font-bold uppercase tracking-widest px-5 py-2.5 transition-colors whitespace-nowrap">
                  {status === "submitting" ? "…" : "Subscribe"}
                </button>
              </form>
              {/* M-6 fix: Turnstile invisible widget.
                  Rendered only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set so that
                  local dev without the key works without the widget.
                  onSuccess stores the token in a ref; the token is sent with the
                  POST body in handleSubmit so the server can verify it.
                  appearance="execute" means no visible challenge UI — Cloudflare
                  completes the challenge automatically in the background and calls
                  onSuccess.  ("invisible" was a Cloudflare v1 alias; the correct
                  @marsidev/react-turnstile v0.7+ enum value is "execute".)
                  M-2 fix: action="newsletter" binds the issued token to this
                  form, so /api/newsletter's verifyTurnstileToken("newsletter")
                  call rejects a token actually solved on a different form
                  (e.g. the contact widget), preventing cross-endpoint replay. */}
              {siteKey && (
                <Turnstile
                  ref={turnstileRef}
                  siteKey={siteKey}
                  onSuccess={(token) => { turnstileTokenRef.current = token; }}
                  options={{ appearance: "execute", action: "newsletter" }}
                />
              )}
              {status === "error" && <p className="text-xs text-red-500 mt-2" role="alert">{errorMsg}</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border dark:border-border-dark p-5">
      <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-3">Newsletter</p>
      <h3 className="font-serif text-lg font-bold text-ink dark:text-zinc-100 mb-2 leading-tight">Morning Briefing</h3>
      <p className="text-xs text-ink-secondary dark:text-zinc-400 mb-4 leading-relaxed">The day&apos;s top stories in your inbox every morning.</p>
      {status === "success" ? (
        <p className="text-xs text-green-600 font-sans font-medium py-2">✓ You&apos;re subscribed!</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          {/* Honeypot — visually hidden, bots fill it, humans don't */}
          <label htmlFor="nl_sidebar_hp" className="sr-only">Leave this field blank</label>
          <input
            ref={hpRef}
            id="nl_sidebar_hp"
            type="text"
            name="_hp"
            defaultValue=""
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="hidden honeypot"
          />
          <input
            ref={emailRef}
            id="nl_sidebar_email"
            name="email"
            type="email"
            defaultValue=""
            placeholder="Your email address"
            required
            autoComplete="email"
            className={`w-full border px-3 py-2 text-sm bg-transparent text-ink dark:text-zinc-100
                        placeholder-ink-muted dark:placeholder-zinc-600 focus:outline-none focus:border-accent transition-colors
                        ${status === "error" ? "border-red-400" : "border-border dark:border-border-dark"}`}
          />
          {/* M-6 fix: Turnstile invisible widget — see inline variant above for rationale.
              M-2 fix: action="newsletter" — see inline variant above for rationale. */}
          {siteKey && (
            <Turnstile
              ref={turnstileRef}
              siteKey={siteKey}
              onSuccess={(token) => { turnstileTokenRef.current = token; }}
              options={{ appearance: "execute", action: "newsletter" }}
            />
          )}
          {status === "error" && <p className="text-xs text-red-500" role="alert">{errorMsg}</p>}
          <button type="submit" disabled={status === "submitting"}
            className="w-full bg-ink dark:bg-zinc-700 hover:bg-accent dark:hover:bg-accent disabled:opacity-60 text-paper text-xs font-bold uppercase tracking-widest py-2.5 transition-colors">
            {status === "submitting" ? "Subscribing…" : "Subscribe Free"}
          </button>
        </form>
      )}
    </div>
  );
}
