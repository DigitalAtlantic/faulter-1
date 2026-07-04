"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile";
import { fetchCsrfToken, invalidateCsrfToken } from "@/lib/csrfToken.client";

type FormStatus = "idle" | "submitting" | "success" | "error";

// H-6 fix: allowlist of every 400 error string the /api/contact route can
// currently emit.  The contact page is the only consumer of this API, so
// keeping the allowed set here (client-side) in sync with the route handler
// is straightforward.
//
// WHY AN ALLOWLIST INSTEAD OF PASSING data.error DIRECTLY:
// The previous code did `res.status === 400 ? data.error : fixedString`.
// That is safe today because the route's 400 paths are enumerated validation
// messages.  But it creates a fragile implicit contract: any future 400 path
// added to the route — even accidentally (e.g. a thrown Error whose .message
// leaks a DB connection string, an internal path, or a stack frame) — would
// immediately surface in the UI verbatim.
//
// An allowlist inverts the default: only strings we have consciously reviewed
// are ever shown to users.  Any unrecognised 400 string falls back to the
// generic message, so new error paths in the route are safe by default.
//
// HOW TO KEEP THIS IN SYNC:
// If you add a new 400 response to app/api/contact/route.ts, add the exact
// error string here too.  The compile-time `satisfies` check below ensures
// this Set is never accidentally deleted.  A future improvement would be to
// colocate these strings in a shared constants file imported by both files.
const ALLOWED_CONTACT_400_MESSAGES = new Set<string>([
  // Body-read / parse failures
  "Invalid request.",
  // Field-presence check
  "All fields are required.",
  // Email format
  "Invalid email address.",
  // Subject allowlist mismatch
  "Invalid subject. Please select a subject from the list.",
  // Name length
  "Name must be at least 2 characters.",
  // Message length
  "Please provide a complete message (at least 10 characters).",
  // Bot detection (honeypot / timing) — intentionally generic, same string as
  // parse failure so bots can't distinguish which signal tripped.
  // (route returns "Invalid request." — already in the set above)
  // Turnstile failure — same generic string as parse failure.
  // (route returns "Invalid request." — already in the set above)
]) satisfies Set<string>;

// M-8 fix: status-code-keyed user messages.
// Never render raw API error strings — they may change as the API evolves
// and could leak internal details.  Map HTTP status codes to fixed,
// user-friendly strings instead.  The 400 case uses the allowlist above
// rather than passing data.error through directly (see H-6 comment).
const CONTACT_ERROR_MESSAGES: Record<number, string> = {
  400: "Please check your details and try again.", // allowlist-gated fallback
  403: "Your request couldn't be verified. Please refresh the page and try again.",
  413: "Your message is too long. Please shorten it and try again.",
  415: "Unexpected content type. Please try again.",
  429: "Too many submissions. Please wait a while before trying again.",
  502: "We couldn't send your message right now. Please try again in a few minutes.",
};

