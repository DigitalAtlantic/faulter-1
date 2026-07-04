/**
 * Shared search constants — no `import "server-only"` so this file is safe
 * to import in both Server Components and Client Components.
 *
 * MAX_QUERY_LENGTH was previously inlined in lib/articles.ts (server-only).
 * Extracting it here allows the client-side <SearchResults> component and
 * the /api/search route to share the same cap without importing the full
 * server-only articles module.
 *
 * lib/articles.ts re-exports MAX_QUERY_LENGTH from here so all existing
 * import sites (app/search/page.tsx etc.) continue to work unchanged.
 */

/** Hard cap on search query length — enforced before any regex/DB operation. */
export const MAX_QUERY_LENGTH = 150;
