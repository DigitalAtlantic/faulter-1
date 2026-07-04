# Faulter — Threat Model & Accepted Security Trade-offs

This document records deliberate security decisions and their rationale.
It exists so that future changes are made with full awareness of the constraints
those decisions depend on, and so that the security posture is explicitly
owned rather than inherited by accident.

---

## CRIT-1 — XSS → CSRF Escalation Path

**Files:** `lib/csrf.ts`, `middleware.ts` (CSP), `app/api/csrf/route.ts`

### The structural dependency

CSRF protection uses the **double-submit cookie pattern**:
- The server sets a `csrf_token` cookie with `httpOnly: false` so that
  client-side JavaScript can read it.
- The client reads the cookie and echoes it in an `X-CSRF-Token` request header.
- The server verifies that the header value matches the cookie value.

This pattern is safe against *cross-origin* attackers because the browser's
same-origin policy prevents a page at `evil.com` from reading a cookie scoped
to our origin. A cross-origin attacker cannot read `csrf_token` and therefore
cannot set a matching `X-CSRF-Token` header.

**The known weakness:** any XSS vulnerability on our *own* origin can read
`csrf_token` from `document.cookie` (same-origin JS is not blocked by SameSite)
and forge a valid `X-CSRF-Token` header, bypassing CSRF protection for any
mutating endpoint.

In addition, the production Content Security Policy (CSP) uses
`script-src 'unsafe-inline'` rather than a per-request nonce. This is a
deliberate trade-off for CDN cacheability (see below). `'unsafe-inline'`
alone does not *introduce* XSS — it means that if XSS is achieved through
another vector, the browser will not use the CSP to block the injected script.

Together: **any DOM-based or reflected XSS → attacker can forge CSRF tokens
for all mutating endpoints.**

### Why this is accepted today

The current mutation scope is narrow and bounded:

| Endpoint | Effect | Independent protection |
|---|---|---|
| `POST /api/newsletter` | Adds an email to a mailing list | Turnstile, rate limit, Resend dedup |
| `POST /api/contact` | Sends a contact email | Turnstile, rate limit, no irreversible action |
| `POST /api/unsubscribe` | Unsubscribes an email | HMAC token bound to the email address |
| `POST /api/revalidate` | Purges CDN cache | Requires `REVALIDATE_SECRET` header |
| `POST /api/csrf` | Vends a new CSRF token | No state change |
| Server Action: `getBookmarkedArticles` | Reads public article data | No writes, no PII returned |

None of these actions are irreversible, privilege-escalating, or
credential-bearing in a way that would give an attacker meaningful leverage
beyond what they already have via the XSS vector itself. The unsubscribe
endpoint is additionally protected by a per-email HMAC token, so CSRF alone
cannot unsubscribe an arbitrary address.

The net risk today is low. This is not a reason to be complacent — it is a
reason the trade-off is accepted *now* while these are the only mutations.

### The CDN cacheability trade-off

The previous implementation generated a per-request cryptographic nonce and
embedded it in the CSP (`script-src 'nonce-X'`) and in the HTML
(`<script nonce="X">`). This required `app/layout.tsx` to call `headers()`
(a Next.js Dynamic API) to read the nonce, which forced every route in the
app to render dynamically (SSR on every request). No CDN could cache any HTML.

Switching back to nonce-based CSP would re-introduce that constraint:
`'unsafe-inline'` would be removed from `script-src`, which is strictly
stronger against XSS, but every page would become uncacheable again, defeating
the entire CDN architecture.

This trade-off is explicit. The site chooses static/ISR rendering and shared-
cache eligibility over the incremental XSS-mitigation benefit of a nonce.

### Trigger conditions for re-evaluation

**Before shipping any of the following, re-evaluate this entire design:**

1. **Any privileged or credential-bearing mutation** — password change,
   payment initiation, admin action, API key generation. These must not
   rely on the current CSRF scheme without independent token binding.

2. **A Markdown or rich-text renderer that outputs raw HTML** — `marked`,
   `remark-html`, `showdown`, Tiptap, Quill, Slate — unless all output is
   piped through `sanitizeArticleContent()` in `lib/sanitize.ts`.

3. **`dangerouslySetInnerHTML` with CMS-sourced content** outside the
   sanitizer pipeline.

4. **Any third-party embed script** loaded from an external domain — if the
   external domain is compromised, the script runs on our origin.

### Fix options when re-evaluation is triggered

**(a) Synchronizer Token Pattern** — store the CSRF secret server-side in an
HttpOnly session cookie (e.g. via NextAuth, Clerk, or Iron Session). The token
in the form/header is derived from the session secret; JS never reads the
secret directly. This makes XSS unable to forge CSRF tokens even if the secret
is in a cookie. Cost: requires a server-side session store.

**(b) Nonce-based CSP** — re-introduce per-request nonces, set `x-nonce` in
middleware and read it in `app/layout.tsx`. `script-src` removes `'unsafe-inline'`.
Cost: every route becomes `force-dynamic`; all CDN HTML caching is lost.

**(c) Both** — strongest posture. Synchronizer tokens make XSS→CSRF hard;
nonce-based CSP makes XSS harder to execute in the first place.

---

## CRIT-2 — Atlas IP Allowlist (infrastructure requirement)

**Files:** `lib/db.ts` (~line 163)

### What the code enforces

As of the CRIT-2 fix, `lib/db.ts` **throws and refuses to open the MongoDB
connection** in production if `ATLAS_IP_RESTRICTED !== "true"`. The site
returns errors on every DB-dependent request until the operator sets this flag.

`ATLAS_IP_RESTRICTED` is an acknowledgement token — it cannot verify that
the allowlist is actually restricted, because the code has no access to the
Atlas control plane. **Setting it without actually restricting the allowlist
gives false confidence and leaves the database fully exposed.**

### Why it matters

If the MongoDB Atlas IP Access List is set to `0.0.0.0/0` (allow all),
any actor who obtains `DATABASE_URL` can open a MongoDB shell directly
against the cluster and bypass every application-layer control:

- Rate limiting (not enforced at the DB layer)
- CSRF protection (not enforced at the DB layer)
- Input sanitization (not enforced at the DB layer)
- TTL indexes (still run, but the attacker can insert with past dates)
- Audit logging (the attacker bypasses `lib/db.ts` entirely)

`DATABASE_URL` contains plaintext credentials. Leak vectors include:
unredacted error logs, CI/CD log output, accidentally committed `.env` files,
or a compromised environment variable store.

### Required infrastructure steps

1. MongoDB Atlas → **Network Access** → **IP Access List**
2. Remove `0.0.0.0/0`.
3. Add only your deployment's egress IPs:
   - **Vercel:** follow https://vercel.com/guides/how-to-allowlist-deployment-ip-address
   - **VPS / Docker:** add the static IP(s) of your server(s).
4. Verify the change is live in the Atlas UI.
5. Set `ATLAS_IP_RESTRICTED=true` in your deployment environment variables.
6. Redeploy.

**This is a hard launch gate. The site will not serve any DB-dependent
request in production until step 5 is complete.**

---

## Document History

| Date | Change | Author |
|---|---|---|
| 2026-06 | Initial document — CRIT-1 and CRIT-2 from security audit | Security audit |
