//! enrahitu's in-process hiqlite capability.
//!
//! hiqlite runs INSIDE the Encore.ts Node process on this addon's own tokio
//! runtime (napi-rs `tokio_rt` feature). Encore's Rust runtime lives in a
//! separate dylib (`encore-runtime.node`); the two runtimes coexist in one
//! process. This was proven end to end by the template-encore Shape A spike
//! (statecrafting/template-encore PR #40) and hardened here:
//!
//! - config comes from `ENRAHITU_HIQ_*` env vars instead of hardcoded values
//! - the data dir persists across restarts (the spike wiped a temp dir)
//! - `init()` is exported so the app pays raft election at boot, not on the
//!   first request (spike caveat #5)
//!
//! Surface (v0): cache/KV with per-key TTL + raft-replicated counters.
//! Single-node by default; the same knobs cover a future clustered deployment.

use hiqlite::macros::CacheVariants;
use hiqlite::{Client, Node, NodeConfig};
use napi_derive::napi;
use tokio::sync::OnceCell;

/// One logical cache per concern: plain KV entries and monotonic counters
/// live in separate hiqlite cache indexes so their key spaces never collide.
#[derive(Debug, CacheVariants)]
enum Cache {
    Kv,
    Counters,
}

/// The embedded hiqlite client, started once and kept for the process
/// lifetime. Its raft/API servers run as background tasks on the addon's
/// tokio runtime.
static CLIENT: OnceCell<Client> = OnceCell::const_new();

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn hql_err(ctx: &str, e: hiqlite::Error) -> napi::Error {
    napi::Error::from_reason(format!("hiqlite {ctx} failed: {e}"))
}

/// A publicly-known development encryption key. NEVER a production key.
///
/// It exists so `node` and the test suite can start a node without ceremony,
/// exactly as the raft and API secrets above have dev defaults. The packaged
/// container generates real per-deployment keys at first boot and injects
/// them, so this value is unreachable there.
const DEV_ENC_KEY_ID: &str = "enrahitudev";
const DEV_ENC_KEY: &str = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=";

/// Backup encryption keys, from `ENRAHITU_HIQ_ENC_KEYS`.
///
/// Format is `<id>/<base64-32-bytes>`, entries separated by newlines or spaces:
/// deliberately the SAME format rauthy's `ENC_KEYS` uses, so a deployment can
/// custody ONE key set and inject it into both hiqlite instances. That is not
/// cosmetic. Off-box backups are encrypted with these keys, so a tenant that
/// loses them holds unrecoverable ciphertext, and a deployment with two
/// independent key custodies doubles that exposure for no benefit.
///
/// Falling back to the dev key is loud, because a production node quietly
/// encrypting its backups with a publicly known key is worse than one that
/// fails to start.
fn enc_keys() -> napi::Result<cryptr::EncKeys> {
    let raw = env_or("ENRAHITU_HIQ_ENC_KEYS", "");
    let (active, entries) = if raw.trim().is_empty() {
        eprintln!(
            "[hiqlite-native] WARNING: ENRAHITU_HIQ_ENC_KEYS is unset; using the PUBLIC \
             development encryption key. Backups written by this node are not confidential. \
             Set ENRAHITU_HIQ_ENC_KEYS and ENRAHITU_HIQ_ENC_KEY_ACTIVE before storing anything \
             that matters."
        );
        (
            DEV_ENC_KEY_ID.to_string(),
            vec![format!("{DEV_ENC_KEY_ID}/{DEV_ENC_KEY}")],
        )
    } else {
        let active = env_or("ENRAHITU_HIQ_ENC_KEY_ACTIVE", "");
        if active.trim().is_empty() {
            return Err(napi::Error::from_reason(
                "ENRAHITU_HIQ_ENC_KEYS is set but ENRAHITU_HIQ_ENC_KEY_ACTIVE is not: the active \
                 key id selects which key encrypts new backups, so it cannot be guessed",
            ));
        }
        let entries = raw
            .split(['\n', ' '])
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        (active, entries)
    };

    cryptr::EncKeys::try_parse(active, entries).map_err(|e| {
        napi::Error::from_reason(format!(
            "ENRAHITU_HIQ_ENC_KEYS could not be parsed ({e}). Format: \"<id>/<base64-32-bytes>\", \
             ids matching ^[a-zA-Z0-9:_-]{{2,20}}, entries separated by newlines or spaces."
        ))
    })
}

