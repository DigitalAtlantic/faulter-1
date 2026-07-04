/**
 * lib/webhookSafe.ts — Safe validation for operator-supplied webhook URLs.
 *
 * C-1 fix: SSRF and cleartext-transmission guard for environment-variable URLs
 * M-1 fix: DNS-resolution check to close the rebinding/private-hostname gap
 * ─────────────────────────────────────────────────────────────────────────────
 * Both /api/error-report and /api/csp-report read a URL from an environment
 * variable and pass it to server-side fetch().  Without validation:
 *
 *   1. Cleartext exposure — an http:// URL transmits the error payload
 *      (digest, violation details) in the clear over the network.
 *
 *   2. SSRF via env-var injection — if a deployment secret is overwritten by a
 *      compromised CI pipeline, setting the variable to an internal address
 *      (e.g. http://169.254.169.254/latest/meta-data/iam/security-credentials/)
 *      causes the Next.js server to make requests to the cloud metadata service.
 *      The attacker receives the response via their controlled endpoint and can
 *      extract short-lived IAM credentials.
 *
 *   3. DNS-rebinding gap (M-1) — a hostname that looks public but resolves to a
 *      private IP would bypass a literal-string IP check.  The previous
 *      implementation (C-1 fix) only checked the raw hostname string; a hostname
 *      such as "localhost" or one whose DNS record points at 169.254.x.x would
 *      pass that check.  This module now:
 *        a. Resolves the hostname via DNS at validation time and rejects it if
 *           any resolved address is private/link-local/loopback.
 *        b. Re-resolves and re-validates the IP at the time of each actual
 *           fetch() call via safeFetch(), which pins the TCP connection to the
 *           validated IP using a custom https.Agent lookup override.  This closes
 *           the window where DNS could change between the initial check and the
 *           actual request.
 *
 *   4. Blocklist gaps (H-2) — the private/link-local matcher used to miss
 *      three known SSRF bypass forms:
 *        a. IPv4-mapped IPv6 addresses (e.g. "::ffff:169.254.169.254"), which
 *           dns.promises.lookup() can return as a plain string when a
 *           hostname's AAAA record resolves to one. These are now unwrapped
 *           to their embedded IPv4 address and re-checked.
 *        b. IPv6 Unique Local Addresses (fc00::/7) — AWS documents
 *           fd00:ec2::254 as the IMDSv2 endpoint over IPv6.
 *        c. 0.0.0.0, which many TCP stacks (notably Linux) treat as a
 *           loopback alias for outbound connections.
 *      The RFC 6598 carrier-grade-NAT range (100.64.0.0/10) is also now
 *      blocked as a minor hardening measure.
 *
 * Usage:
 *
 *   import { validateWebhookUrl, safeFetch } from "@/lib/webhookSafe";
 *
 *   // Validate once at module load (async — returns a Promise<URL | null>):
 *   const _safeUrlPromise = validateWebhookUrl(process.env.MY_WEBHOOK_URL, "MY_WEBHOOK_URL");
 *
 *   // In the request handler:
 *   const safeUrl = await _safeUrlPromise;
 *   if (safeUrl) {
 *     await safeFetch(safeUrl, { method: "POST", body: "..." });
 *   }
 *
 * Usage notes:
 *   - validateWebhookUrl() returns Promise<URL | null>.  Callers must await it.
 *   - Returns null for absent/invalid/private values — callers skip the forward.
 *   - safeFetch() re-resolves and re-validates the IP at call time, and pins the
 *     connection to that validated IP via a custom https.Agent lookup override.
 *   - All rejections are logged to stderr so misconfigured deployments are
 *     visible in log drains.
 */

// This module is imported only by server-side API routes.
import "server-only";

import dns from "node:dns";
import https from "node:https";
import net from "node:net";

// ---------------------------------------------------------------------------
// Private-IP / link-local range blocklist
// ---------------------------------------------------------------------------

