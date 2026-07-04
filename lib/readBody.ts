// Used only from Node.js API route handlers — never imported into a Client
// Component bundle.
import "server-only";

/**
 * lib/readBody.ts — Streaming body-size guard (M-2 fix).
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────
 * /api/contact, /api/newsletter, /api/csp-report, and /api/error-report each
 * enforce a hard byte cap (12 KB / 12 KB / 16 KB / 4 KB) on the request body,
 * correctly because Content-Length is client-supplied and forgeable — an
 * attacker can omit it, or set it to 0, while streaming an arbitrarily large
 * body over chunked transfer-encoding.
 *
 * The previous implementation in all four routes read the body with
 * `await request.text()` and measured the byte length of the result
 * AFTERWARDS. `request.text()` has no concept of a caller-supplied limit: it
 * always buffers the ENTIRE body into memory before resolving, regardless of
 * how large that body turns out to be. The byte-length check that followed
 * was real, but it ran too late — after the costly allocation, not instead
 * of it.
 *
 * On Vercel this is bounded by the platform's own request-size ceiling
 * (~4.5 MB), so the worst case is small. This app's own documentation
 * (see README.md → "Reverse-Proxy Body Size Limits") also covers self-hosted
 * deployment behind nginx, Caddy, Fly.io, Railway, or a bare VPS, none of
 * which impose a body-size ceiling unless the operator configures one at the
 * reverse-proxy layer. On those deployments, a client that streams a
 * multi-hundred-MB (or larger) body via `Transfer-Encoding: chunked` forces
 * the full body to be buffered in the Node process before any of the
 * 4 KB–16 KB checks gets a chance to reject it — a cheap memory-exhaustion
 * vector against any of the four routes above.
 *
 * ── THE FIX ──────────────────────────────────────────────────────────────────
 * readBodyWithLimit() reads `request.body` (a Web ReadableStream<Uint8Array>)
 * directly, counting bytes as each chunk arrives, and aborts — cancelling the
 * stream and returning immediately — the moment the running total exceeds
 * `maxBytes`. The body is never assembled past the configured cap, so
 * worst-case memory use for a single request is bounded by maxBytes (plus
 * the one chunk already in flight when the cap is crossed) instead of by
 * however much the client chooses to send.
 *
 * This still does not replace a reverse-proxy-level cap for self-hosted
 * deployments — many small concurrent oversized requests can still add up
 * across connections even when each one is individually capped in-process —
 * but it closes the per-request amplification gap that `request.text()`
 * left open. See README.md for the required nginx/Caddy configuration.
 */

export type ReadBodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" }
  | { ok: false; reason: "read_error" };

/**
 * Read `request`'s body as text, enforcing `maxBytes` while reading rather
 * than after the fact.
 *
 * Returns `{ ok: false, reason: "too_large" }` as soon as the running byte
 * total crosses `maxBytes` — without finishing the read — so an oversized
 * body is never fully buffered.
 *
 * Returns `{ ok: false, reason: "read_error" }` if the stream errors before
 * completing (e.g. the client disconnects mid-upload).
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<ReadBodyResult> {
  const body = request.body;

  // No readable body stream (e.g. a request whose body was already consumed,
  // or a runtime that doesn't expose one). Fall back to text() — there is no
  // stream left to police a limit against either way, so this is no worse
  // than the previous behaviour for that edge case.
  if (!body) {
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        return { ok: false, reason: "too_large" };
      }
      return { ok: true, text };
    } catch {
      return { ok: false, reason: "read_error" };
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;

      if (total > maxBytes) {
        // Cap exceeded — stop reading immediately. cancel() releases the
        // underlying connection; it is intentionally not awaited so the 413
        // response isn't held up by stream teardown.
        reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }

      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read_error" };
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(combined) };
}
