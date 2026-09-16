// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Hiqlite database initialisation and schema migrations for axiomregent.
//!
//! Call [`init_hiqlite`] once at startup to obtain a [`hiqlite::Client`] with
//! all tables created. The node runs in single-node mode (no real Raft peers)
//! and is strictly local — suitable for a desktop agent process.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use hiqlite::{Client, Node, NodeConfig};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/// DDL statements executed in order at startup (all idempotent).
const SCHEMA_SQL: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        repo_root     TEXT NOT NULL,
        parent_id     TEXT,
        label         TEXT,
        head_sha      TEXT,
        fingerprint   TEXT NOT NULL,
        state_hash    TEXT NOT NULL,
        merkle_root   TEXT NOT NULL,
        file_count    INTEGER NOT NULL,
        total_bytes   INTEGER NOT NULL,
        created_at    TEXT NOT NULL,
        metadata      TEXT,
        project_id    TEXT,
        branch_name   TEXT,
        run_id        TEXT
    )"#,
    r#"CREATE TABLE IF NOT EXISTS manifest_entries (
        checkpoint_id TEXT NOT NULL,
        path          TEXT NOT NULL,
        blob_hash     TEXT NOT NULL,
        size_bytes    INTEGER NOT NULL,
        permissions   INTEGER,
        PRIMARY KEY (checkpoint_id, path)
    )"#,
    r#"CREATE TABLE IF NOT EXISTS blob_refs (
        blob_hash   TEXT PRIMARY KEY,
        ref_count   INTEGER NOT NULL DEFAULT 1,
        size_bytes  INTEGER NOT NULL,
        compression TEXT NOT NULL DEFAULT 'lz4'
    )"#,
    r#"CREATE TABLE IF NOT EXISTS leases (
        lease_id      TEXT PRIMARY KEY,
        repo_root     TEXT NOT NULL,
        fingerprint   TEXT NOT NULL,
        touched_files TEXT NOT NULL,
        grants        TEXT NOT NULL,
        issued_at     TEXT NOT NULL,
        expires_at    TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS runs (
        run_id       TEXT PRIMARY KEY,
        skill_name   TEXT NOT NULL,
        repo_root    TEXT NOT NULL,
        status       TEXT NOT NULL,
        exit_code    INTEGER,
        log_path     TEXT,
        started_at   TEXT NOT NULL,
        completed_at TEXT
    )"#,
    r#"CREATE TABLE IF NOT EXISTS embeddings (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name  TEXT NOT NULL,
        file_path     TEXT NOT NULL,
        block_type    TEXT NOT NULL,
        function_name TEXT,
        code_content  TEXT NOT NULL,
        vector        BLOB NOT NULL,
        call_edges    TEXT,
        indexed_at    TEXT NOT NULL
    )"#,
    "CREATE INDEX IF NOT EXISTS idx_embeddings_project ON embeddings(project_name)",
    r#"CREATE TABLE IF NOT EXISTS audit_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name       TEXT NOT NULL,
        tier            INTEGER NOT NULL,
        repo_root       TEXT,
        lease_id        TEXT,
        policy_decision TEXT,
        timestamp       TEXT NOT NULL,
        metadata        TEXT
    )"#,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Bounded retries around the resolve-ports → `start_node` window. Because
/// hiqlite has no fd-passing API, ports are resolved by binding `:0`, reading
/// the assigned number, releasing, and handing the concrete port to hiqlite to
/// rebind. Another process can claim a freed port in that narrow window
/// (TOCTOU); when that happens hiqlite's own bind fails, so we re-resolve a
/// fresh pair and try again rather than surfacing a transient bind race as a
/// hard startup error.
const HIQLITE_BIND_ATTEMPTS: u32 = 3;

