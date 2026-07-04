// Prevent this module from being imported in Client Components.
// lib/sanitize.ts runs server-side HTML sanitization on stored content —
// it should never be bundled into the browser where its output is trusted.
import "server-only";

import sanitizeHtmlLib from "sanitize-html";
import type { IOptions } from "sanitize-html";

/**
 * Production-safe HTML sanitizer built on sanitize-html (allowlist approach).
 *
 * Why not regex?  Regex cannot reliably parse HTML — nested tags, attribute
 * quoting variations, Unicode escapes, and browser quirks all create bypass
 * vectors.  sanitize-html uses a real HTML parser and an allowlist so only
 * explicitly permitted tags/attributes survive.
 *
 * Tag scope: only tags that legitimately appear inside article body copy are
 * allowed.  Page-level structural tags (nav, header, footer, main, aside) are
 * intentionally excluded — they have no place in stored article content and
 * allowing them would let injected markup blend into the page chrome.
 *
 * h1 is intentionally omitted — it is reserved for the page <h1>.
 */
const ALLOWED_TAGS = [
  // Block-level content
  "p", "div", "section", "article",
  "h2", "h3", "h4", "h5", "h6",
  // Inline text formatting
  "strong", "b", "em", "i", "u", "s", "mark", "small", "sup", "sub",
  "code", "kbd", "samp", "pre",
  // Lists
  "ul", "ol", "li", "dl", "dt", "dd",
  // Media
  "figure", "figcaption", "img", "picture", "source",
  // Tables
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "col", "colgroup",
  // Misc inline/block
  "blockquote", "hr", "br", "span", "time", "abbr", "cite", "q", "a",
];

const ALLOWED_ATTRIBUTES: IOptions["allowedAttributes"] = {
  // "style" is intentionally omitted from the global wildcard.
  // Allowing arbitrary inline styles is a vector for CSS-based data exfiltration
  // (e.g. expression(), url() with tracking pixels) and obscures injected content.
  // If specific elements need styling, add them explicitly by tag below.
  //
  // L-6 fix: "id" is also intentionally omitted from the global wildcard.
  // Letting any allowed tag carry an arbitrary `id` lets a malicious or
  // careless CMS author collide with an id this app's own client components
  // depend on for behaviour, not just styling — e.g. document.getElementById()
  // calls and in-page anchor targeting (#some-id) used by reading-progress,
  // bookmark, and scroll-to-anchor logic elsewhere in the app. A collided
  // class is a cosmetic/CSS-only risk (the finding's own framing); a collided
  // id can change which DOM node a script actually operates on. No current
  // article content relies on `id`, so removing it from the wildcard is a
  // safe tightening with no behavioural change today. `class` is kept: it
  // has legitimate editorial uses (e.g. `<pre class="language-js">` for
  // syntax highlighting) and the worst case is a CSS collision, which the
  // production CSP already constrains.
  "*":      ["class", "title", "lang", "dir", "aria-label", "aria-hidden",
             "role", "tabindex"],
  a:        ["href", "rel", "target"],
  img:      ["src", "alt", "width", "height", "loading", "decoding", "sizes", "srcset"],
  source:   ["src", "srcset", "media", "type"],
  time:     ["datetime"],
  abbr:     ["title"],
  blockquote: ["cite"],
  q:        ["cite"],
  th:       ["scope", "colspan", "rowspan"],
  td:       ["colspan", "rowspan"],
  col:      ["span"],
  colgroup: ["span"],
};

const OPTIONS: IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  // Restrict URL schemes to safe ones; data: URIs are explicitly excluded
  // (they can carry executable payloads in some browser/context combinations).
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: {
    // L-1 fix: images restricted to https only. http:// image sources trigger
    // mixed-content warnings/blocks in modern browsers on HTTPS deployments.
    // data: URIs remain excluded — they can carry executable payloads.
    img: ["https"],
    // Source elements (inside <picture>) likewise — https only.
    source: ["https"],
  },
  allowedSchemesAppliedToAttributes: ["href", "src", "cite", "srcset"],
  transformTags: {
    // Automatically make external links safe
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const isExternal =
        href.startsWith("http://") || href.startsWith("https://");
      return {
        tagName,
        attribs: {
          ...attribs,
          ...(isExternal
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {}),
        },
      };
    },
  },
  disallowedTagsMode: "discard",
};

export function sanitizeArticleContent(content: string): string {
  return sanitizeHtmlLib(content, OPTIONS);
}

/**
 * Sanitize a plain-text field (e.g. article title, author name) that must
 * contain no HTML at all.
 *
 * Strips every tag and decodes HTML entities so that a CMS-sourced title like
 * `<script>alert(1)</script>Breaking News` becomes `Breaking News`.
 *
 * Use this wherever a string from an external data source is interpolated into
 * JSX text content without being wrapped in dangerouslySetInnerHTML — JSX
 * auto-escapes the result, so the combined output is safe to render as a
 * React child.
 *
 * @example
 * // In BreakingNewsTicker:
 * const tickerText = breaking.map((a) => `● ${sanitizeText(a.title)}`).join("    ");
 */
export function sanitizeText(input: string): string {
  // allowedTags: [] discards every tag; allowedAttributes: {} discards every
  // attribute.  sanitize-html still decodes HTML entities in the remaining
  // text nodes, so &amp; → &, &lt; → <, &#x27; → ', etc.
  return sanitizeHtmlLib(input, { allowedTags: [], allowedAttributes: {} });
}

/**
 * HTML-encode the five characters that are meaningful in HTML contexts:
 * `&`, `<`, `>`, `"`, `'`.
 *
 * M-2: moved here from app/api/contact/route.ts so app/api/newsletter/route.ts
 * can share the same implementation instead of re-deriving it. Use this
 * wherever a plain-text value (already known to contain no HTML you want to
 * preserve — e.g. a name, an operator-configured environment variable, a
 * free-text form field) is concatenated directly into a raw HTML string
 * (template literal, array-join, etc.) rather than rendered through JSX
 * (which auto-escapes on its own).
 *
 * Originally written for user-submitted contact-form fields, where the
 * input is adversarial. It is equally necessary for operator-configured
 * values like POSTAL_ADDRESS: an address copied from a CRM export can
 * contain `<` or `>` (e.g. "Suite <100>") with no malicious intent at all,
 * and unescaped HTML-special characters there would still produce malformed
 * email markup. Escaping protects against both the adversarial and the
 * purely-accidental case identically.
 *
 * @example
 * const html = `<p>${escapeHtml(operatorSuppliedAddress)}</p>`;
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")   // must be first — other replacements introduce &
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