/// Parse `ENRAHITU_HIQ_NODES` into a membership list.
///
/// Each entry is `<id> <addr_raft> <addr_api>`, entries separated by commas or
/// newlines. Malformed input fails loudly at boot rather than silently yielding
/// a smaller cluster than the operator intended, because a raft cluster that
/// quietly comes up with the wrong membership is a quorum bug that surfaces
/// much later and much worse.
fn parse_nodes(raw: &str) -> napi::Result<Vec<Node>> {
    let mut nodes = Vec::new();
    for entry in raw.split([',', '\n']) {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let parts: Vec<&str> = entry.split_whitespace().collect();
        if parts.len() != 3 {
            return Err(napi::Error::from_reason(format!(
                "ENRAHITU_HIQ_NODES entry {entry:?}: expected \"<id> <addr_raft> <addr_api>\", \
                 got {} field(s)",
                parts.len()
            )));
        }
        let id: u64 = parts[0].parse().map_err(|e| {
            napi::Error::from_reason(format!(
                "ENRAHITU_HIQ_NODES entry {entry:?}: node id {:?} is not a number: {e}",
                parts[0]
            ))
        })?;
        nodes.push(Node {
            id,
            addr_raft: parts[1].to_string(),
            addr_api: parts[2].to_string(),
        });
    }
    if nodes.is_empty() {
        return Err(napi::Error::from_reason(
            "ENRAHITU_HIQ_NODES was set but parsed to no nodes",
        ));
    }
    Ok(nodes)
}

/// Start (or return) the single-node hiqlite instance, bound to loopback.
///
/// Env knobs (all optional in dev):
/// - `ENRAHITU_HIQ_DATA_DIR`    raft WAL + snapshot dir (default `./.data/hiqlite`)
/// - `ENRAHITU_HIQ_NODE_ID`     numeric node id (default `1`)
/// - `ENRAHITU_HIQ_ADDR_RAFT`   raft listener (default `127.0.0.1:8100`)
/// - `ENRAHITU_HIQ_ADDR_API`    api listener (default `127.0.0.1:8200`)
/// - `ENRAHITU_HIQ_SECRET_RAFT` / `ENRAHITU_HIQ_SECRET_API`
///   listener auth secrets, >= 16 chars (dev defaults are fine on loopback;
///   the container entrypoint sets real ones in production)
async fn client() -> napi::Result<&'static Client> {
    CLIENT
        .get_or_try_init(|| async {
            let data_dir = env_or("ENRAHITU_HIQ_DATA_DIR", "./.data/hiqlite");
            std::fs::create_dir_all(&data_dir).map_err(|e| {
                napi::Error::from_reason(format!("hiqlite data dir {data_dir}: {e}"))
            })?;

            let node_id: u64 = env_or("ENRAHITU_HIQ_NODE_ID", "1")
                .parse()
                .map_err(|e| napi::Error::from_reason(format!("ENRAHITU_HIQ_NODE_ID: {e}")))?;

            // Cluster membership. Configuration passthrough, not consensus
            // code: hiqlite already solves bootstrap, auto-join, ordinal
            // identity and learners. N=1 is the primary mode (enrahitu spec
            // 001 section 4.1), so the default is a single voter and the
            // multi-node path activates only when ENRAHITU_HIQ_NODES is set.
            //
            // Format, one node per entry, comma or newline separated:
            //   <id> <addr_raft> <addr_api>
            let nodes_raw = env_or("ENRAHITU_HIQ_NODES", "");
            let nodes = if nodes_raw.trim().is_empty() {
                vec![Node {
                    id: node_id,
                    addr_raft: env_or("ENRAHITU_HIQ_ADDR_RAFT", "127.0.0.1:8100"),
                    addr_api: env_or("ENRAHITU_HIQ_ADDR_API", "127.0.0.1:8200"),
                }]
            } else {
                parse_nodes(&nodes_raw)?
            };

            let config = NodeConfig {
                node_id,
                nodes,
                data_dir: data_dir.into(),
                secret_raft: env_or("ENRAHITU_HIQ_SECRET_RAFT", "enrahitu-dev-raft-secret"),
                secret_api: env_or("ENRAHITU_HIQ_SECRET_API", "enrahitu-dev-api-secret"),
                enc_keys: enc_keys()?,
                log_statements: false,
                ..NodeConfig::default()
            };

            hiqlite::start_node_with_cache::<Cache>(config)
                .await
                .map_err(|e| hql_err("init", e))
        })
        .await
}