/// Initialise a single-node hiqlite instance rooted at `data_dir`.
///
/// The database file is `axiomregent.db` inside `data_dir`. All schema tables
/// are created (idempotently) before the client is returned.
pub async fn init_hiqlite(data_dir: &Path) -> Result<Client> {
    // Stabilise the node's loopback address across restarts BEFORE starting.
    // hiqlite/openraft freezes the node's raft+api ports in committed
    // membership at first init and reloads them on every restart; the
    // in-process API client dials the committed `addr_api` for its background
    // WS stream. So the ports MUST stay the same across restarts. Resolving a
    // FRESH ephemeral pair each start (the original concrete-port fix) leaves
    // the committed port and the bound port diverged after the first run — the
    // client then floods stderr dialing the stale committed port
    // (`Connection refused`, os error 61), the same reconnect flood the `:0`
    // fix targeted, one layer in. We persist the resolved pair in a sidecar and
    // REUSE it every start (so NodeConfig.addr_api always equals committed
    // membership); a pre-stability store with no sidecar — including a pre-fix
    // `:0` store — is moved aside for a clean fresh init. Best-effort: a heal
    // *check* failure (e.g. a permission error) must not block startup.
    if let Err(e) = heal_unstable_membership(data_dir) {
        log::warn!("init_hiqlite: unstable-membership self-heal check failed (continuing): {e}");
    }
    // Created up front so the ports sidecar can be written before `start_node`,
    // closing the crash window between a fresh init and its first persist.
    std::fs::create_dir_all(data_dir)?;

    let data_dir_str = data_dir.to_string_lossy().to_string();

    // hiqlite records the node address in its Raft membership and the
    // in-process client dials `addr_api` for its background WS stream. Reuse
    // the persisted pair for an existing store (it matches committed
    // membership); for a pristine store resolve a fresh pair the same way
    // `main.rs` resolves the probe port (bind `:0` → read `local_addr` →
    // release) and persist it so the NEXT restart reuses the same address. A
    // lost bind race re-resolves rather than failing startup (see
    // HIQLITE_BIND_ATTEMPTS).
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 1..=HIQLITE_BIND_ATTEMPTS {
        let reused = read_persisted_ports(data_dir);
        let (raft_port, api_port) = match reused {
            Some(pair) => pair,
            None => {
                let pair = free_loopback_pair()?;
                // Persist BEFORE start_node and abort on failure — see
                // `persist_ports`: an initialised store with no sidecar is moved
                // aside on the next boot, so we must not commit membership we
                // cannot pair with a durable sidecar.
                persist_ports(data_dir, pair.0, pair.1)?;
                pair
            }
        };

        let config = NodeConfig {
            node_id: 1,
            nodes: vec![Node {
                id: 1,
                addr_raft: format!("127.0.0.1:{raft_port}"),
                addr_api: format!("127.0.0.1:{api_port}"),
            }],
            data_dir: data_dir_str.clone().into(),
            filename_db: "axiomregent.db".into(),
            secret_raft: "axiomregent-raft-00".into(),
            secret_api: "axiomregent-api-000".into(),
            log_statements: false,
            ..NodeConfig::default()
        };

        match hiqlite::start_node(config).await {
            Ok(client) => {
                // migrate stays outside the retry: a DDL error is a real
                // failure to propagate, not a bind race to retry.
                migrate(&client).await?;
                return Ok(client);
            }
            Err(e) => {
                log::warn!(
                    "init_hiqlite: start_node bind attempt {attempt}/{HIQLITE_BIND_ATTEMPTS} failed: {e}"
                );
                // The chosen port pair would not bind. Drop the (now-suspect)
                // sidecar so the next attempt re-resolves a fresh pair. If we
                // were REUSING a committed store's port, that port is taken —
                // move the store aside so its frozen membership can't re-flood,
                // then recreate the dir for a clean fresh init next attempt.
                let _ = std::fs::remove_file(ports_sidecar_path(data_dir));
                if reused.is_some() {
                    // Surface a rename failure (read-only / cross-device dir):
                    // without this the loop retries the same unmovable store and
                    // the propagated error would be the bind error, hiding the
                    // real cause.
                    if let Err(heal_err) = heal_unstable_membership(data_dir) {
                        log::warn!(
                            "init_hiqlite: could not move aside the committed store after a \
                             bind failure on its persisted port: {heal_err}"
                        );
                    }
                    if let Err(mk_err) = std::fs::create_dir_all(data_dir) {
                        log::warn!(
                            "init_hiqlite: could not recreate data dir after move-aside: {mk_err}"
                        );
                    }
                }
                last_err = Some(e.into());
            }
        }
    }
    Err(last_err
        .unwrap_or_else(|| anyhow::anyhow!("init_hiqlite: exhausted bind attempts")))
}

