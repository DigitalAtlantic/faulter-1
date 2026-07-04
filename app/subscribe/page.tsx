"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { fetchCsrfToken, invalidateCsrfToken } from "@/lib/csrfToken.client";

type Status = "idle" | "submitting" | "success" | "error";

// M-8 fix: status-code-keyed user messages.
// Never render raw API error strings — they may change as the API evolves.
// Map HTTP status codes to fixed, user-friendly strings instead.
const NEWSLETTER_ERROR_MESSAGES: Record<number, string> = {
  400: "Please enter a valid email address.",
  403: "Your request couldn't be verified. Please refresh the page and try again.",
  413: "Request too large. Please try again.",
  415: "Unexpected content type. Please try again.",
  429: "Too many attempts. Please wait a while before trying again.",
  502: "We couldn't process your subscription right now. Please try again in a few minutes.",
};

export default function SubscribePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  // L-6 fix: true when /api/csrf returned a non-200 / empty token at mount
  // time (e.g. a 503 during a deploy).  Shown immediately so the user knows
  // the form is unavailable before they attempt a doomed submission.
  const [csrfUnavailable, setCsrfUnavailable] = useState(false);
  // Uncontrolled refs — see NewsletterSignup.tsx for the full explanation.
  // Short version: controlled value={email} causes React to overwrite autofill.
  const emailRef = useRef<HTMLInputElement>(null);
  const hpRef = useRef<HTMLInputElement>(null);
  const loadedAtRef = useRef<string>(new Date().toISOString());
  const csrfTokenRef = useRef<string>("");
  // C-1 fix: Cloudflare Turnstile challenge response token.
  // Set by the Turnstile widget's onSuccess callback once the invisible
  // challenge completes.  Included in the POST body so the /api/newsletter
  // route can verify it server-side via verifyTurnstileToken().
  // Without this the route returns 400 in production when TURNSTILE_SECRET_KEY
  // is set because verifyTurnstileToken(null, ip) → { success: false }.
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
    // L-6 fix: detect a failed token fetch at mount time rather than waiting
    // for the user to submit.  fetchCsrfToken() never rejects — it resolves
    // to "" when /api/csrf is unavailable (503, network error, etc.).  An
    // empty string means the double-submit CSRF header will be absent, which
    // the server rejects with a confusing 403 "couldn't be verified" message.
    // Surfacing the error here gives the user an actionable "refresh the page"
    // prompt before they spend time filling out the form.
    fetchCsrfToken().then((token) => {
      if (token) {
        csrfTokenRef.current = token;
      } else {
        setCsrfUnavailable(true);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");
    const email = emailRef.current?.value ?? "";
    const hp = hpRef.current?.value ?? "";
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfTokenRef.current) {
        headers["X-CSRF-Token"] = csrfTokenRef.current;
      }
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          _hp: hp,
          _loadedAt: loadedAtRef.current,
          // C-1 fix: include Turnstile token so the server-side
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
        // M-8 fix: fixed string per status code — never pass _data.error through
        // directly, as that string may change or leak details in the future.
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
    } catch {
      setStatus("error");
      setErrorMsg("Unable to subscribe. Please check your connection and try again.");
      // S-2 fix: network failure also invalidates the token challenge cycle.
      turnstileRef.current?.reset();
      turnstileTokenRef.current = "";
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-16 text-center">
      <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-6">Newsletter</p>
      <h1 className="font-serif text-4xl lg:text-5xl font-black text-ink dark:text-zinc-100 mb-4 leading-tight">
        The Faulter Morning Briefing
      </h1>
      <p className="text-lg font-sans text-ink-secondary dark:text-zinc-400 leading-relaxed mb-10">
        The day&apos;s most important stories — from our correspondents around the world —
        delivered to your inbox every morning before 8am. Free, always.
      </p>

      {status === "success" ? (
        <div className="border border-border dark:border-border-dark p-10">
          <svg className="w-10 h-10 mx-auto text-green-500 mb-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <h2 className="font-serif text-2xl font-bold text-ink dark:text-zinc-100 mb-2">You&apos;re subscribed</h2>
          <p className="text-ink-secondary dark:text-zinc-400 font-sans mb-6">
            Welcome to Faulter. Your first briefing will arrive tomorrow morning.
          </p>
          <Link href="/" className="text-accent hover:underline text-sm font-sans font-medium">← Back to home</Link>
        </div>
      ) : (
        <>
          {/* L-6 fix: shown immediately when the CSRF token fetch failed at
              mount time (e.g. /api/csrf returned 503 during a deploy).
              Prevents the user from filling out and submitting a form that
              will always return a confusing 403 "couldn't be verified" error.
              Placed above the form so it's visible without any interaction. */}
          {csrfUnavailable && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3 max-w-md mx-auto mb-3" role="alert">
              This form is temporarily unavailable. Please refresh the page and try again.
            </p>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2 max-w-md mx-auto mb-3">
            {/* Honeypot — visually hidden, never filled by real users.
                aria-hidden prevents screen readers from announcing it. */}
            <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
              <label htmlFor="nl_hp" className="sr-only">Leave this field blank</label>
              <input
                ref={hpRef}
                id="nl_hp"
                name="_hp"
                type="text"
                defaultValue=""
                tabIndex={-1}
                autoComplete="off"
                className="hidden honeypot"
              />
            </div>
            <input
              ref={emailRef}
              id="subscribe_email"
              name="email"
              type="email"
              required
              defaultValue=""
              placeholder="Enter your email address"
              autoComplete="email"
              className={`flex-1 border bg-transparent px-4 py-3 text-sm text-ink dark:text-zinc-100
                         placeholder-ink-muted dark:placeholder-zinc-600 focus:outline-none focus:border-accent transition-colors
                         ${status === "error" ? "border-red-400" : "border-border dark:border-border-dark"}`}
            />
            <button type="submit" disabled={csrfUnavailable || status === "submitting"}
              className="bg-accent hover:bg-accent-dark disabled:opacity-60 text-white text-xs font-bold uppercase tracking-widest px-6 py-3 transition-colors whitespace-nowrap">
              {status === "submitting" ? "…" : "Subscribe Free"}
            </button>
          </form>
          {/* C-1 fix: Turnstile invisible widget.
              Rendered only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set so
              that local dev without the key works without the widget.
              onSuccess stores the token in a ref; the token is sent with
              the POST body in handleSubmit so the server can verify it.
              appearance="execute" means no visible UI — Cloudflare
              completes the challenge automatically in the background.
              M-2 fix: action="newsletter" binds the issued token to this
              form (this page posts to /api/newsletter), so
              verifyTurnstileToken("newsletter") rejects a token actually
              solved on a different form (e.g. the contact widget),
              preventing cross-endpoint replay. */}
          {siteKey && (
            <Turnstile
              ref={turnstileRef}
              siteKey={siteKey}
              onSuccess={(token) => { turnstileTokenRef.current = token; }}
              options={{ appearance: "execute", action: "newsletter" }}
            />
          )}
          {status === "error" && <p className="text-sm text-red-500 mb-3" role="alert">{errorMsg}</p>}
          <p className="text-xs text-ink-muted dark:text-zinc-600 font-sans">
            No spam. Unsubscribe at any time. See our{" "}
            <Link href="/privacy" className="hover:text-accent underline">Privacy Policy</Link>.
          </p>
        </>
      )}

      <div className="mt-16 pt-10 border-t border-border dark:border-border-dark grid grid-cols-1 sm:grid-cols-3 gap-8 text-left">
        {[
          { label: "Daily",   title: "Every morning",        body: "Delivered by 8am on weekdays, 9am on weekends." },
          { label: "Trusted", title: "Independent reporting", body: "No agenda, no sponsorship. Just journalism." },
          { label: "Free",    title: "Always free",           body: "The Morning Briefing is free, forever." },
        ].map((item) => (
          <div key={item.title}>
            <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-2">{item.label}</p>
            <h3 className="font-serif font-bold text-ink dark:text-zinc-100 mb-1">{item.title}</h3>
            <p className="text-sm text-ink-secondary dark:text-zinc-400">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
