/**
 * lib/db.ts — MongoDB connection helper.
 *
 * ─── DB-4: Connection-string credential protection ──────────────────────────
 * The DATABASE_URL value looks like:
 *   mongodb+srv://username:password@cluster.mongodb.net/dbname?...
 *
 * If this string ever reaches a logger — via an uncaught exception, a
 * Next.js error overlay, a Sentry breadcrumb, or console.error() — the
 * credentials are exposed in plain text in log aggregators, error dashboards,
 * and anywhere logs are shipped.
 *
 * This module is the ONLY place in the codebase that reads DATABASE_URL.
 * It:
 *   1. Strips credentials out of the URI before any logging occurs.
 *   2. Never re-exports the raw connection string.
 *   3. Uses a global-cached singleton promise so the connection is reused
 *      across requests on both long-running servers (VPS / Docker) and
 *      serverless warm-function reuse (Vercel / Netlify / Lambda).
 *
 * Usage:
 *   import { getDb } from "@/lib/db";
 *   const db = await getDb();
 *   await db.collection("subscribers").insertOne({ email, createdAt: new Date() });
 * ────────────────────────────────────────────────────────────────────────────
 */

// Prevent this module from being imported in Client Components.
// lib/db.ts manages the MongoDB connection and reads DATABASE_URL — both
// must never reach the browser bundle.
import "server-only";

import { MongoClient, Db } from "mongodb";
import { validateEnvEagerly } from "@/lib/env";

// ---------------------------------------------------------------------------
// Credential-safe URI helpers
// ---------------------------------------------------------------------------

/**
 * Strips the username and password from a MongoDB connection string so it is
 * safe to include in log output.
 *
 * Input:  mongodb+srv://alice:s3cr3t@cluster.mongodb.net/db
 * Output: mongodb+srv://***:***@cluster.mongodb.net/db
 *
 * Falls back to returning "[unparseable URI]" rather than throwing, so a
 * malformed DATABASE_URL never causes a secondary crash inside an error
 * handler.
 */
export function redactMongoUri(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    // URL constructor throws on mongodb+srv:// in some Node versions < 18.
    // Fall back to a regex-based redaction that handles both mongodb:// and
    // mongodb+srv:// without requiring full URL parsing.
    return uri.replace(
      /^(mongodb(?:\+srv)?:\/\/)([^:@/]+)(?::([^@/]+))?@/,
      "$1***:***@"
    );
  }
}

/**
 * Returns DATABASE_URL, throwing a descriptive Error if it is absent or if
 * the URI is missing a database name in the path component.
 *
 * D-1 fix: database name guard
 * ────────────────────────────
 * Atlas URIs copy-pasted from the dashboard often look like:
 *   mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true
 *
 * When the path is empty or bare "/", MongoClient.db() with no argument
 * silently connects to MongoDB's default database ("test"), so every write
 * goes to the wrong database.  This is caught at startup rather than being
 * discovered after data loss.
 *
 * The path component must be at least "/dbname" — the check below rejects
 * "" and "/" and requires at least one non-slash character after the slash.
 *
 * The raw value is NEVER logged — callers that need to log the URI must
 * use redactMongoUri() first.
 */
function getConnectionString(): string {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    throw new Error(
      "DATABASE_URL is not set.\n" +
        "Add it to .env.local (development) or your deployment secrets.\n" +
        "Example: DATABASE_URL=mongodb+srv://user:pass@cluster.mongodb.net/faulter"
    );
  }

  // D-1: Verify a database name is present in the URI path.
  // new URL() handles both mongodb:// and mongodb+srv:// in Node 18+.
  // If parsing fails (malformed URI) we let MongoClient surface its own error
  // rather than crashing here with a misleading message.
  try {
    const parsed = new URL(uri);
    if (!parsed.pathname || parsed.pathname === "/") {
      throw new Error(
        "DATABASE_URL is missing a database name in the path.\n" +
          "Add the database name after the host:\n" +
          "  mongodb+srv://user:pass@cluster.mongodb.net/faulter\n" +
          "Without it, writes silently go to MongoDB's default 'test' database."
      );
    }
  } catch (err) {
    // Re-throw our own explicit error unchanged; suppress URL parse failures.
    if (err instanceof Error && err.message.startsWith("DATABASE_URL is missing")) {
      throw err;
    }
  }

  return uri;
}