/// Start the embedded hiqlite node (idempotent). Call once at service init.
#[napi]
pub async fn init() -> napi::Result<()> {
    client().await?;
    Ok(())
}

/// Confirms the addon is loaded and hiqlite is up inside this process.
#[napi]
pub async fn health() -> napi::Result<String> {
    client().await?;
    Ok("ok".to_string())
}

/// Store a string value under `key`, with an optional TTL in seconds.
#[napi]
pub async fn kv_put(key: String, value: String, ttl_secs: Option<i64>) -> napi::Result<()> {
    client()
        .await?
        .put(Cache::Kv, key, &value, ttl_secs)
        .await
        .map_err(|e| hql_err("kv_put", e))
}

/// Read the string value stored under `key`, or `null` if absent/expired.
#[napi]
pub async fn kv_get(key: String) -> napi::Result<Option<String>> {
    client()
        .await?
        .get::<Cache, String, String>(Cache::Kv, key)
        .await
        .map_err(|e| hql_err("kv_get", e))
}

/// Delete the value stored under `key` (no-op if absent).
#[napi]
pub async fn kv_del(key: String) -> napi::Result<()> {
    client()
        .await?
        .delete(Cache::Kv, key)
        .await
        .map_err(|e| hql_err("kv_del", e))
}

/// Add `delta` to the counter under `key` and return the new value.
/// Counters are raft-replicated and atomic; this is the rate-limit primitive.
#[napi]
pub async fn counter_add(key: String, delta: i64) -> napi::Result<i64> {
    client()
        .await?
        .counter_add(Cache::Counters, key, delta)
        .await
        .map_err(|e| hql_err("counter_add", e))
}

/// Read the counter under `key`, or `null` if it was never set.
#[napi]
pub async fn counter_get(key: String) -> napi::Result<Option<i64>> {
    client()
        .await?
        .counter_get(Cache::Counters, key)
        .await
        .map_err(|e| hql_err("counter_get", e))
}

/// Set the counter under `key` to a fixed value.
#[napi]
pub async fn counter_set(key: String, value: i64) -> napi::Result<()> {
    client()
        .await?
        .counter_set(Cache::Counters, key, value)
        .await
        .map_err(|e| hql_err("counter_set", e))
}

/// Delete the counter under `key`, freeing its memory.
#[napi]
pub async fn counter_del(key: String) -> napi::Result<()> {
    client()
        .await?
        .counter_del(Cache::Counters, key)
        .await
        .map_err(|e| hql_err("counter_del", e))
}

// ===========================================================================
// The state layer (enrahitu spec 032, the interface contract)
//
// Everything above this line is the cache surface the addon shipped with.
// Everything below is replicated SQL, watch, leases, and backup: the calls
// that make hiqlite the state layer rather than a cache.
//
// The surface is small on purpose. Four of the contract's ten decisions
// concluded that no new primitive was needed, so `txn` plus a unique index is
// the compare-and-swap, a monotonic column inside the transaction is the
// revision sequence, migrations are DDL through `txn` guarded by a version
// table, and restore stays a boot-time concern outside this addon.
// ===========================================================================

use hiqlite::{Param, Row};
use serde_json::Value as Json;

