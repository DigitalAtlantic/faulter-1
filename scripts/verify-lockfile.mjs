#!/usr/bin/env node
/**
 * scripts/verify-lockfile.mjs
 *
 * CRIT-1 fix: Supply-chain integrity guard.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * package-lock.json contains an `integrity` field (SHA-512 hash) for every
 * resolved package.  `npm ci` verifies these hashes before installation —
 * if any installed tarball does not match the recorded hash, the install
 * aborts.  This is the primary mechanism that prevents a compromised or
 * substituted npm package from silently entering the build.
 *
 * If any package has an empty `"integrity": ""` in the lockfile, `npm ci`
 * skips hash verification for that package and installs it blindly.  The
 * Next.js SWC compiler binaries are native code; a tampered binary that
 * passes an empty-integrity check can execute arbitrary code during build.
 *
 * ── How the lockfile got empty hashes ──────────────────────────────────────
 * The lockfile was generated when `package.json` specified `"next": "15.5.19"`,
 * a version that does not exist on the public npm registry.  When npm cannot
 * resolve an exact version, it may record the nearest resolved version but
 * leave the integrity field empty because no canonical tarball was fetched
 * from a verified registry source.
 *
 * ── Fix ────────────────────────────────────────────────────────────────────
 * This script reads package-lock.json and fails with exit code 1 if any
 * package entry has an empty or absent `integrity` field.
 *
 * To generate a clean lockfile (required before running npm ci in production):
 *
 *   1. Ensure package.json specifies real, published version strings for all
 *      dependencies (no fabricated versions like "15.5.19").
 *   2. Delete package-lock.json
 *   3. Run:  npm install
 *   4. Verify all integrity hashes are non-empty:  node scripts/verify-lockfile.mjs
 *   5. Commit the regenerated package-lock.json
 *
 * ── CI usage ───────────────────────────────────────────────────────────────
 * This script runs as part of the `prebuild` hook (see package.json).
 * A failing exit code aborts `npm run build` before any Next.js compilation
 * begins — a compromised or unverifiable package never reaches the build step.
 *
 * In CI, always use `npm ci` (not `npm install`) after regenerating the
 * lockfile.  `npm ci` enforces the lockfile exactly and verifies all
 * integrity hashes.  `npm install` may silently update the lockfile.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lockfilePath = resolve(__dirname, "..", "package-lock.json");

// ── Load lockfile ────────────────────────────────────────────────────────────
let lockfile;
try {
  lockfile = JSON.parse(readFileSync(lockfilePath, "utf8"));
} catch (err) {
  console.error(`\n❌  verify-lockfile.mjs: failed to read package-lock.json\n`);
  console.error(`  ${err.message}\n`);
  process.exit(1);
}

const packages = lockfile.packages ?? {};

// ── Collect packages with empty or missing integrity hashes ─────────────────
const emptyIntegrity = [];

for (const [pkgPath, pkgData] of Object.entries(packages)) {
  // Skip the root package entry ("") — it has no integrity field by design.
  if (pkgPath === "") continue;

  // Skip optional platform-specific binaries for platforms that are not the
  // current build host — npm sets optional=true and may omit integrity for
  // packages it did not install on this architecture.  We still check them
  // because all platforms should have valid hashes in a correctly generated
  // lockfile; a correctly generated lockfile records hashes for all resolved
  // packages regardless of optionality.
  const integrity = pkgData.integrity ?? "";

  if (typeof integrity !== "string" || integrity.trim() === "") {
    emptyIntegrity.push(pkgPath);
  }
}

// ── Report results ───────────────────────────────────────────────────────────
if (emptyIntegrity.length === 0) {
  console.log(
    `✅  verify-lockfile: all ${Object.keys(packages).length - 1} packages ` +
    `have non-empty integrity hashes — supply chain verification is active.`
  );
  process.exit(0);
}

// ── Fail: empty integrity hashes found ───────────────────────────────────────
console.error(`\n❌  Build blocked by verify-lockfile.mjs — supply chain integrity failure\n`);
console.error(
  `  The following ${emptyIntegrity.length} package(s) have empty integrity ` +
  `hashes in package-lock.json:\n`
);
for (const pkg of emptyIntegrity) {
  console.error(`    • ${pkg}`);
}
console.error(
  `\n` +
  `  An empty integrity hash means npm ci will install these packages WITHOUT\n` +
  `  verifying them against a known-good SHA-512 hash.  If the npm registry\n` +
  `  entry for any of these packages is compromised (package substitution\n` +
  `  attack), the tampered package will be installed and trusted blindly.\n` +
  `\n` +
  `  The Next.js SWC compiler binaries are native code.  A tampered binary\n` +
  `  can execute arbitrary code during build.\n` +
  `\n` +
  `  ── How to fix ──────────────────────────────────────────────────────────\n` +
  `\n` +
  `  1. Confirm package.json specifies only real, published versions:\n` +
  `\n` +
  `       "next": "15.3.3"                ← must match a published npm tag\n` +
  `       "eslint-config-next": "15.3.3"  ← same\n` +
  `\n` +
  `     Do not use fabricated version strings (e.g. "15.5.19").  npm records\n` +
  `     empty integrity when it cannot fetch a canonical tarball for the\n` +
  `     requested version.\n` +
  `\n` +
  `  2. Regenerate the lockfile on a machine with public npm registry access:\n` +
  `\n` +
  `       rm package-lock.json\n` +
  `       npm install\n` +
  `\n` +
  `  3. Verify all hashes are populated:\n` +
  `\n` +
  `       node scripts/verify-lockfile.mjs\n` +
  `\n` +
  `  4. Commit the regenerated package-lock.json.\n` +
  `\n` +
  `  5. In CI, always use "npm ci" (not "npm install") — it enforces the\n` +
  `     lockfile exactly and verifies all integrity hashes.\n`
);
process.exit(1);