// ---------------------------------------------------------------------------
// Connection singleton — global-cached so it survives serverless warm reuse
// ---------------------------------------------------------------------------

/**
 * Attach the promise to globalThis so it persists across module re-evaluations
 * in serverless warm-function reuse (Vercel / Netlify / Lambda).
 *
 * On a long-running Node.js server (VPS, Docker) the module is evaluated once
 * and the promise is reused naturally, so this has no additional cost.
 *
 * The type cast is required because TypeScript does not know about our custom
 * property on globalThis.
 */
type GlobalWithMongo = typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
  /** Set to true once the startup index health-check has fired. */
  _indexCheckFired?: boolean;
};

const g = globalThis as GlobalWithMongo;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a connected Db instance, reusing the existing connection if one
 * is already established.
 *
 * All connection errors are caught here and re-thrown with the credentials
 * stripped from the error message before it can propagate to a logger.
 *
 * @param dbName - Database name to use. Defaults to the database in the URI,
 *                 which for an Atlas URI is the path component after the host.
 * @param options.skipIndexCheck - Internal use only. When true, bypasses the
 *                 checkRequiredIndexes() startup guard for this call. Used
 *                 exclusively by createIndexes()/createCollectionValidators()
 *                 so the setup script can obtain a connection on a freshly
 *                 provisioned database — one that by definition has no
 *                 indexes yet — without tripping the very check it exists to
 *                 satisfy. It does NOT set the shared _indexCheckFired flag,
 *                 so normal application traffic on the same warm instance
 *                 (or any subsequent non-skip call) still runs the real check
 *                 exactly as before. See H-1.
 */