/// Convert one JSON parameter into a SQLite bind parameter.
///
/// NULL, INTEGER, REAL and TEXT round-trip. Blobs deliberately do not: JSON has
/// no byte type, and every available encoding (base64 string, array of numbers)
/// is ambiguous with a legitimate value of that shape. Guessing one now would
/// be a compatibility promise later, and the association domain this substrate
/// serves keeps documents in object storage rather than in rows. An explicit
/// error naming the position beats a silent mis-encoding.
fn json_to_param(value: &Json, position: usize) -> napi::Result<Param> {
    Ok(match value {
        Json::Null => Param::Null,
        Json::Bool(b) => Param::Integer(i64::from(*b)),
        Json::String(s) => Param::Text(s.clone()),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Param::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Param::Real(f)
            } else {
                return Err(napi::Error::from_reason(format!(
                    "parameter {position}: number out of range for SQLite (i64 or f64)"
                )));
            }
        }
        Json::Array(_) | Json::Object(_) => {
            return Err(napi::Error::from_reason(format!(
                "parameter {position}: arrays and objects are not SQL values. Serialize to \
                 TEXT with JSON.stringify at the call site, so the column type is a decision \
                 the schema makes rather than one this binding makes for it."
            )))
        }
    })
}

fn json_params(params: Option<Vec<Json>>) -> napi::Result<Vec<Param>> {
    params
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, v)| json_to_param(v, i + 1))
        .collect()
}

/// Reshape one result row into a flat JS object.
///
/// `Row::Owned` carries its columns in private fields, so they are read through
/// the serde representation the type already derives (the same representation
/// hiqlite uses on the wire for remote queries). The local path this addon
/// always takes yields `Owned`, so `Borrowed` is unreachable in-process and
/// says so rather than silently returning an empty row.
fn row_to_json(row: Row<'_>) -> napi::Result<Json> {
    let owned = match row {
        Row::Owned(r) => r,
        Row::Borrowed(_) => {
            return Err(napi::Error::from_reason(
                "unexpected borrowed row: this addon is the local node and should only ever \
                 receive owned rows",
            ))
        }
    };
    let raw = serde_json::to_value(&owned)
        .map_err(|e| napi::Error::from_reason(format!("row encode failed: {e}")))?;
    let columns = raw
        .get("columns")
        .and_then(Json::as_array)
        .ok_or_else(|| napi::Error::from_reason("row encode failed: no columns array"))?;

    let mut out = serde_json::Map::with_capacity(columns.len());
    for col in columns {
        let name = col
            .get("name")
            .and_then(Json::as_str)
            .ok_or_else(|| napi::Error::from_reason("row encode failed: column without a name"))?;
        let value = col
            .get("value")
            .ok_or_else(|| napi::Error::from_reason("row encode failed: column without a value"))?;
        // ValueOwned is an externally tagged enum: {"Text": "x"}, {"Null": null}.
        let flat = match value {
            Json::Object(map) if map.len() == 1 => {
                let (tag, inner) = map.iter().next().expect("len checked");
                match tag.as_str() {
                    "Null" => Json::Null,
                    "Integer" | "Real" | "Text" => inner.clone(),
                    "Blob" => {
                        return Err(napi::Error::from_reason(format!(
                            "column \"{name}\" is a BLOB, which this surface does not encode. \
                             JSON has no byte type and every encoding is ambiguous; select the \
                             column with a SQL-side conversion, or keep bytes out of rows."
                        )))
                    }
                    other => {
                        return Err(napi::Error::from_reason(format!(
                            "column \"{name}\": unknown SQL value kind \"{other}\""
                        )))
                    }
                }
            }
            // ValueOwned::Null is a UNIT variant, so serde emits the bare
            // string "Null" rather than {"Null": null}. A TEXT column holding
            // the literal text "Null" arrives as {"Text": "Null"} and is
            // handled above, so this cannot swallow a real value.
            Json::String(tag) if tag == "Null" => Json::Null,
            Json::Null => Json::Null,
            other => {
                return Err(napi::Error::from_reason(format!(
                    "column \"{name}\": unexpected SQL value encoding {other}"
                )))
            }
        };
        out.insert(name.to_string(), flat);
    }
    Ok(Json::Object(out))
}

fn rows_to_json(rows: Vec<Row<'_>>) -> napi::Result<Vec<Json>> {
    rows.into_iter().map(row_to_json).collect()
}

