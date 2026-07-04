/**
 * scripts/create-indexes.ts
 *
 * One-time database setup script.  Run this after provisioning your MongoDB
 * database and before going live.
 *
 * It is idempotent — safe to re-run; creating an index that already exists
 * is a no-op in MongoDB, and re-applying a validator via collMod is a no-op
 * when the schema is unchanged.
 *
 * Indexes created:
 *   • subscribers.email           unique + case-insensitive (DB-2)
 *   • articles (text)             full-text search index (DB-1)
 *   • contact_submissions.createdAt  TTL 90 days (DB-3, GDPR Art. 5(1)(e))
 *
 * Collection validators applied (D-3):
 *   • subscribers         — email (required string), createdAt (required date)
 *   • contact_submissions — name, email, message (required strings),
 *                           createdAt (required date; load-bearing for TTL)
 *
 * DATABASE_URL must be available in the environment before running.
 * `tsx` does NOT auto-load .env.local — use one of the approaches below:
 *
 *   Option A — npm script (recommended, reads .env.local automatically):
 *     npm run create-indexes
 *
 *   Option B — pass the env file explicitly via Node.js flags:
 *     tsx --conditions=react-server --env-file-if-exists=.env.local scripts/create-indexes.ts
 *     (--conditions=react-server is required so the "server-only" import in
 *     lib/db.ts/lib/env.ts resolves to its no-op export instead of throwing;
 *     Next.js's bundler applies this same resolution for real server code.)
 *
 *   Option C — export the variable in your shell first:
 *     export DATABASE_URL="mongodb+srv://user:pass@cluster.mongodb.net/faulter"
 *     tsx scripts/create-indexes.ts
 */

import { createIndexes, createCollectionValidators } from "../lib/db";

async function main() {
  console.log("[create-indexes] Starting database setup…");
  try {
    // Step 1: create all required indexes (idempotent).
    await createIndexes();

    // Step 2: apply JSON Schema validators to collections (D-3 fix).
    // Validators enforce required fields and correct BSON types at the
    // database layer so writes with missing or incorrectly typed fields are
    // rejected before reaching application code.
    //
    // This must run AFTER createIndexes() because the TTL index on
    // contact_submissions.createdAt is only meaningful when the validator
    // guarantees createdAt is a BSON Date (not a string).
    await createCollectionValidators();

    console.log("[create-indexes] Done. All indexes and validators are in place.");
    console.log("");
    console.log("── MED-3: Verify validators are active on the Atlas cluster ──────────────");
    console.log("Run the following in mongosh against your Atlas cluster to confirm");
    console.log("the JSON Schema validator was applied to contact_submissions:");
    console.log("");
    console.log("  db.getCollectionInfos({ name: \"contact_submissions\" })");
    console.log("    .map(c => JSON.stringify(c.options?.validator, null, 2))");
    console.log("");
    console.log("Expected output: a $jsonSchema object with required: [\"name\", \"email\",");
    console.log("\"message\", \"createdAt\"] and bsonType constraints on each field.");
    console.log("If the output is null or {}, the validator was not applied —");
    console.log("re-run this script against the correct Atlas cluster.");
    console.log("─────────────────────────────────────────────────────────────────────────");
    process.exit(0);
  } catch (err) {
    console.error(
      "[create-indexes] Failed:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }
}

main();
