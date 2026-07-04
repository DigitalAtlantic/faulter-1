## Summary

<!-- What does this PR do? Why? Link any relevant issues. -->

---

## Security checklist

Work through every section that applies to this PR.  Skip sections that are
not relevant and note why (e.g. "no content rendering changes").  Leave the
checkboxes — a reviewer will verify them during review.

### 🔴 Content rendering paths (XSS → CSRF escalation risk)

**Required for any PR that adds or changes how HTML reaches the DOM.**

`csrf_token` is intentionally `httpOnly: false` (required by the double-submit
cookie pattern). This means any same-origin XSS directly enables CSRF: the
attacker reads the cookie and forges `X-CSRF-Token`. See `lib/csrf.ts` for the
full analysis.

- [ ] **No new `dangerouslySetInnerHTML`** added outside the two pre-approved
      patterns (`safeJsonLd()` and `safeContent` after `sanitizeArticleContent()`).
      *(ESLint rule fires on any other use — a suppression comment with written
      justification is required.)*
- [ ] **No new Markdown-to-HTML renderer** (`marked`, `showdown`, `markdown-it`,
      `remarkable`, `remark-html`) imported without routing output through
      `sanitizeArticleContent()` first.
      *(ESLint `no-restricted-imports` fires on these packages.)*
- [ ] **No new `<iframe>`, `<embed>`, or `<object>` element** added that points
      at user-controlled or CMS-sourced URLs.
- [ ] **No new third-party `<script>` tag** added inline or via `next/script`
      with a `src` pointing at an external origin.
      *(If added: confirm the nonce from `app/layout.tsx` is applied and the
      CSP `script-src` in `middleware.ts` is updated.)*
- [ ] **No new rich-text editor** (Tiptap, Quill, Slate, ProseMirror) that stores
      HTML in MongoDB and re-renders without sanitization on load.

*If any box above is checked `false` (i.e. a new rendering path was added):*
> Confirm in a comment below that the output is sanitized through
> `sanitizeArticleContent()` **before** it reaches `dangerouslySetInnerHTML`,
> or explain the alternative XSS mitigation.

---

### 🟠 Cookie / CSRF changes

**Required for any PR that modifies cookie attributes, adds a new cookie, or
changes the CSRF validation flow.**

- [ ] No change to `csrf_token` cookie attributes (`sameSite`, `httpOnly`,
      `secure`, `maxAge`, `path`) without updating `lib/csrf.ts` and the
      comment in `app/api/csrf/route.ts`.
- [ ] No new cookie that carries session state or privileges uses `sameSite: "lax"`
      instead of `"strict"`.  *(See the `rl_search` vs `csrf_token` rationale
      in `middleware.ts` → `// M-4` comment for when `"lax"` is appropriate.)*
- [ ] No change to Origin/Referer validation logic in `lib/csrf.ts` without a
      corresponding update to `isValidCsrfOrigin()` tests.

---

### 🟠 SVG / image pipeline changes

**Required for any PR that modifies `next.config.mjs` image settings, adds a
`remotePatterns` entry, or introduces a file-upload/CMS path that writes to `public/`.**

- [ ] `dangerouslyAllowSVG: true` has not been added or left in place alongside
      a non-empty `remotePatterns`.
      *(ESLint fires unconditionally on `dangerouslyAllowSVG: true`; a suppression
      comment with justification is required.)*
- [ ] If `remotePatterns` is now non-empty: `dangerouslyAllowSVG` is set to
      `false` **or** images are served from a sandboxed origin.
- [ ] If CMS/CI now writes SVGs to `public/` at build time: `scripts/audit-svg.mjs`
      has been verified to run **after** the write step, not before.
- [ ] `SVG_CDN_TICKET` in `next.config.mjs` has been updated from `UNTRACKED`
      to a real ticket ID if this PR begins CMS or upload work.

---

### 🟡 Rate limiting / Upstash changes

**Required for any PR that modifies `lib/upstash.ts`, `lib/rateLimit.ts`, or
adds a new rate-limited endpoint.**

- [ ] `upstashIncr()` uses `["EXPIRE", key, windowSeconds, "NX"]` — not plain
      `["EXPIRE", key, windowSeconds]`.  The `NX` flag locks the window at
      first-hit time; removing it resets the TTL on every request, disabling
      the limit under sustained load.
- [ ] Any new rate-limited key follows the `{route}:{ip}` naming convention
      already used by contact, newsletter, CSRF, and search limiters.
- [ ] The in-process `Map` fallback in `checkRateLimit()` is still the only
      fallback path — no new direct Redis calls bypass the shared helper.

---

### 🟡 MongoDB / database changes

**Required for any PR that adds a new query, collection, or field.**

- [ ] No new `$regex` with a user-supplied string — use `$text` search with the
      `article_text_search` index instead.
      *(ESLint `no-restricted-syntax` fires on `$regex` property keys.)*
- [ ] Any new index is added to `scripts/create-indexes.ts` and documented in
      the README `### MongoDB Index Setup` section.
- [ ] GDPR-sensitive fields (email, IP) are stored as keyed HMAC digests, not
      plaintext.

---

### 🟡 Type-contract changes (`types/index.ts`)

**Required for any PR that modifies `types/index.ts`.**

- [ ] No field removed from the `Omit` in `PublicArticle`
      (`"author" | "content" | "sanitizedContent" | "views"`) without a
      security review confirming the field is safe to expose to the client.
- [ ] No change to `PublicAuthor` that re-introduces `email` or any other
      internal-only field.
- [ ] If a new field is added to `Article`, assess whether it belongs in
      `PublicArticle`; if it should be excluded, add it to the `Omit` list
      **and** strip it in `toPublicArticle()` in `lib/articles.ts`.
- [ ] `sanitizedContent` remains a **required** (non-optional) `string` on
      `PublicArticle` — it must never be widened back to `string | undefined`.

---

### Atlas IP allowlist reminder (M-3)

> This cannot be verified from code.  If this PR changes the deployment
> environment (new Vercel project, new region, new NAT gateway), a team member
> must log into MongoDB Atlas → **Security → Network Access** and confirm
> `0.0.0.0/0` is absent before the deployment is promoted to production.
> Update `ATLAS_IP_RESTRICTED=true` in the new environment's config after
> confirming.