/// Read from the LOCAL replica: fast, and possibly stale behind the leader.
///
/// Distinct from `queryConsistent` by name rather than by a flag, deliberately
/// (spec 032 section 3.3): a single call with a consistency flag has a default,
/// and the default is silently wrong at half the call sites. Two names force
/// the author to state the requirement and make the expensive choice visible in
/// review.
///
/// Correct for list and detail endpoints, policy evaluation, and controller
/// scans. NOT correct for admission or for reading the Decision chain head.
#[napi(ts_return_type = "Promise<SqlRow[]>")]
pub async fn query(
    sql: String,
    #[napi(ts_arg_type = "SqlValue[]")] params: Option<Vec<Json>>,
) -> napi::Result<Vec<Json>> {
    let rows = client()
        .await?
        .query_raw(sql, json_params(params)?)
        .await
        .map_err(|e| hql_err("query", e))?;
    rows_to_json(rows)
}

/// Read linearizably, through the raft leader. Slower by a round trip.
///
/// Required wherever a decision is made on what was read: admission, and the
/// compare-and-swap read of the Decision chain head.
#[napi(ts_return_type = "Promise<SqlRow[]>")]
pub async fn query_consistent(
    sql: String,
    #[napi(ts_arg_type = "SqlValue[]")] params: Option<Vec<Json>>,
) -> napi::Result<Vec<Json>> {
    let rows = client()
        .await?
        .query_consistent(sql, json_params(params)?)
        .await
        .map_err(|e| hql_err("query_consistent", e))?;
    rows_to_json(rows)
}

/// A single write. Returns rows affected.
///
/// For anything with an invariant, use `txn`: a resource and its outbox row
/// must commit together or the event is lost with the resource durably written,
/// which is the exact failure the outbox exists to prevent.
#[napi]
pub async fn execute(
    sql: String,
    #[napi(ts_arg_type = "SqlValue[]")] params: Option<Vec<Json>>,
) -> napi::Result<i64> {
    let n = client()
        .await?
        .execute(sql, json_params(params)?)
        .await
        .map_err(|e| hql_err("execute", e))?;
    Ok(n as i64)
}

/// A write with a `RETURNING` clause. Returns the returned rows.
#[napi(ts_return_type = "Promise<SqlRow[]>")]
pub async fn execute_returning(
    sql: String,
    #[napi(ts_arg_type = "SqlValue[]")] params: Option<Vec<Json>>,
) -> napi::Result<Vec<Json>> {
    let res = client()
        .await?
        .execute_returning(sql, json_params(params)?)
        .await
        .map_err(|e| hql_err("execute_returning", e))?;
    let mut out = Vec::with_capacity(res.len());
    for row in res {
        out.push(row_to_json(row.map_err(|e| hql_err("execute_returning row", e))?)?);
    }
    Ok(out)
}

/// One statement of a transaction.
#[napi(object)]
pub struct SqlStatement {
    pub sql: String,
    #[napi(ts_type = "SqlValue[]")]
    pub params: Option<Vec<Json>>,
}

/// Submit a batch as ONE raft operation: the atomic unit (spec 032 section 3.1).
///
/// This is the write path for anything with an invariant. SQL writes and notify
/// land in different raft groups and cannot be atomic with each other under any
/// API, so this is the only atomic unit available, and it is the one that
/// matters: resource plus outbox row.
///
/// Returns rows-affected per statement, in submission order. A statement that
/// fails inside the batch surfaces as an error for the whole call, because a
/// partially applied "transaction" would make the name a lie.
#[napi]
pub async fn txn(statements: Vec<SqlStatement>) -> napi::Result<Vec<i64>> {
    let mut queries: Vec<(String, Vec<Param>)> = Vec::with_capacity(statements.len());
    for stmt in statements {
        queries.push((stmt.sql, json_params(stmt.params)?));
    }
    let results = client()
        .await?
        .txn(queries)
        .await
        .map_err(|e| hql_err("txn", e))?;

    let mut out = Vec::with_capacity(results.len());
    for (i, res) in results.into_iter().enumerate() {
        match res {
            Ok(n) => out.push(n as i64),
            Err(e) => {
                return Err(napi::Error::from_reason(format!(
                    "txn statement {i} failed: {e}"
                )))
            }
        }
    }
    Ok(out)
}

// --- watch ------------------------------------------------------------------

