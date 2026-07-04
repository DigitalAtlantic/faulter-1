// L-1 fix: prevent accidental client-bundle inclusion.
// safeJsonLd() is only called in Server Components (RSCs); its output is
// embedded via dangerouslySetInnerHTML. Importing server-only ensures a
// build-time error if it ever gets pulled into a Client Component, which
// would allow unsanitized DB-sourced data to reach that call site without
// server-side validation.
import "server-only";

/**
 * Safely serialize an object for use in a JSON-LD <script> tag.
 *
 * JSON.stringify alone is not safe to embed inside a <script> block because:
 *   • </script> inside a string value closes the surrounding <script> element,
 *     allowing an attacker to inject arbitrary HTML.
 *   • <!-- and --> can be used to comment-out surrounding content.
 *   • U+2028 / U+2029 are line-terminator characters that are invalid inside
 *     a JS string literal in some older parsers.
 *
 * We replace all occurrences of the dangerous sub-strings with their Unicode
 * escape equivalents, which are semantically identical inside JSON but cannot
 * break out of the enclosing <script> element.
 *
 * CRIT-9 / MED-8 fix: previously duplicated identically (minus U+2028/U+2029
 * escapes) across app/page.tsx, app/category/[slug]/page.tsx,
 * app/author/[slug]/page.tsx, and app/news/[category]/[slug]/page.tsx.
 * Extracted here so a future change is applied once.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/'/g, "\\u0027")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