/// Resolve two distinct free loopback ports. Both listeners are held until
/// both numbers have been read so the OS cannot hand the same port to the
/// raft and api listeners; both are then released for hiqlite to rebind.
fn free_loopback_pair() -> Result<(u16, u16)> {
    let raft = std::net::TcpListener::bind("127.0.0.1:0")?;
    let api = std::net::TcpListener::bind("127.0.0.1:0")?;
    Ok((raft.local_addr()?.port(), api.local_addr()?.port()))
    // both listeners drop here, freeing the ports for hiqlite to rebind
}

// ---------------------------------------------------------------------------
// Stable loopback ports + membership self-heal (spec 183 §3.8)
// ---------------------------------------------------------------------------

/// Sidecar file (inside the data dir) recording the concrete loopback ports a
/// store was initialised with. It is the mechanism that keeps the node address
/// STABLE across restarts: hiqlite/openraft freezes the node's address in
/// committed membership at first init, and the in-process API client dials that
/// frozen `addr_api` forever. Persisting the pair and reusing it every start is
/// what guarantees `NodeConfig.addr_api == committed addr_api`, so the client
/// never floods dialing a stale port. hiqlite ignores unknown entries in its
/// data dir, so co-locating the sidecar there is safe.
const PORTS_SIDECAR: &str = ".opc-hiqlite-ports.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct PersistedPorts {
    raft: u16,
    api: u16,
}

fn ports_sidecar_path(data_dir: &Path) -> PathBuf {
    data_dir.join(PORTS_SIDECAR)
}

/// Read the persisted `(raft, api)` pair, if a well-formed sidecar exists. A
/// degenerate pair (a zero port or both ports collapsed onto one) reads as
/// absent, so init resolves a fresh connectable pair rather than re-advertising
/// an unconnectable address.
fn read_persisted_ports(data_dir: &Path) -> Option<(u16, u16)> {
    let bytes = std::fs::read(ports_sidecar_path(data_dir)).ok()?;
    let p: PersistedPorts = serde_json::from_slice(&bytes).ok()?;
    if p.raft == 0 || p.api == 0 || p.raft == p.api {
        return None;
    }
    Some((p.raft, p.api))
}

/// Persist the resolved port pair so the next restart reuses the same address.
///
/// **Propagated, not best-effort.** The caller writes the sidecar *before*
/// `start_node` and aborts on failure, because the invariant "an initialised
/// store always has a ports sidecar" is load-bearing: a store with committed
/// raft membership but no sidecar is indistinguishable from a pre-stability
/// store, so the next boot's `heal_unstable_membership` would move it aside —
/// silently losing a live checkpoint cache. Failing the init loudly (the boot
/// gate surfaces it) is strictly safer than bringing up a node that is one
/// restart away from discarding its store.
fn persist_ports(data_dir: &Path, raft: u16, api: u16) -> Result<()> {
    let path = ports_sidecar_path(data_dir);
    let bytes =
        serde_json::to_vec(&PersistedPorts { raft, api }).context("serialise hiqlite ports sidecar")?;
    std::fs::write(&path, bytes)
        .with_context(|| format!("write hiqlite ports sidecar {}", path.display()))?;
    Ok(())
}

/// Move aside a data dir whose committed membership cannot be safely reused, so
/// the next init starts fresh with a stable, persisted port pair.
///
/// One remedy covers every pre-stability store:
///   * Pre-fix `:0` stores — committed `127.0.0.1:0`, never connectable.
///   * Pre-stability stores — initialised by a binary that resolved a fresh
///     ephemeral port each start and never persisted it, so the committed
///     concrete port is stale on the next restart and the in-process client
///     floods dialing it (`os error 61`).
///
/// Both are exactly the stores that are *initialised but carry no ports
/// sidecar*. A store written by the current binary carries a sidecar (stable
/// ports) and is left untouched; a pristine/absent dir is left untouched (a
/// fresh init follows). The dir is renamed to a numbered sibling — preserved,
/// not deleted, since the local store is a regenerable checkpoint/cache (spec
/// 041) — but never destroyed unilaterally.
fn heal_unstable_membership(data_dir: &Path) -> Result<()> {
    if !data_dir.exists() || !dir_is_initialized(data_dir) {
        return Ok(()); // pristine or absent — nothing committed to diverge yet
    }
    if read_persisted_ports(data_dir).is_some() {
        return Ok(()); // current-binary store with stable persisted ports
    }
    let aside = next_available_sibling(data_dir, "prestable-corrupt");
    log::warn!(
        "init_hiqlite: data dir {} is initialised but has no ports sidecar (a \
         pre-stability store whose committed loopback port is stale on restart — \
         the cause of the 127.0.0.1:<port> reconnect flood). Moving it aside to \
         {} and starting a fresh store with a stable, persisted port pair. The \
         old store is preserved (renamed, not deleted) and can be recovered \
         manually.",
        data_dir.display(),
        aside.display(),
    );
    std::fs::rename(data_dir, &aside)?;
    Ok(())
}