/// Publish a key-only event on the cache raft group.
///
/// The envelope is deliberately small (spec 032 section 3.2). The cache group
/// replicates to every node and is not durable, so a large payload costs memory
/// everywhere for data nobody may trust; the payload is already durable in the
/// SQL group; and a full payload tempts a consumer to act on delivery, which is
/// incorrect because delivery is not guaranteed.
/// The watch envelope: key-only, enforced structurally rather than by
/// convention.
///
/// It is a concrete struct for two reasons that turned out to be the same
/// reason. hiqlite serializes bus events with bincode, which cannot decode a
/// free-form JSON value (it needs `deserialize_any`), so a `serde_json::Value`
/// envelope fails at runtime with `Serde(AnyNotSupported)`. And a struct is
/// what spec 032 section 3.2 asked for anyway: with fixed fields, a caller
/// CANNOT smuggle a payload onto the cache raft group, where it would cost
/// memory on every node for data nobody may trust.
#[napi(object)]
#[derive(serde::Serialize, serde::Deserialize)]
pub struct NotifyEnvelope {
    /// The resource kind, which is also the routing key: hiqlite's listen
    /// channel is global rather than per-topic, so consumers filter.
    pub kind: String,
    pub tenant: Option<String>,
    pub name: String,
    /// The revision to re-read at. Truth lives in the SQL group; this is the
    /// hint that says it is worth looking.
    pub revision: i64,
}

#[napi]
pub async fn notify(envelope: NotifyEnvelope) -> napi::Result<()> {
    client()
        .await?
        .notify(&envelope)
        .await
        .map_err(|e| hql_err("notify", e))
}

/// Await the next event on the bus.
///
/// One event per call rather than a callback registration: napi threadsafe
/// functions would put the subscription lifecycle in Rust, where cancellation
/// and backpressure are harder to reason about than in the TS facade that
/// consumes them. `backend/state/` wraps this into the `listen(handler)` shape
/// the contract specifies.
///
/// The channel is global rather than per-topic, and hiqlite replays cache
/// events after a restart, so the consumer filters and must be idempotent. That
/// is not a limitation to work around: notify is a latency hint, and a revision
/// watermark is what makes a consumer correct (spec 032 section 3.5).
#[napi]
pub async fn listen_next() -> napi::Result<NotifyEnvelope> {
    client()
        .await?
        .listen::<NotifyEnvelope>()
        .await
        .map_err(|e| hql_err("listen", e))
}

// --- leases -----------------------------------------------------------------

/// The table backing lease fencing tokens. Created lazily on first `lock()`.
const FENCE_DDL: &str = "CREATE TABLE IF NOT EXISTS _hiqlite_lease_fence (\
     key TEXT PRIMARY KEY, fence INTEGER NOT NULL)";

/// A held lease: the lock plus its fencing token.
///
/// The token is NOT hiqlite's lock id. That id is the raft log index and would
/// be a valid fencing token, but `hiqlite::Lock` keeps it in a private field
/// with no accessor, so it cannot be obtained through the public API at all.
/// The token here is a monotonic counter in the SQLITE group instead, which is
/// better for a reason worth stating: lock state lives in the cache group,
/// which is not durable and does not survive a full cluster restart, and a
/// fencing token that resets is not a fencing token. This one is durable, and
/// it lives in the same group as the writes it guards, so the fence and the
/// write commit in one `txn`.
#[napi(object)]
pub struct Lease {
    /// Monotonic per key. Every lease-guarded write carries it, and the store
    /// rejects a token below the highest seen: `WHERE fence <= :token`.
    pub token: i64,
    /// The key, so `releaseLock` can be called without the caller tracking it.
    pub key: String,
}

/// Held Rust-side locks, keyed by lease key.
///
/// `hiqlite::Lock` releases on Drop, asynchronously via a spawned task.
/// JavaScript has no deterministic drop, so the handle is parked here and
/// released explicitly; without this the lock would be dropped the instant
/// `lock()` returned and the lease would be a no-op.
static LOCKS: OnceCell<tokio::sync::Mutex<std::collections::HashMap<String, hiqlite::Lock>>> =
    OnceCell::const_new();