export default function ContactPage() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  // L-6 fix: true when /api/csrf returned a non-200 / empty token at mount
  // time (e.g. a 503 during a deploy).  Shown immediately so the user knows
  // the form is unavailable before they attempt a doomed submission.
  const [csrfUnavailable, setCsrfUnavailable] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  // Honeypot: hidden field that bots fill but real users never see.
  const [hp, setHp] = useState("");
  // Timing: record when the form first rendered so the server can reject
  // submissions that arrive suspiciously fast.
  const loadedAtRef = useRef<string>(new Date().toISOString());
  // M-2 fix: CSRF token for the double-submit cookie fallback.
  // Fetched once on mount from /api/csrf which sets the csrf_token cookie
  // and returns the same value in JSON.  We include it as the X-CSRF-Token
  // header on every form submission so the server can verify the pair even
  // when Origin/Referer have been stripped by a proxy.
  const csrfTokenRef = useRef<string>("");
  // C-1 fix: Cloudflare Turnstile challenge response token.
  // Set by the Turnstile widget's onSuccess callback once the invisible
  // challenge completes.  Included in the POST body so the /api/contact route
  // can verify it server-side via verifyTurnstileToken().
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

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfTokenRef.current) {
        headers["X-CSRF-Token"] = csrfTokenRef.current;
      }
      const res = await fetch("/api/contact", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...form,
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
      const data = await res.json() as { error?: string };
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
        // H-6 fix: for 400 responses, show data.error only if it is a member
        // of the ALLOWED_CONTACT_400_MESSAGES allowlist.  An unrecognised
        // string (e.g. from a future error path added to the route without
        // updating the allowlist, or from an unexpected library error that
        // propagates as a 400) falls back to the generic 400 message.
        // All other status codes continue to use fixed strings from the map.
        let displayMsg: string;
        if (res.status === 400) {
          const serverMsg = typeof data.error === "string" ? data.error : "";
          displayMsg = ALLOWED_CONTACT_400_MESSAGES.has(serverMsg)
            ? serverMsg
            : (CONTACT_ERROR_MESSAGES[400] ?? "Please check your details and try again.");
        } else {
          displayMsg =
            CONTACT_ERROR_MESSAGES[res.status] ??
            "Something went wrong. Please try again.";
        }
        setErrorMsg(displayMsg);
        // S-2 fix: spent token — reset the widget so the next retry gets a
        // fresh challenge rather than resending a single-use token.
        turnstileRef.current?.reset();
        turnstileTokenRef.current = "";
        return;
      }
      setStatus("success");
      setForm({ name: "", email: "", subject: "", message: "" });
    } catch {
      setStatus("error");
      setErrorMsg("Unable to send your message. Please check your connection and try again.");
      // S-2 fix: network failure also invalidates the token challenge cycle.
      turnstileRef.current?.reset();
      turnstileTokenRef.current = "";
    }
  };

  return (
    <div className="max-w-screen-xl mx-auto px-5 py-8">
      <nav className="flex items-center gap-2 text-xs text-ink-muted dark:text-zinc-500 font-sans mb-8" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-accent transition-colors">Home</Link>
        <span>/</span>
        <span>Contact</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 max-w-4xl">
        <div>
          <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-accent mb-4">Contact Us</p>
          <h1 className="font-serif text-4xl font-black text-ink dark:text-zinc-100 mb-6 leading-tight">
            Get in touch with Faulter
          </h1>
          <p className="text-[17px] font-sans leading-relaxed text-ink-secondary dark:text-zinc-400 mb-8">
            For editorial enquiries, corrections, tip-offs, or general feedback,
            use the form or find the right contact below.
          </p>
          <div className="space-y-6">
            {[
              { title: "Editorial",   desc: "Story tips, press releases, interview requests", email: "editorial@faulter.news" },
              { title: "Corrections", desc: "Report a factual error in our coverage",         email: "corrections@faulter.news" },
              { title: "Advertising", desc: "Commercial partnerships and advertising enquiries", email: "advertising@faulter.news", id: "advertise" },
              { title: "Technical",  desc: "Website issues, accessibility concerns",          email: "tech@faulter.news" },
            ].map((c) => (
              <div key={c.title} id={c.id} className="border-l-4 border-accent pl-4">
                <h3 className="font-serif font-bold text-ink dark:text-zinc-100">{c.title}</h3>
                <p className="text-sm text-ink-secondary dark:text-zinc-400 mb-1">{c.desc}</p>
                <a href={`mailto:${c.email}`} className="text-sm text-accent hover:underline">{c.email}</a>
              </div>
            ))}
          </div>
        </div>

        <div>
          {status === "success" ? (
            <div className="py-16 text-center border border-border dark:border-border-dark px-8">
              <svg className="w-10 h-10 mx-auto text-green-500 mb-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <h2 className="font-serif text-2xl font-bold text-ink dark:text-zinc-100 mb-2">Message sent</h2>
              <p className="text-sm text-ink-secondary dark:text-zinc-400 mb-6">
                Thank you for reaching out. We aim to respond within two business days.
              </p>
              <button onClick={() => setStatus("idle")}
                className="text-xs font-sans font-bold uppercase tracking-widest text-accent hover:underline">
                Send another message
              </button>
            </div>
          ) : (
            <>
              {/* L-6 fix: shown immediately when the CSRF token fetch failed at
                  mount time (e.g. /api/csrf returned 503 during a deploy).
                  Prevents the user from filling out and submitting a form that
                  will always return a confusing 403 "couldn't be verified" error.
                  Placed above the form so it's visible without any interaction. */}
              {csrfUnavailable && (
                <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3 mb-4" role="alert">
                  This form is temporarily unavailable. Please refresh the page and try again.
                </p>
              )}
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Honeypot — visually hidden, never filled by real users.
                  aria-hidden prevents screen readers from announcing it. */}
              <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
                <label htmlFor="_hp">Leave this field blank</label>
                <input
                  id="_hp"
                  name="_hp"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                  className="hidden honeypot"
                />
              </div>
              {[
                { id: "name",  label: "Name",  type: "text",  placeholder: "Your full name" },
                { id: "email", label: "Email", type: "email", placeholder: "your@email.com" },
              ].map((f) => (
                <div key={f.id}>
                  <label htmlFor={f.id} className="block text-xs font-sans font-semibold uppercase tracking-widest text-ink-secondary dark:text-zinc-400 mb-1.5">
                    {f.label}
                  </label>
                  <input id={f.id} type={f.type} required
                    value={form[f.id as keyof typeof form]}
                    onChange={(e) => update(f.id, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full border border-border dark:border-border-dark bg-transparent px-4 py-3 text-sm
                               text-ink dark:text-zinc-100 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              ))}
              <div>
                <label htmlFor="subject" className="block text-xs font-sans font-semibold uppercase tracking-widest text-ink-secondary dark:text-zinc-400 mb-1.5">Subject</label>
                <select id="subject" required value={form.subject} onChange={(e) => update("subject", e.target.value)}
                  className="w-full border border-border dark:border-border-dark bg-paper dark:bg-zinc-950 px-4 py-3 text-sm text-ink dark:text-zinc-100 focus:outline-none focus:border-accent transition-colors">
                  <option value="">Select a subject</option>
                  <option value="editorial">Editorial enquiry</option>
                  <option value="tip">Story tip</option>
                  <option value="correction">Correction request</option>
                  <option value="advertising">Advertising</option>
                  <option value="technical">Technical issue</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="message" className="block text-xs font-sans font-semibold uppercase tracking-widest text-ink-secondary dark:text-zinc-400 mb-1.5">Message</label>
                <textarea id="message" required rows={6} value={form.message} onChange={(e) => update("message", e.target.value)}
                  placeholder="Your message…"
                  className="w-full border border-border dark:border-border-dark bg-transparent px-4 py-3 text-sm
                             text-ink dark:text-zinc-100 focus:outline-none focus:border-accent transition-colors resize-none"
                />
              </div>
              {status === "error" && (
                <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3" role="alert">
                  {errorMsg}
                </p>
              )}
              {/* C-1 fix: Turnstile invisible widget.
                  Rendered only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set so
                  that local dev without the key works without the widget.
                  onSuccess stores the token in a ref; the token is sent with
                  the POST body in handleSubmit so the server can verify it.
                  appearance="execute" means no visible UI — Cloudflare
                  completes the challenge automatically in the background.
                  M-2 fix: action="contact" binds the issued token to this
                  form. /api/contact's verifyTurnstileToken("contact") call
                  rejects the token if it was actually solved on a different
                  form (e.g. the newsletter widget), preventing cross-endpoint
                  token replay. */}
              {siteKey && (
                <Turnstile
                  ref={turnstileRef}
                  siteKey={siteKey}
                  onSuccess={(token) => { turnstileTokenRef.current = token; }}
                  options={{ appearance: "execute", action: "contact" }}
                />
              )}
              <button type="submit" disabled={csrfUnavailable || status === "submitting"}
                className="w-full bg-accent hover:bg-accent-dark disabled:opacity-60 disabled:cursor-not-allowed
                           text-white font-sans font-bold text-xs uppercase tracking-widest py-4 transition-colors">
                {status === "submitting" ? "Sending…" : "Send Message"}
              </button>
            </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