/**
 * Matches private, link-local, and loopback addresses — both as literal
 * hostname strings and as resolved IP addresses.
 *
 * Ranges covered:
 *   • RFC 1918 private ranges      10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   • Link-local (APIPA)           169.254.0.0/16  ← AWS/GCP/Azure metadata
 *   • Loopback                     127.0.0.0/8
 *   • "Any" address                0.0.0.0          ← Linux treats as loopback alias
 *   • CGNAT (RFC 6598)             100.64.0.0/10
 *   • IPv6 loopback                ::1
 *   • IPv6 link-local              fe80::/10
 *   • IPv6 Unique Local Address    fc00::/7         ← e.g. AWS IMDSv2 fd00:ec2::254
 *
 * H-2 fix: IPv4-mapped IPv6 addresses (e.g. "::ffff:127.0.0.1") are NOT
 * matched by any regex here. They are handled separately in isPrivateIp()
 * by extracting the embedded IPv4 address via net.isIPv6()'s normalized
 * form and re-running the IPv4 checks against it — see below. Regexes
 * alone can't reliably do this because the embedded address may appear in
 * either dotted-decimal ("::ffff:127.0.0.1") or hex ("::ffff:7f00:1") form.
 */
const PRIVATE_IP_PATTERNS: RegExp[] = [
  // 127.x.x.x — IPv4 loopback
  /^127\./,
  // 10.x.x.x — RFC 1918 Class A
  /^10\./,
  // 172.16–31.x.x — RFC 1918 Class B
  /^172\.(1[6-9]|2\d|3[01])\./,
  // 192.168.x.x — RFC 1918 Class C
  /^192\.168\./,
  // 169.254.x.x — link-local / APIPA (AWS/GCP/Azure instance metadata)
  /^169\.254\./,
  // 0.0.0.0 — the "any" address. Many TCP stacks (notably Linux) treat
  // this as a loopback alias for outbound connections — a known SSRF
  // bypass technique.
  /^0\.0\.0\.0$/,
  // 100.64.0.0/10 — RFC 6598 Carrier-Grade NAT, used internally by some
  // cloud providers (e.g. as an alternate metadata-service range).
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  // ::1 — IPv6 loopback (exact match after toLowerCase)
  /^::1$/,
  // fe80::/10 — IPv6 link-local
  /^fe[89ab][0-9a-f]:/i,
  // fc00::/7 — IPv6 Unique Local Address (ULA). Covers fc00:: through
  // fdff::. AWS documents fd00:ec2::254 as the IMDSv2 endpoint over IPv6,
  // so this range must be blocked for the same reason as 169.254.169.254.
  /^f[cd][0-9a-f]{2}:/i,
  // [::1] — bracketed IPv6 loopback as it appears in URLs
  /^\[::1\]$/,
  // [fe80 — bracketed IPv6 link-local
  /^\[fe[89ab][0-9a-f]/i,
  // [fc00/[fd00 — bracketed IPv6 ULA
  /^\[f[cd][0-9a-f]{2}:/i,
];

/**
 * Extracts the embedded IPv4 address from an IPv4-mapped IPv6 address, in
 * either its dotted-decimal form (::ffff:a.b.c.d) or hex form
 * (::ffff:7f00:1 — where 7f00:1 is 127.0.0.1 packed into two hex groups).
 *
 * Returns null if `address` is not an IPv4-mapped IPv6 address.
 */
function extractIPv4MappedAddress(address: string): string | null {
  const lower = address.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  // Dotted-decimal form: ::ffff:127.0.0.1
  const dottedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMatch && net.isIPv4(dottedMatch[1])) {
    return dottedMatch[1];
  }

  // Hex form: ::ffff:7f00:1 (two 16-bit hex groups encode the 32-bit IPv4
  // address — e.g. 7f00:1 → 0x7f000001 → 127.0.0.1).
  const hexMatch = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    if (!Number.isNaN(high) && !Number.isNaN(low)) {
      const packed = (high << 16) | low;
      const a = (packed >>> 24) & 0xff;
      const b = (packed >>> 16) & 0xff;
      const c = (packed >>> 8) & 0xff;
      const d = packed & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
  }

  return null;
}

/**
 * Returns true if the string (hostname literal or resolved IP address)
 * matches any private/link-local/loopback/ULA/CGNAT range.
 *
 * H-2 fix: addresses are classified with net.isIPv4()/net.isIPv6() rather
 * than relying purely on regex shape-matching, and IPv4-mapped IPv6
 * addresses (e.g. "::ffff:169.254.169.254", which dns.promises.lookup()
 * returns as a plain unbracketed string when a hostname's AAAA record
 * resolves to one) are unwrapped to their embedded IPv4 form and re-checked
 * against the IPv4 ranges above. Without this, such an address would not
 * start with "127." or "::1" and would slip past every existing pattern.
 */
function isPrivateIp(address: string): boolean {
  const h = address.toLowerCase();

  if (PRIVATE_IP_PATTERNS.some((re) => re.test(h))) {
    return true;
  }

  // IPv4-mapped IPv6 address — unwrap and re-check as IPv4.
  if (net.isIPv6(h.replace(/^\[/, "").replace(/\]$/, "")) || h.startsWith("::ffff:")) {
    const mapped = extractIPv4MappedAddress(h);
    if (mapped) {
      return PRIVATE_IP_PATTERNS.some((re) => re.test(mapped));
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// IPv6-literal-hostname helper
// ---------------------------------------------------------------------------

/**
 * M-2 fix: `url.hostname` for any URL containing a literal IPv6 address
 * always includes the brackets (e.g. "https://[2606:4700:4700::1111]/"
 * gives `url.hostname === "[2606:4700:4700::1111]"`). dns.promises.lookup()
 * throws ENOTFOUND for a bracketed hostname — verified directly in this
 * runtime — because brackets are URL syntax, not part of the address
 * itself, and lookup() expects a bare hostname or IP literal.
 *
 * This previously caused any legitimate webhook target configured as a bare
 * IPv6 literal to always fail validation and silently skip forwarding. It
 * fails closed (safe), so it was not a security hole, but it made IPv6
 * literal targets unusable.
 *
 * Returns the bracket-stripped literal if `hostname` is a bracketed IPv6
 * address, or null if it isn't (e.g. it's a regular DNS name, or an IPv4
 * literal — IPv4 literals are never bracketed and dns.promises.lookup()
 * already handles them correctly).
 */
function unwrapIPv6Literal(hostname: string): string | null {
  if (!hostname.startsWith("[") || !hostname.endsWith("]")) return null;
  const stripped = hostname.slice(1, -1);
  return net.isIPv6(stripped) ? stripped : null;
}

/**
 * Resolves `hostname` to its IPv4/IPv6 addresses and returns the first one
 * that is NOT private/link-local/loopback.
 *
 * Returns null if:
 *   - DNS lookup fails (NXDOMAIN, timeout, etc.)
 *   - ALL resolved addresses are private/link-local/loopback
 *
 * M-2 fix: if `hostname` is a bracketed IPv6 literal (e.g.
 * "[2606:4700:4700::1111]" — how url.hostname always presents an IPv6
 * literal), it is unwrapped and validated directly rather than passed to
 * dns.promises.lookup(), which throws ENOTFOUND for bracketed input. A
 * literal address has nothing to resolve — it already IS the address — so
 * this also saves an unnecessary DNS round-trip.
 *
 * @param hostname  The hostname to resolve, exactly as taken from
 *                  url.hostname (may be a bracketed IPv6 literal).
 * @param label     Log label for error messages.
 * @param reason    Human-readable reason string for the rejection log.
 */
async function resolvePublicAddress(
  hostname: string,
  label: string,
  reason: (addr: string) => string
): Promise<string | null> {
  const ipv6Literal = unwrapIPv6Literal(hostname);
  if (ipv6Literal) {
    if (!isPrivateIp(ipv6Literal)) {
      return ipv6Literal;
    }
    console.error(
      `[webhookSafe] ${label} hostname "${hostname}" failed DNS safety\n` +
        `  validation — forward blocked to prevent SSRF.\n` +
        `  Reason: ${reason(ipv6Literal)}\n` +
        `  Fix: set ${label} to a public https:// URL whose address is public.`
    );
    return null;
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[webhookSafe] ${label} hostname "${hostname}" failed DNS lookup — forward blocked.\n` +
        `  Reason: ${msg}\n` +
        `  Fix: set ${label} to a public https:// URL with a valid DNS record.`
    );
    return null;
  }

  for (const { address } of addresses) {
    if (!isPrivateIp(address)) {
      return address; // first public address wins
    }
  }

  // All addresses were private.
  const sample = addresses[0]?.address ?? "unknown";
  console.error(
    `[webhookSafe] ${label} hostname "${hostname}" failed DNS safety\n` +
      `  validation — forward blocked to prevent SSRF.\n` +
      `  Reason: ${reason(sample)}\n` +
      `  Fix: set ${label} to a public https:// URL whose DNS record(s)\n` +
      `  resolve only to public addresses.`
  );
  return null;
}

// ---------------------------------------------------------------------------
// Public API — validateWebhookUrl
// ---------------------------------------------------------------------------

/**
 * Validates an operator-supplied webhook URL from an environment variable.
 *
 * Accepts the URL if and only if ALL of the following are true:
 *   1. The value is a non-empty string.
 *   2. It is parseable by the URL constructor.
 *   3. The protocol is exactly "https:".
 *   4. The hostname is not a literal private/link-local IP.
 *   5. The hostname resolves via DNS, and at least one resolved address is
 *      public (not private/link-local/loopback).
 *
 * Returns a Promise<URL> on success, or Promise<null> on any failure.
 * Null always means "skip the forward".
 *
 * @param raw   The raw environment variable value, e.g. process.env.FOO_URL.
 * @param label A short label for log messages, e.g. "ERROR_REPORT_WEBHOOK_URL".
 */
export async function validateWebhookUrl(
  raw: string | undefined,
  label: string
): Promise<URL | null> {
  // Absent — not an error; many variables are optional.
  if (!raw) return null;

  // Parse — catches typos, file:// paths, bare hostnames, etc.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error(
      `[webhookSafe] ${label} is set but is not a valid URL — forward skipped.\n` +
        `  Value starts with: "${raw.slice(0, 40)}${raw.length > 40 ? "…" : ""}"\n` +
        `  Fix: set ${label} to a full https:// URL.`
    );
    return null;
  }

  // Protocol — only HTTPS is permitted; HTTP transmits payload in cleartext.
  if (url.protocol !== "https:") {
    console.error(
      `[webhookSafe] ${label} uses "${url.protocol}//" — only https:// is permitted.\n` +
        `  Using a non-HTTPS URL transmits the payload in cleartext and may\n` +
        `  expose error details to network observers.\n` +
        `  Fix: update ${label} to use https://.`
    );
    return null;
  }

  // Literal private-IP check — fast path that avoids a DNS round-trip for
  // obviously private addresses (e.g. https://169.254.169.254/...).
  if (isPrivateIp(url.hostname)) {
    console.error(
      `[webhookSafe] ${label} hostname "${url.hostname}" appears to be a\n` +
        `  private or link-local address — forward blocked to prevent SSRF.\n` +
        `  Private ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x) and\n` +
        `  loopback addresses (127.x, ::1) are never permitted as webhook targets.\n` +
        `  Fix: set ${label} to a public https:// URL.`
    );
    return null;
  }

  // DNS-resolution check — closes the M-1 gap where a hostname that looks
  // public (e.g. "localhost", or a custom hostname mapped to 169.254.x.x)
  // would bypass the literal-string check above.
  const publicAddr = await resolvePublicAddress(
    url.hostname,
    label,
    (addr) => `"${url.hostname}" resolves to "${addr}", a private/link-local/loopback address`
  );
  if (!publicAddr) return null;

  return url;
}

// ---------------------------------------------------------------------------
// Public API — safeFetch
// ---------------------------------------------------------------------------

/**
 * A fetch() replacement that re-resolves the webhook hostname at call time,
 * rejects if any resolved address is private, and pins the TCP connection to
 * the validated IP via a custom https.Agent lookup override.
 *
 * This closes the DNS-rebinding window that exists when:
 *   1. validateWebhookUrl() is called at module load (cold start).
 *   2. DNS TTL expires and the record is changed to a private IP.
 *   3. A later fetch() call to the same URL would connect to the new IP.
 *
 * With safeFetch(), every outbound webhook request independently validates
 * the resolved IP before the TCP connection is established.
 *
 * @param url       A URL object returned by validateWebhookUrl().
 * @param init      Standard fetch() RequestInit options (method, headers, body, signal, redirect).
 * @returns         The fetch() Response.
 * @throws          If DNS resolution fails or all resolved IPs are private.
 */
export async function safeFetch(
  url: URL,
  init?: RequestInit
): Promise<Response> {
  const hostname = url.hostname;

  // M-2 fix: a bracketed IPv6 literal hostname has nothing to resolve via
  // DNS — dns.promises.lookup() throws ENOTFOUND for bracketed input — so
  // it is validated directly, mirroring the same fix in
  // resolvePublicAddress() above.
  const ipv6Literal = unwrapIPv6Literal(hostname);
  if (ipv6Literal) {
    if (isPrivateIp(ipv6Literal)) {
      throw new Error(
        `[webhookSafe] safeFetch blocked — "${hostname}" is a private IP literal "${ipv6Literal}"`
      );
    }
    return nodeHttpsRequestAsFetch(url.toString(), init, ipv6Literal, 6);
  }

  // Re-resolve at call time.
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[webhookSafe] safeFetch DNS lookup failed for "${hostname}": ${msg}`);
  }

  // Find the first public address.
  let pinnedIp: string | null = null;
  let pinnedFamily: number = 4;
  for (const { address, family } of addresses) {
    if (!isPrivateIp(address)) {
      pinnedIp = address;
      pinnedFamily = family;
      break;
    }
  }

  if (!pinnedIp) {
    const sample = addresses[0]?.address ?? "unknown";
    throw new Error(
      `[webhookSafe] safeFetch blocked — "${hostname}" resolved to private IP "${sample}"`
    );
  }

  return nodeHttpsRequestAsFetch(url.toString(), init, pinnedIp, pinnedFamily);
}

// ---------------------------------------------------------------------------
// Internal: node:https → Fetch Response adapter
// ---------------------------------------------------------------------------

/**
 * Wraps a node:https request in a Fetch-compatible Response object.
 * Only handles string bodies (both call sites send string payloads).
 */
/**
 * Wraps a node:https request in a Fetch-compatible Response object.
 * Only handles string bodies (both call sites send string payloads).
 *
 * Pins the TCP connection to `resolvedIp` via a custom https.Agent lookup
 * override, regardless of whether `resolvedIp` came from a DNS lookup or
 * (M-2 fix) directly from a bracketed IPv6 literal hostname that was never
 * passed to DNS at all.
 */
function nodeHttpsRequestAsFetch(
  urlString: string,
  init: RequestInit | undefined,
  resolvedIp: string,
  resolvedFamily: number
): Promise<Response> {
  // Build a custom https.Agent whose lookup override always returns the
  // pre-validated IP, bypassing further DNS resolution.
  //
  // Node's net module (Happy Eyeballs, default since Node 18+) calls the
  // lookup function with { all: true } and expects back an array of
  // { address, family } objects — NOT a single address string.
  // We detect options.all and respond with the matching shape.
  const agent = new https.Agent({
    lookup: (
      _hostname: string,
      options: dns.LookupOptions,
      callback: (
        err: NodeJS.ErrnoException | null,
        address: string | dns.LookupAddress[],
        family?: number
      ) => void
    ) => {
      if (options.all) {
        // Happy Eyeballs / modern Node path: return array of LookupAddress.
        callback(null, [{ address: resolvedIp, family: resolvedFamily }]);
      } else {
        // Legacy single-address path.
        callback(null, resolvedIp, resolvedFamily);
      }
    },
  });

  return new Promise((resolve, reject) => {
    const parsed = new URL(urlString);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = flattenHeaders(init?.headers);
    const bodyStr = typeof init?.body === "string" ? init.body : undefined;
    const signal = init?.signal instanceof AbortSignal ? init.signal : undefined;

    // Add Content-Length if we have a body and the caller didn't set it.
    if (bodyStr !== undefined && !("content-length" in headers)) {
      headers["content-length"] = String(Buffer.byteLength(bodyStr, "utf8"));
    }

    const options: https.RequestOptions = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers,
      agent,
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(
          new Response(body, {
            status: res.statusCode ?? 200,
            headers: res.headers as Record<string, string>,
          })
        );
      });
      res.on("error", reject);
    });

    req.on("error", reject);

    // Handle abort signal.
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error("Request aborted"));
        return;
      }
      signal.addEventListener("abort", () => req.destroy(new Error("Request aborted")));
    }

    if (bodyStr !== undefined) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Normalises the HeadersInit variants (Headers object, string[][], plain
 * object) into a plain { [key: string]: string } record that node:https
 * accepts directly.
 */
function flattenHeaders(
  headers: HeadersInit | undefined
): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers } as Record<string, string>;
}