async fn locks(
) -> &'static tokio::sync::Mutex<std::collections::HashMap<String, hiqlite::Lock>> {
    LOCKS
        .get_or_init(|| async { tokio::sync::Mutex::new(std::collections::HashMap::new()) })
        .await
}

/// Acquire a distributed lease and its fencing token.
///
/// **The TTL is ten seconds and is not configurable.** hiqlite hardcodes
/// `LOCK_VALID_SECONDS = 10` with no knob (its client carries a
/// `// TODO - lock_timeout`). A reconcile that runs longer than that loses its
/// lease WHILE STILL RUNNING and its replacement begins work concurrently, so
/// fencing is not optional hardening here: it is what makes the lock usable.
/// Controllers either chunk their work to fit inside ten seconds or re-acquire
/// and rely on the token. Pretending the lease is long is not an option.
#[napi]
pub async fn lock(key: String) -> napi::Result<Lease> {
    let c = client().await?;

    let held = c.lock(key.clone()).await.map_err(|e| hql_err("lock", e))?;
    {
        let mut map = locks().await.lock().await;
        map.insert(key.clone(), held);
    }

    c.execute(FENCE_DDL, Vec::new())
        .await
        .map_err(|e| hql_err("lease fence ddl", e))?;

    let row = c
        .execute_returning_one(
            "INSERT INTO _hiqlite_lease_fence (key, fence) VALUES ($1, 1) \
             ON CONFLICT (key) DO UPDATE SET fence = fence + 1 RETURNING fence",
            vec![Param::Text(key.clone())],
        )
        .await
        .map_err(|e| hql_err("lease fence bump", e))?;

    let value = row_to_json(row)?;
    let token = value
        .get("fence")
        .and_then(Json::as_i64)
        .ok_or_else(|| napi::Error::from_reason("lease fence bump returned no fence"))?;

    Ok(Lease { token, key })
}

/// Release a lease.
///
/// Explicit because JavaScript has no deterministic drop. The promise resolves
/// only once the handle is gone, so the lock is observably free to another
/// caller afterwards rather than whenever a finalizer happens to run.
#[napi]
pub async fn release_lock(key: String) -> napi::Result<()> {
    let mut map = locks().await.lock().await;
    // Dropping the handle triggers hiqlite's release.
    map.remove(&key);
    Ok(())
}

// --- durability -------------------------------------------------------------

/// Create an on-demand backup of the SQLite state machine.
///
/// The scheduled cron backup alone cannot bracket a risky operation, and
/// bracketing is the difference between an RPO equal to the cron interval and
/// an RPO of zero for the operations that actually threaten data: upgrades,
/// migrations, and bulk imports each get a backup immediately before.
///
/// Safe to expose as-is: hiqlite issues `VACUUM main INTO` on the writer
/// thread, so it is serialized against writes rather than racing them,
/// leader-only, with a sixty-second duplicate-request guard.
///
/// It covers the SQLITE group only. Counters, lock state, and cache KV live in
/// the cache group and do not survive a restore, which is why nothing durable
/// belongs there.
#[napi]
pub async fn backup() -> napi::Result<()> {
    client()
        .await?
        .backup()
        .await
        .map_err(|e| hql_err("backup", e))
}

/// One entry in a backup listing.
#[napi(object)]
pub struct BackupListing {
    pub name: String,
    pub last_modified: i64,
    pub size: Option<i64>,
}

#[napi]
pub async fn backup_list_local() -> napi::Result<Vec<BackupListing>> {
    let list = client()
        .await?
        .backup_list_local()
        .await
        .map_err(|e| hql_err("backup_list_local", e))?;
    Ok(list
        .into_iter()
        .map(|b| BackupListing {
            name: b.name,
            last_modified: b.last_modified,
            size: b.size.map(|s| s as i64),
        })
        .collect())
}

#[napi]
pub async fn backup_list_s3() -> napi::Result<Vec<BackupListing>> {
    let list = client()
        .await?
        .backup_list_s3()
        .await
        .map_err(|e| hql_err("backup_list_s3", e))?;
    Ok(list
        .into_iter()
        .map(|b| BackupListing {
            name: b.name,
            last_modified: b.last_modified,
            size: b.size.map(|s| s as i64),
        })
        .collect())
}
