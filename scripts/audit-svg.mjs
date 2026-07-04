#!/usr/bin/env node
/**
 * scripts/audit-svg.mjs
 *
 * H-4 fix: Pre-build SVG safety audit.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * next.config.mjs has `dangerouslyAllowSVG: true` so that next/image can
 * serve the SVG placeholders in public/article-images/ and public/avatars/.
 * This flag is safe ONLY while every SVG in public/ is a committed, trusted,
 * build-time asset — no user-supplied content, no CMS-written files.
 *
 * SVG is XML-based and supports inline JavaScript via:
 *   • <script> elements
 *   • on* event-handler attributes (onclick, onload, onmouseover, …)
 *   • javascript: URIs in href / xlink:href
 *   • <animate> with values that trigger script execution
 *   • <foreignObject> which can embed arbitrary HTML including <script>
 *
 * If a malicious or accidentally-crafted SVG ever lands in public/ (e.g.
 * via a CMS integration, a misconfigured upload endpoint, or an npm
 * postinstall script), next/image would serve it with
 * Content-Type: image/svg+xml and the browser would execute any embedded
 * JavaScript in the context of the site's origin — a stored-XSS vulnerability
 * that bypasses the CSP entirely (script-src 'unsafe-inline' does not stop
 * inline script execution, regardless of which origin served the markup).
 *
 * ── What this script does ──────────────────────────────────────────────────
 * 1. Walks public/ recursively and collects all .svg files.
 * 2. For each SVG, checks the raw text for the patterns listed above.
 * 3. Prints a clear report of every dangerous pattern found, with file path
 *    and the offending line.
 * 4. Exits with code 1 if any issues are found, which fails `npm run build`
 *    when this script is run as a prebuild step.
 *
 * ── How to run ─────────────────────────────────────────────────────────────
 * Automatically: `npm run build` triggers `npm run prebuild` first (Node.js
 * convention — any script named `pre<X>` runs before `<X>`).
 * Manually:      `node scripts/audit-svg.mjs`
 *
 * ── Patterns detected ─────────────────────────────────────────────────────
 * The patterns below are intentionally broad — false positives (e.g. a
 * comment mentioning "onclick") are preferable to false negatives (missing
 * an actual attack vector).  If a legitimate SVG triggers a false positive,
 * add it to ALLOWLIST below with a justification comment.
 *
 * ── Allowlist ─────────────────────────────────────────────────────────────
 * Files in ALLOWLIST are skipped entirely.  Only add files here when you
 * have manually verified their content is safe.  Prefer fixing the SVG
 * instead.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC_DIR = join(ROOT, "public");

// ---------------------------------------------------------------------------
// Allowlist — files exempted from scanning (must include justification).
// Paths are relative to the project root.
// ---------------------------------------------------------------------------
const ALLOWLIST = new Set([
  // "public/some-known-safe.svg",  // <reason>
]);

// ---------------------------------------------------------------------------
// Dangerous patterns
// ---------------------------------------------------------------------------
const PATTERNS = [
  {
    // Inline <script> elements — the most direct XSS vector in SVG.
    regex: /<script[\s>]/i,
    label: "<script> element",
  },
  {
    // javascript: URI in href or xlink:href — executes JS when the element
    // is activated (clicked, focused, etc.).
    regex: /\bhref\s*=\s*["']?\s*javascript\s*:/i,
    label: "javascript: URI in href",
  },
  {
    // on* event-handler attributes — SVG elements support the full set of
    // HTML event handlers including onload, onclick, onmouseover, etc.
    // The \b word boundary prevents matching attribute names like "font"
    // that happen to contain "on".
    regex: /\bon[a-z]+\s*=/i,
    label: "on* event-handler attribute",
  },
  {
    // <foreignObject> — allows embedding arbitrary HTML (including <script>)
    // inside an SVG.  Legitimate use cases exist but are rare in static image
    // assets; flag for manual review.
    regex: /<foreignObject[\s>]/i,
    label: "<foreignObject> element (can embed arbitrary HTML)",
  },
  {
    // <animate> / <animateTransform> / <set> with a values attribute that
    // could be crafted to trigger script execution in older renderers.
    // Flagged conservatively — legitimate CSS animations don't use these.
    regex: /<animate\b[^>]*\bvalues\s*=/i,
    label: "<animate values=…> (verify no script-triggering value)",
  },
];

// ---------------------------------------------------------------------------
// Walk public/ recursively and collect SVG files
// ---------------------------------------------------------------------------
function walkSvgs(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkSvgs(full));
    } else if (entry.toLowerCase().endsWith(".svg")) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Scan a single SVG file; return array of findings
// ---------------------------------------------------------------------------
function scanSvg(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const findings = [];

  for (const { regex, label } of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        findings.push({
          label,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 120),
        });
        break; // one finding per pattern per file is enough
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const svgFiles = walkSvgs(PUBLIC_DIR);
let totalIssues = 0;
const fileFindings = [];

for (const filePath of svgFiles) {
  const relPath = relative(ROOT, filePath);
  if (ALLOWLIST.has(relPath)) continue;

  const findings = scanSvg(filePath);
  if (findings.length > 0) {
    totalIssues += findings.length;
    fileFindings.push({ relPath, findings });
  }
}

if (fileFindings.length === 0) {
  console.log(`✅  SVG audit passed — ${svgFiles.length} file(s) scanned, no issues found.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Report and fail
// ---------------------------------------------------------------------------
console.error(`\n❌  SVG audit FAILED — dangerous patterns found in ${fileFindings.length} file(s).\n`);
console.error(
  "    dangerouslyAllowSVG: true is set in next.config.mjs.  Any SVG in\n" +
  "    public/ that contains inline JavaScript will execute in the browser\n" +
  "    with full same-origin access, bypassing the CSP.\n"
);

for (const { relPath, findings } of fileFindings) {
  console.error(`  📄 ${relPath}`);
  for (const { label, line, snippet } of findings) {
    console.error(`     Line ${line}: ${label}`);
    console.error(`     ${snippet}`);
  }
  console.error("");
}

console.error(`  Total issues: ${totalIssues}`);
console.error(
  "\n  To fix: remove or sanitize the flagged patterns from the SVG files.\n" +
  "  If a file is a known-safe false positive, add it to the ALLOWLIST in\n" +
  "  scripts/audit-svg.mjs with a justification comment.\n" +
  "  Do NOT set dangerouslyAllowSVG: false as a workaround — this breaks\n" +
  "  serving all SVG assets.  Fix the SVG content instead.\n"
);

process.exit(1);