/// True if the raft control-plane holds committed state — i.e. any log *or
/// snapshot* file exists. Scans the log + snapshot dirs (never the SQLite
/// state-machine db, whose user data is irrelevant to "is there committed
/// membership"). The snapshot dirs are included so a log-compacted store
/// (logs purged, membership now in the snapshot) is still recognised — missing
/// it would let a fresh init resolve a port that diverges from the snapshot's
/// committed address and reintroduce the flood. A real *file* is required, not
/// merely a directory entry, so a half-created empty subdir from an interrupted
/// init does not read as "initialised".
fn dir_is_initialized(data_dir: &Path) -> bool {
    const CONTROL_PLANE: &[&str] = &[
        "logs",
        "logs_cache",
        "state_machine/snapshots",
        "state_machine_cache/snapshots",
    ];
    CONTROL_PLANE
        .iter()
        .any(|sub| dir_contains_file(&data_dir.join(sub)))
}

/// True if `dir` contains at least one regular file (recursively). A missing or
/// unreadable directory reads as "no file" — it cannot hold committed state.
fn dir_contains_file(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if dir_contains_file(&path) {
                return true;
            }
        } else {
            return true;
        }
    }
    false
}

/// First non-existing `<data_dir>.<suffix>[.N]` sibling, so repeated heals on
/// successive launches never clobber a previously-preserved store.
fn next_available_sibling(data_dir: &Path, suffix: &str) -> PathBuf {
    let stem = data_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("data");
    let first = data_dir.with_file_name(format!("{stem}.{suffix}"));
    if !first.exists() {
        return first;
    }
    (1u32..)
        .map(|n| data_dir.with_file_name(format!("{stem}.{suffix}.{n}")))
        .find(|p| !p.exists())
        .expect("an unused sibling name exists")
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/// Run all DDL migrations. Every statement is idempotent (`IF NOT EXISTS`).
async fn migrate(client: &Client) -> Result<()> {
    for ddl in SCHEMA_SQL {
        client.execute(Cow::Borrowed(*ddl), vec![]).await?;
    }

    // Additive column migrations — best-effort: SQLite returns an error when
    // the column already exists, so we ignore "duplicate column" failures.
    let additive: &[&str] = &[
        "ALTER TABLE checkpoints ADD COLUMN project_id TEXT",
        "ALTER TABLE checkpoints ADD COLUMN branch_name TEXT",
        "ALTER TABLE checkpoints ADD COLUMN run_id TEXT",
    ];
    for ddl in additive {
        let _ = client.execute(Cow::Borrowed(*ddl), vec![]).await;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The raft and api listeners must never collapse onto the same port —
    /// holding both listeners until both numbers are read is what guarantees
    /// it. Regression here would feed hiqlite two identical addresses.
    #[test]
    fn free_loopback_pair_yields_two_distinct_ports() {
        let (raft, api) = free_loopback_pair().expect("loopback binds in test env");
        assert_ne!(raft, 0, "raft port must be a concrete resolved port");
        assert_ne!(api, 0, "api port must be a concrete resolved port");
        assert_ne!(raft, api, "raft and api ports must be distinct");
    }

    // ── Stable persisted ports ───────────────────────────────────────────

    /// Persisting then reading back the pair is the round-trip that keeps the
    /// node address stable across restarts. An absent sidecar reads as None so
    /// a pristine store resolves a fresh pair.
    #[test]
    fn persisted_ports_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            read_persisted_ports(dir.path()),
            None,
            "absent sidecar reads as None",
        );
        persist_ports(dir.path(), 54808, 54809).unwrap();
        assert_eq!(read_persisted_ports(dir.path()), Some((54808, 54809)));
    }

    /// A degenerate pair (a zero port or both ports collapsed onto one) must
    /// read as absent, so init resolves a fresh connectable pair rather than
    /// re-advertising an unconnectable address.
    #[test]
    fn read_persisted_ports_rejects_degenerate() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(ports_sidecar_path(dir.path()), br#"{"raft":0,"api":1}"#).unwrap();
        assert_eq!(read_persisted_ports(dir.path()), None, "a zero port is rejected");
        std::fs::write(ports_sidecar_path(dir.path()), br#"{"raft":5,"api":5}"#).unwrap();
        assert_eq!(
            read_persisted_ports(dir.path()),
            None,
            "collapsed raft==api is rejected",
        );
    }

    // ── Membership self-heal ─────────────────────────────────────────────

    /// An initialised store with NO ports sidecar (a pre-stability store, or a
    /// pre-fix `:0` store) is moved aside so a fresh init can claim a stable
    /// pair — preserved under a numbered sibling, never deleted.
    #[test]
    fn heal_moves_aside_initialised_dir_without_sidecar() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        // A pre-stability layout: committed membership in the raft log, plus a
        // state-machine db that must be preserved, not deleted.
        std::fs::create_dir_all(data.join("logs")).unwrap();
        std::fs::create_dir_all(data.join("state_machine/db")).unwrap();
        std::fs::write(
            data.join("logs/0000000000000001.wal"),
            b"membership 127.0.0.1:52535 node 1",
        )
        .unwrap();
        std::fs::write(data.join("state_machine/db/axiomregent.db"), b"checkpoint rows").unwrap();

        heal_unstable_membership(&data).unwrap();

        assert!(!data.exists(), "the pre-stability store is moved aside");
        let aside = root.path().join("data.prestable-corrupt");
        assert!(aside.exists(), "the old store is preserved under a sibling");
        assert!(
            aside.join("state_machine/db/axiomregent.db").exists(),
            "the preserved store (incl. the state-machine db) is not deleted",
        );
    }

    /// A store written by the current binary carries a ports sidecar and must
    /// be left exactly where it is — moving it would wipe the live checkpoint
    /// cache on every launch.
    #[test]
    fn heal_leaves_dir_with_sidecar_untouched() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        std::fs::create_dir_all(data.join("logs")).unwrap();
        std::fs::write(
            data.join("logs/0000000000000001.wal"),
            b"membership 127.0.0.1:54809 node 1",
        )
        .unwrap();
        persist_ports(&data, 54808, 54809).unwrap();

        heal_unstable_membership(&data).unwrap();

        assert!(data.exists(), "a store with a stable ports sidecar is never moved");
        assert_eq!(read_persisted_ports(&data), Some((54808, 54809)));
    }

    /// A created-but-uninitialised data dir (control-plane dirs present but
    /// holding no committed-state file) is left for a fresh init — heal must
    /// not move a dir with nothing committed, even if an empty subdir exists.
    #[test]
    fn heal_leaves_pristine_dir_untouched() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        std::fs::create_dir_all(data.join("logs/tmp")).unwrap(); // dirs only, no file
        heal_unstable_membership(&data).unwrap();
        assert!(data.exists(), "an empty/uninitialised dir is not moved aside");
    }

    /// A log-compacted store keeps committed membership in the *snapshot* with
    /// the log dir emptied. It must still be recognised as initialised, else a
    /// fresh init would resolve a port that diverges from the snapshot's
    /// committed address and the flood would return.
    #[test]
    fn heal_recognises_a_snapshot_only_store() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        std::fs::create_dir_all(data.join("logs")).unwrap(); // present but emptied (compacted)
        std::fs::create_dir_all(data.join("state_machine/snapshots")).unwrap();
        std::fs::write(
            data.join("state_machine/snapshots/snapshot-1-1-1.snap"),
            b"committed membership 127.0.0.1:54809",
        )
        .unwrap();

        heal_unstable_membership(&data).unwrap();

        assert!(
            !data.exists(),
            "a snapshot-only (log-compacted) store is recognised and moved aside",
        );
        assert!(root.path().join("data.prestable-corrupt").exists());
    }

    /// A missing data dir is not an error and is not created by the heal.
    #[test]
    fn heal_is_a_noop_on_a_fresh_install() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data"); // never created
        heal_unstable_membership(&data).expect("a missing dir is not an error");
        assert!(!data.exists(), "the heal does not create the dir");
    }
}
