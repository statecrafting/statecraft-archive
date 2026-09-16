#!/usr/bin/env node
// One-shot PAT_ENCRYPTION_KEY rotation tool.
//
// Decrypts each row in the three PAT tables with the OLD key, re-encrypts
// with the NEW key, and writes back. The patCrypto.ts module has no key
// versioning — rows encrypted with the old key are unreadable after the
// `encore secret set` flip. This script is the bridge.
//
// Usage:
//   cd platform/services/statecraft
//   # 1. Resolve POSTGRES_PASSWORD + start a port-forward in another shell:
//   kubectl --kubeconfig ../infra/hetzner/kubeconfig -n statecraft-system \
//     port-forward svc/postgresql 5432:5432
//
//   # 2. In this shell, source both keys from .env then run:
//   export OLD_KEY=$(grep -E '^PAT_ENCRYPTION_KEY_COMPROMISED=' ../infra/hetzner/.env | cut -d= -f2- | sed 's/^"//;s/"$//')
//   export NEW_KEY=$(grep -E '^PAT_ENCRYPTION_KEY='              ../infra/hetzner/.env | cut -d= -f2- | sed 's/^"//;s/"$//')
//   export PGPASSWORD=$(kubectl --kubeconfig ../infra/hetzner/kubeconfig -n statecraft-system \
//     get secret statecraft-api-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
//   node scripts/rekey-pats.mjs --dry-run
//   node scripts/rekey-pats.mjs --apply
//
// The script:
//   * Walks user_github_pats, factory_upstream_pats, project_github_pats.
//   * For each row, decrypts token_enc with OLD_KEY (verifies the GCM tag).
//   * Re-encrypts under NEW_KEY with a fresh nonce.
//   * Updates token_enc + token_nonce in a single transaction across all
//     three tables — partial-success rollback if any row fails.
//   * Emits an audit_log row per successful rotation
//     (`action='pat.crypto.rekeyed'`).
//
// Exit codes:
//   0 — dry-run reported a clean plan, or apply succeeded.
//   2 — at least one row failed to decrypt with OLD_KEY (corruption,
//       wrong key, or schema drift). No writes performed.
//   3 — apply pre-flight failed (DB unreachable, missing env vars).

import { Client } from "pg";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import process from "node:process";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const PAT_TABLES = [
  { table: "user_github_pats", pkColumn: "id" },
  { table: "factory_upstream_pats", pkColumn: "org_id" },
  { table: "project_github_pats", pkColumn: "project_id" },
];

function die(code, msg) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

function loadKey(name) {
  const raw = process.env[name];
  if (!raw) die(3, `${name} env var is empty`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    die(3, `${name} must decode to ${KEY_BYTES} bytes (got ${buf.length})`);
  }
  return buf;
}

function decrypt(key, tokenEnc, tokenNonce) {
  if (tokenEnc.length <= TAG_BYTES) {
    throw new Error("token_enc shorter than GCM tag size");
  }
  if (tokenNonce.length !== NONCE_BYTES) {
    throw new Error(`token_nonce is ${tokenNonce.length} bytes (expected ${NONCE_BYTES})`);
  }
  const ct = tokenEnc.subarray(0, tokenEnc.length - TAG_BYTES);
  const tag = tokenEnc.subarray(tokenEnc.length - TAG_BYTES);
  const dec = createDecipheriv("aes-256-gcm", key, tokenNonce);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString("utf-8");
}

function encrypt(key, plaintext) {
  const nonce = randomBytes(NONCE_BYTES);
  const cip = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cip.update(plaintext, "utf-8"), cip.final()]);
  return { tokenEnc: Buffer.concat([ct, cip.getAuthTag()]), tokenNonce: nonce };
}

const argv = process.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run");
const apply = args.has("--apply");
if (dryRun === apply) {
  die(3, "pass exactly one of --dry-run or --apply");
}
const actorIdFlag = argv.find((a) => a.startsWith("--actor-user-id="));
const actorUserId = actorIdFlag
  ? actorIdFlag.slice("--actor-user-id=".length)
  : process.env.ACTOR_USER_ID ?? null;

const oldKey = loadKey("OLD_KEY");
const newKey = loadKey("NEW_KEY");
if (oldKey.equals(newKey)) {
  die(3, "OLD_KEY and NEW_KEY are identical — nothing to rotate");
}

const dbHost = process.env.PGHOST ?? "127.0.0.1";
const dbPort = Number(process.env.PGPORT ?? "5432");
const dbUser = process.env.PGUSER ?? "statecraft";
const dbName = process.env.PGDATABASE ?? "auth";
const dbPassword = process.env.PGPASSWORD;
if (!dbPassword) die(3, "PGPASSWORD env var is empty");

const client = new Client({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
});

try {
  await client.connect();
} catch (e) {
  die(3, `pg connect failed (${dbHost}:${dbPort}): ${e.message}`);
}

const plan = [];
let decryptFailures = 0;

for (const { table, pkColumn } of PAT_TABLES) {
  const res = await client.query(
    `SELECT ${pkColumn} AS pk, token_enc, token_nonce, token_prefix FROM ${table}`
  );
  for (const row of res.rows) {
    const tokenEnc = row.token_enc;
    const tokenNonce = row.token_nonce;
    let plaintext;
    try {
      plaintext = decrypt(oldKey, tokenEnc, tokenNonce);
    } catch (e) {
      decryptFailures++;
      console.error(
        `  ✗ ${table} pk=${row.pk} prefix=${row.token_prefix}: decrypt-with-old failed (${e.message})`
      );
      continue;
    }
    const reKeyed = encrypt(newKey, plaintext);
    plan.push({
      table,
      pkColumn,
      pk: row.pk,
      tokenPrefix: row.token_prefix,
      newTokenEnc: reKeyed.tokenEnc,
      newTokenNonce: reKeyed.tokenNonce,
    });
    console.log(`  ✓ ${table} pk=${row.pk} prefix=${row.token_prefix}`);
  }
}

console.log(`\n${plan.length} row(s) ready, ${decryptFailures} decrypt failure(s).`);

if (decryptFailures > 0) {
  await client.end();
  die(2, "at least one row could not be decrypted with OLD_KEY — refusing to write");
}

if (dryRun) {
  console.log("dry-run — no writes performed.");
  await client.end();
  process.exit(0);
}

if (!actorUserId) {
  await client.end();
  die(
    3,
    "--apply requires --actor-user-id=<uuid> (or ACTOR_USER_ID env). " +
      "audit_log.actor_user_id is NOT NULL — pass the admin user whose " +
      "credentials authorise this rotation."
  );
}

// --apply path: single transaction across all three tables + audit_log row.
try {
  await client.query("BEGIN");
  for (const p of plan) {
    await client.query(
      `UPDATE ${p.table} SET token_enc=$1, token_nonce=$2, updated_at=NOW() WHERE ${p.pkColumn}=$3`,
      [p.newTokenEnc, p.newTokenNonce, p.pk]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1::uuid, 'pat.crypto.rekeyed', $2, $3::text, $4::jsonb)`,
      [actorUserId, p.table, p.pk, JSON.stringify({ token_prefix: p.tokenPrefix })]
    );
  }
  await client.query("COMMIT");
  console.log(`\n${plan.length} row(s) rotated and audit-logged (actor=${actorUserId}).`);
} catch (e) {
  await client.query("ROLLBACK");
  die(3, `apply failed, rolled back: ${e.message}`);
} finally {
  await client.end();
}