export async function getDb(
  dbName?: string,
  options?: { skipIndexCheck?: boolean }
): Promise<Db> {
  if (!g._mongoClientPromise) {
    const uri = getConnectionString(); // read once; never call again in this scope
    const safeUri = redactMongoUri(uri); // pre-compute for catch block — no second read

    // M-2 fix: Atlas IP allowlist startup reminder.
    //
    // This is an infrastructure requirement that cannot be enforced from code —
    // we cannot query the Atlas control plane to verify the allowlist.  The log
    // line below fires once per cold start so it is visible in deployment logs,
    // making it impossible to overlook during initial setup and post-deploy checks.
    //
    // WHY THIS MATTERS:
    //   If the MongoDB Atlas cluster's IP allowlist is set to 0.0.0.0/0 (allow
    //   all), any actor with a valid DATABASE_URL connection string can connect
    //   directly to the cluster and perform arbitrary reads and writes, bypassing
    //   all application-layer controls: rate limiting, CSRF, authentication, etc.
    //   DATABASE_URL contains plaintext credentials.  A leak via a CI log, an
    //   unredacted error message that escapes the scrubber in lib/env.ts, or a
    //   .env file accidentally committed to a public repo gives an attacker
    //   direct database access.
    //
    // REQUIRED ACTION (verify before launch):
    //   In MongoDB Atlas → Network Access → IP Access List:
    //     • Vercel: add Vercel's published egress IP ranges.
    //       See: https://vercel.com/guides/how-to-allowlist-deployment-ip-address
    //     • Cloudflare Workers/Pages: restrict to Cloudflare IP ranges.
    //       See: https://www.cloudflare.com/ips/
    //     • Self-hosted / VPS: add only the static IP(s) of your server(s).
    //     • Never leave 0.0.0.0/0 in the list on a production cluster.
    // CRIT-2 fix: hard-block the MongoDB connection in production until the
    // operator explicitly acknowledges that the Atlas IP allowlist has been
    // restricted.
    //
    // WHY THIS IS A THROW, NOT A CONSOLE.ERROR:
    // ──────────────────────────────────────────
    // The previous implementation logged an error and then opened the
    // connection anyway. That means an unrestricted Atlas cluster (0.0.0.0/0)
    // would serve production traffic — with every DB write, subscriber record,
    // and contact submission accessible to anyone holding DATABASE_URL — while
    // the log warning was easy to miss or dismiss as informational.
    //
    // An unrestricted Atlas IP allowlist is an unconditional hard blocker
    // regardless of how correct the application code is. If DATABASE_URL
    // leaks (CI log, unredacted error, accidentally committed .env), an
    // attacker can connect directly to the cluster and bypass ALL application
    // controls: rate limiting, CSRF, authentication, input validation, TTL
    // indexes, audit logging — none of it matters if the attacker has a direct
    // MongoDB shell. Throwing here converts that silent misconfiguration into
    // an immediate, visible startup failure that cannot be ignored.
    //
    // WHAT THE OPERATOR MUST DO:
    //   1. In MongoDB Atlas → Network Access → IP Access List:
    //      • Vercel:       add Vercel's published egress IP ranges.
    //                      See: https://vercel.com/guides/how-to-allowlist-deployment-ip-address
    //      • Self-hosted:  add only the static IP(s) of your server(s).
    //      • NEVER leave 0.0.0.0/0 in the list on a production cluster.
    //   2. Verify the allowlist is live in the Atlas UI (Network Access tab).
    //   3. ONLY THEN set ATLAS_IP_RESTRICTED=true in your deployment environment.
    //
    // ATLAS_IP_RESTRICTED is a deliberate acknowledgement token, not a magic
    // fix. Setting it without actually restricting the allowlist defeats the
    // entire purpose of this guard and exposes the database to the same risk.
    //
    // NEXT_PHASE guard: suppressed during `next build` (secrets are injected
    // at deploy time, not build time) so the build step is not blocked when
    // running in CI without deployment environment variables present.
    if (
      process.env.NODE_ENV === "production" &&
      process.env.NEXT_PHASE !== "phase-production-build" &&
      process.env.ATLAS_IP_RESTRICTED !== "true"
    ) {
      throw new Error(
        "[db] STARTUP BLOCKED — ATLAS_IP_RESTRICTED is not set.\n" +
        "\n" +
        "  MongoDB connection refused in production until you confirm that the\n" +
        "  Atlas IP allowlist is restricted to your deployment's egress IPs.\n" +
        "\n" +
        `  Attempted connection to: ${safeUri}\n` +
        "\n" +
        "  An unrestricted allowlist (0.0.0.0/0) means any actor with DATABASE_URL\n" +
        "  can connect directly to the cluster and bypass ALL application controls:\n" +
        "  rate limiting, CSRF protection, input validation, audit logging.\n" +
        "\n" +
        "  Required steps before setting ATLAS_IP_RESTRICTED=true:\n" +
        "    1. Atlas → Network Access → IP Access List\n" +
        "    2. Remove 0.0.0.0/0 from the allowlist.\n" +
        "    3. Add only your deployment's egress IPs:\n" +
        "         Vercel:  https://vercel.com/guides/how-to-allowlist-deployment-ip-address\n" +
        "         VPS/Docker: the static IP(s) of your server(s).\n" +
        "    4. Verify the restriction is live in the Atlas UI (Network Access tab).\n" +
        "    5. Set ATLAS_IP_RESTRICTED=true in your deployment environment variables.\n" +
        "    6. Redeploy.\n" +
        "\n" +
        "  ⚠️  Set ATLAS_IP_RESTRICTED=true ONLY after completing all steps above.\n" +
        "  Setting it without restricting the allowlist gives false confidence and\n" +
        "  leaves the database fully exposed."
      );
    }

    // MongoClient.connect() is used rather than new MongoClient() + .connect()
    // because it returns a promise that can be shared and awaited multiple
    // times without re-opening the connection.
    g._mongoClientPromise = MongoClient.connect(uri, {
      // L-3 fix: read pool size from env so it can be tuned per deployment without a code change.
      // Math.max/min + || 5 guards against NaN (non-numeric string) and out-of-range values.
      // Default of 5 is conservative for serverless (Vercel/Lambda) where many instances run
      // concurrently — a large per-instance pool exhausts Atlas connection limits.
      maxPoolSize: Math.max(1, Math.min(100, Number(process.env.MONGO_MAX_POOL_SIZE ?? 5) || 5)),
      serverSelectionTimeoutMS: 3000, // fail fast on unreachable Atlas; 3 s is ample for warm connections
      connectTimeoutMS: 5000,         // TCP connect phase gets a slightly longer budget
      socketTimeoutMS: 45000,
    }).catch((err: unknown) => {
      // Strip the URI from the error before it propagates.  MongoClient
      // sometimes embeds the connection string in the Error message when
      // it cannot reach the host.  Use the pre-computed safeUri and the
      // already-captured uri — never call getConnectionString() again here,
      // as DATABASE_URL could theoretically be absent during hot reload.
      g._mongoClientPromise = undefined; // allow retry on next request
      const rawMessage = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MongoDB connection failed (${safeUri}): ${rawMessage.replaceAll(uri, safeUri)}`
      );
    });
  }

  const client = await g._mongoClientPromise;
  const db = client.db(dbName);

  // M-6 fix (updated): await the index health-check on the first successful
  // connection so that startup fails immediately when required indexes are
  // absent, rather than allowing traffic through to a misconfigured database.
  //
  // _indexCheckFired is stored on globalThis so it survives module
  // re-evaluations in serverless warm-function reuse (same lifecycle as
  // _mongoClientPromise).  We check at most once per warm instance.
  //
  // If checkRequiredIndexes throws (missing indexes), the error propagates out
  // of getDb(), rejects the caller, and the _mongoClientPromise is cleared so
  // the next request retries the full connection + check sequence (allowing the
  // operator to run create-indexes.ts and restart without a full redeploy).
  // H-1 fix: skipIndexCheck bypasses this entire block for the calling
  // request only. It deliberately does NOT read or write _indexCheckFired,
  // so it never marks the check as "done" for anyone else — the very next
  // non-skip getDb() call (real app traffic, or a later call within this
  // same script) still runs checkRequiredIndexes() for real and must pass
  // it. This is what lets createIndexes()/createCollectionValidators() get
  // a connection on a database that has zero indexes by definition, without
  // weakening the guard for actual application traffic.
  if (!options?.skipIndexCheck && !g._indexCheckFired) {
    g._indexCheckFired = true;
    try {
      await checkRequiredIndexes(db);
    } catch (indexErr) {
      // Reset so the check re-runs after the operator fixes the indexes.
      g._indexCheckFired = false;
      // L-8: surface missing env config at startup even on index failure.
      // Run in a try/catch so a validateEnvEagerly throw (production missing
      // security secrets) does not silently swallow the original index error.
      try { validateEnvEagerly(); } catch { /* already logged inside */ }
      throw indexErr;
    }
    // L-8: surface missing Resend/security config at startup.
    validateEnvEagerly();
  }

  return db;
}

// ---------------------------------------------------------------------------
// Index creation helpers (run once during DB setup, not on every request)
// ---------------------------------------------------------------------------

/**
 * Creates all required indexes for the faulter database.
 *
 * Run this script once after the database is provisioned:
 *   npx tsx scripts/create-indexes.ts
 *
 * Or call it from your migration runner.  It is idempotent — calling it again
 * after indexes already exist is a no-op.
 *
 * Indexes defined here:
 *
 *   subscribers.email         — unique + case-insensitive (DB-2)
 *   articles.title+...        — text search index (DB-1)
 *   contact_submissions.createdAt — TTL 90 days (DB-3)
 */
export async function createIndexes(): Promise<void> {
  // H-1 fix: skip the startup index check for this internal connection —
  // it would otherwise throw immediately on a fresh cluster (no indexes
  // exist yet), preventing this very function from ever running.
  const db = await getDb(undefined, { skipIndexCheck: true });

  // DB-2: Unique index on subscriber emails (case-insensitive).
  // strength: 2 means "alice@x.com" and "Alice@X.com" are treated as the
  // same email for deduplication purposes.
  await db.collection("subscribers").createIndex(
    { email: 1 },
    {
      unique: true,
      name: "email_unique_ci",
      collation: { locale: "en", strength: 2 },
    }
  );

  // DB-1: Full-text search index for articles.
  // Weighted so title matches rank above tag and excerpt matches.
  await db.collection("articles").createIndex(
    {
      title: "text",
      excerpt: "text",
      tags: "text",
      "author.name": "text",
      "category.name": "text",
    },
    { name: "article_text_search", weights: { title: 10, tags: 5, excerpt: 3 } }
  );

  // DB-3: TTL index on contact submissions — auto-purge after 90 days.
  // MongoDB's TTL thread runs ~every 60 seconds; purge is not instantaneous
  // but is reliable and requires zero application code to maintain.
  await db.collection("contact_submissions").createIndex(
    { createdAt: 1 },
    { name: "contact_ttl_90d", expireAfterSeconds: 90 * 24 * 60 * 60 }
  );

  // L-7: TTL index on GDPR erasure audit log — retain for 7 years then purge.
  // GDPR Art. 5(2) (accountability) requires the controller to be able to
  // demonstrate compliance.  Regulators expect evidence of who submitted an
  // erasure request and when it was actioned.  7 years aligns with common
  // EU national retention guidance for compliance records; adjust to your DPA's
  // recommendation if it differs.  Only the request metadata is stored —
  // the PII itself is deleted; see logGdprErasure() below.
  await db.collection("gdpr_erasure_log").createIndex(
    { erasedAt: 1 },
    { name: "gdpr_erasure_log_ttl_7y", expireAfterSeconds: 7 * 365 * 24 * 60 * 60 }
  );

  console.log("[db] Indexes created (or already existed).");
}

// ---------------------------------------------------------------------------
// D-3 fix: MongoDB JSON Schema collection validators
// ---------------------------------------------------------------------------

/**
 * Applies MongoDB JSON Schema validators to the `subscribers` and
 * `contact_submissions` collections.
 *
 * Without validators the MongoDB native driver accepts any document shape.
 * Field validation, type coercion, and required-field enforcement are absent
 * at the database layer, meaning writes with incorrect field types or missing
 * required fields succeed silently and can corrupt the dataset.
 *
 * This function is idempotent — collMod on an existing collection applies the
 * new validator without dropping data, and calling it again when the validator
 * is already identical is a no-op.
 *
 * Run this alongside createIndexes():
 *   npx tsx scripts/create-indexes.ts
 *
 * Design decisions:
 *   • `validationLevel: "strict"` (default) — ALL writes (insert + update)
 *     must satisfy the schema.  "moderate" would only validate inserts and
 *     updates that touch fields covered by the schema, which is too permissive
 *     for required-field enforcement.
 *   • `validationAction: "error"` (default) — reject non-conforming writes
 *     with a MongoServerError.  "warn" would log but allow bad writes through,
 *     defeating the purpose.
 *   • We use `db.command({ collMod })` rather than `db.createCollection()` to
 *     apply validators to an already-populated collection without dropping data.
 *     However, `db.createCollection()` is called first (idempotently, with
 *     `.catch(() => {})`) to ensure the collection exists on a fresh cluster
 *     where no writes have occurred yet — `collMod` throws "ns does not exist"
 *     if the collection is absent (H-3 fix).
 *
 * Collections validated:
 *   subscribers           — email (required string), createdAt (required date)
 *   contact_submissions   — name (required string), email (required string),
 *                           message (required string), createdAt (required date)
 *
 * The `articles` collection is intentionally omitted here: article documents
 * are complex, deeply nested, and managed exclusively through the application
 * layer (lib/articles.ts) during the static-data phase.  Add an articles
 * validator when a real CMS write path is introduced.
 */
export async function createCollectionValidators(): Promise<void> {
  // H-1 fix: same reasoning as createIndexes() above — this must be able to
  // run before indexes/collections exist, so it cannot go through the
  // standard index-checked getDb() path.
  const db = await getDb(undefined, { skipIndexCheck: true });

  // H-3 fix: ensure each collection exists before calling collMod.
  //
  // db.command({ collMod: "x", validator: … }) throws MongoServerError
  // "ns does not exist" on a brand-new Atlas cluster where the collection
  // has never been written to yet.  db.createCollection() is idempotent —
  // it no-ops silently when the collection already exists — so calling it
  // unconditionally before each collMod is the correct guard.
  //
  // The .catch(() => {}) swallows the "already exists" error that older
  // MongoDB server versions surface as a CommandFailedError rather than
  // silently succeeding.  The subsequent collMod is still applied correctly
  // once the collection is guaranteed to exist.
  await db.createCollection("subscribers").catch(() => {});
  await db.createCollection("contact_submissions").catch(() => {});
  await db.createCollection("gdpr_erasure_log").catch(() => {});

  // ── subscribers ────────────────────────────────────────────────────────────
  // Required fields: email (string) and createdAt (date).
  // email is also enforced unique + case-insensitive via the index created in
  // createIndexes(); the validator here enforces type and presence.
  // Additional fields (e.g. name, newsletterFrequency) are permitted
  // (additionalProperties is absent, which defaults to allowing extras) so the
  // schema does not need to be updated every time a new optional field is added.
  await db.command({
    collMod: "subscribers",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["email", "createdAt"],
        properties: {
          email: {
            bsonType: "string",
            description: "Subscriber email address — required, must be a string",
          },
          createdAt: {
            bsonType: "date",
            description: "Subscription timestamp — required, must be a BSON Date",
          },
        },
      },
    },
    validationLevel: "strict",
    validationAction: "error",
  });

  // ── contact_submissions ────────────────────────────────────────────────────
  // Required fields: name, email, message (all strings) and createdAt (date).
  // The TTL index on createdAt (created in createIndexes) relies on this field
  // being a BSON Date — enforcing it here ensures the TTL thread works
  // correctly.  A string "2026-04-19T…" is NOT pruned by the TTL thread even
  // though it looks like a date, so type enforcement here is load-bearing.
  await db.command({
    collMod: "contact_submissions",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["name", "email", "message", "createdAt"],
        properties: {
          name: {
            bsonType: "string",
            description: "Sender display name — required, must be a string",
          },
          email: {
            bsonType: "string",
            description: "Sender email address — required, must be a string",
          },
          message: {
            bsonType: "string",
            // MED-4 fix: maxLength enforced at the DB schema level to match the
            // application-layer cap in app/api/contact/route.ts (.slice(0, 5000)).
            // Without this, the MongoDB validator accepts strings of any length for
            // the message field — a direct DB write or a future code change that
            // removes the .slice() call could store an arbitrarily large document.
            // This makes the 5 000-character cap a hard constraint at both layers.
            maxLength: 5000,
            description: "Message body — required, must be a string, max 5 000 characters",
          },
          createdAt: {
            bsonType: "date",
            description:
              "Submission timestamp — required, must be a BSON Date (load-bearing: TTL index uses this field)",
          },
        },
      },
    },
    validationLevel: "strict",
    validationAction: "error",
  });

  // L-7: validator for the GDPR erasure audit log.
  // erasedAt must be a BSON Date — the TTL index (gdpr_erasure_log_ttl_7y)
  // depends on this field being the correct type to drive automatic purge.
  await db.command({
    collMod: "gdpr_erasure_log",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["emailHash", "ipHash", "channel", "erasedAt"],
        properties: {
          emailHash: {
            bsonType: "string",
            description: "SHA-256 hex digest of the requester's email — required",
          },
          ipHash: {
            bsonType: "string",
            description: "SHA-256 hex digest of the requester's IP — required",
          },
          channel: {
            bsonType: "string",
            description: "Request origin label — required",
          },
          erasedAt: {
            bsonType: "date",
            description:
              "Erasure timestamp — required, must be a BSON Date (load-bearing: 7-year TTL index uses this field)",
          },
        },
      },
    },
    validationLevel: "strict",
    validationAction: "error",
  });

  console.log("[db] Collection validators applied (subscribers, contact_submissions).");
}

// ---------------------------------------------------------------------------
// L-7 fix: GDPR erasure audit log helper
// ---------------------------------------------------------------------------

/**
 * Records that a GDPR erasure request was received and actioned.
 *
 * WHAT IS STORED (no PII):
 *   - A SHA-256 hash of the requester's email (pseudonymous identifier).
 *   - The ISO 8601 timestamp of the erasure action.
 *   - The originating IP address hash (pseudonymous).
 *   - The request channel (e.g. "contact-form", "email", "api").
 *
 * WHY: GDPR Art. 5(2) requires controllers to demonstrate compliance
 * ("accountability principle").  If a supervisory authority asks for proof
 * that erasure requests were actioned, this log is your evidence.  Without
 * it, you cannot demonstrate compliance even if the underlying data was
 * correctly deleted.
 *
 * The raw email is NEVER stored here — only its SHA-256 hex digest.  This
 * means the log itself does not re-introduce the PII it was written to prove
 * was erased.  The digest is sufficient for a regulator audit (you can verify
 * a specific address against it) without retaining the address in plaintext.
 *
 * The collection has a 7-year TTL index (gdpr_erasure_log_ttl_7y) so old
 * records are automatically purged once the regulatory retention period ends.
 *
 * @param emailHash   SHA-256 hex digest of the requester's email.
 *                    Compute with: crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex")
 * @param ipHash      SHA-256 hex digest of the requester's IP, or "unknown".
 * @param channel     Request origin label, e.g. "contact-form".
 */
export async function logGdprErasure(
  emailHash: string,
  ipHash: string,
  channel: string
): Promise<void> {
  const db = await getDb();
  await db.collection("gdpr_erasure_log").insertOne({
    emailHash,
    ipHash,
    channel,
    erasedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// M-6 fix: startup index health-check
// ---------------------------------------------------------------------------

/**
 * The set of (collection, index-name) pairs that MUST exist for the
 * application to function correctly.  Each entry maps to a risk if absent:
 *
 *   subscribers / email_unique_ci
 *     Risk: duplicate subscribers silently written; Resend deduplication
 *     becomes the sole guard against multiple welcome/newsletter emails to
 *     the same address.
 *
 *   articles / article_text_search
 *     Risk: $text queries return a MongoServerError at runtime once MongoDB
 *     is the live search backend; the search page shows an error to users.
 *
 *   contact_submissions / contact_ttl_90d
 *     Risk: PII (name, email, message) is retained indefinitely.  Under GDPR
 *     Article 5(1)(e) (storage limitation) this is a compliance violation that
 *     can trigger a supervisory-authority investigation.
 */
const REQUIRED_INDEXES: Array<{ collection: string; indexName: string; risk: string }> = [
  {
    collection: "subscribers",
    indexName: "email_unique_ci",
    risk: "duplicate subscriber writes — Resend deduplication is the sole guard",
  },
  {
    collection: "articles",
    indexName: "article_text_search",
    risk: "$text queries will throw MongoServerError at runtime",
  },
  {
    collection: "contact_submissions",
    indexName: "contact_ttl_90d",
    risk: "GDPR violation — contact PII retained indefinitely (Art. 5(1)(e))",
  },
  {
    collection: "gdpr_erasure_log",
    indexName: "gdpr_erasure_log_ttl_7y",
    risk: "GDPR Art. 5(2) accountability gap — erasure audit records retained indefinitely or not being created",
  },
];

/**
 * Checks that every index in REQUIRED_INDEXES exists in the database.
 *
 * Called once per process on the first successful MongoDB connection — see
 * getDb().  The call is awaited (not fire-and-forget) so that startup fails
 * immediately if required indexes are absent, rather than allowing traffic to
 * reach a misconfigured database.
 *
 * Design decisions:
 *   • db.collection(c).listIndexes().toArray() is used rather than
 *     db.collection(c).indexExists(name) to get all index names in one
 *     round-trip per collection, then check in-process.
 *   • Errors from listIndexes() are caught per-collection so a permission
 *     issue on one collection does not silently skip the remaining checks.
 *   • The function THROWS when any required index is missing so that getDb()
 *     propagates the error to the caller and the process cannot serve requests
 *     against an unprepared database.
 *
 * To fix a reported missing index, run:
 *   npx tsx scripts/create-indexes.ts
 */
async function checkRequiredIndexes(db: Db): Promise<void> {
  // Group checks by collection to minimise round-trips.
  const byCollection = new Map<string, string[]>();
  for (const { collection, indexName } of REQUIRED_INDEXES) {
    const names = byCollection.get(collection) ?? [];
    names.push(indexName);
    byCollection.set(collection, names);
  }

  const missing: Array<{ collection: string; indexName: string; risk: string }> = [];

  for (const [collectionName, expectedNames] of byCollection) {
    try {
      const indexes = await db.collection(collectionName).listIndexes().toArray();
      const existingNames = new Set(indexes.map((idx) => idx.name as string));
      for (const name of expectedNames) {
        if (!existingNames.has(name)) {
          const entry = REQUIRED_INDEXES.find(
            (r) => r.collection === collectionName && r.indexName === name
          )!;
          missing.push(entry);
        }
      }
    } catch (err: unknown) {
      // listIndexes() can fail if the collection does not exist yet (which is
      // fine on a fresh cluster before any data is written) or if the DB user
      // lacks listIndexes permission.  Either way, treat as a missing-index
      // condition and surface a clear error so the operator knows to run setup.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[db] checkRequiredIndexes: could not list indexes for "${collectionName}" \u2014 ${msg}. ` +
        `Run \`npx tsx scripts/create-indexes.ts\` if the database is new.`
      );
      // Push a synthetic entry so the final throw is triggered below.
      for (const name of expectedNames) {
        if (!missing.some((m) => m.collection === collectionName && m.indexName === name)) {
          const entry = REQUIRED_INDEXES.find(
            (r) => r.collection === collectionName && r.indexName === name
          )!;
          missing.push(entry);
        }
      }
    }
  }

  if (missing.length === 0) return;

  // Build the summary message before throwing so it appears in the error log.
  const summary =
    `[db] STARTUP BLOCKED — MISSING REQUIRED INDEXES (${missing.length}):\n` +
    missing
      .map((m) => `  \u2022 ${m.collection}.${m.indexName} \u2014 Risk: ${m.risk}`)
      .join("\n") +
    "\n\n" +
    "  Fix: run  npx tsx scripts/create-indexes.ts  on the target database,\n" +
    "  then restart the application.\n" +
    "  Without these indexes the application may experience data-integrity\n" +
    "  failures, query errors, or GDPR compliance violations in production.";

  console.error(summary);

  // Throw so getDb() propagates the failure to the first request handler.
  // This converts a silent misconfiguration into an immediate startup error
  // that is visible in the deployment platform's log stream and prevents
  // traffic from reaching a database that is not ready to serve it safely.
  throw new Error(summary);
}
