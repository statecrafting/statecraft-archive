// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/124-opc-factory-run-platform-integration/spec.md — §5, T005

//! Cache-root layout helper.
//!
//! Spec 124 §5 mandates per-run materialisation under
//! `$XDG_CACHE_HOME/oap-factory/<short_run_sha>/`. The directory mirrors the
//! legacy in-tree layout (`adapters/<name>/...`, `process/...`,
//! `contract/...`) so `factory-engine`'s existing `factory_root` config
//! keeps working unchanged once the desktop hands it the cache path.
//!
//! This module is path-shaping only — file I/O lives in Phase 4
//! `materialise_run_root` (T043).

use crate::SourceShas;
use std::path::PathBuf;

/// Default fallback when neither `XDG_CACHE_HOME` nor `dirs::cache_dir()` is
/// available. Documented separately so tests can pin against it.
const FALLBACK_CACHE_DIR: &str = ".cache";

/// Length of the short SHA prefix used for the cache directory name. Twelve
/// hex chars = 48 bits of entropy — collision-resistant at developer-machine
/// scale (millions of runs would still see < 0.1 % collision probability).
/// Beyond that, contents are content-addressed so a collision would
/// materialise identical files (the rename-into-place path in T043 makes
/// repeat materialisation idempotent).
pub const SHORT_SHA_LEN: usize = 12;

/// Compute the per-run cache root for the given `source_shas`.
///
/// Layout:
///
/// ```text
/// $XDG_CACHE_HOME/oap-factory/<short_run_sha>/
///                             ├── adapters/<name>/manifest.yaml
///                             ├── adapters/<name>/agents/...
///                             ├── adapters/<name>/patterns/...
///                             ├── process/agents/<role>.md
///                             ├── process/stages/...
///                             └── contract/<name>.schema.json
/// ```
///
/// Falls back to `dirs::cache_dir()` (which respects `XDG_CACHE_HOME` on
/// Linux and uses the platform-native cache dir on macOS / Windows) and
/// finally to `~/.cache/` — matching the spec 124 §5 documented contract
/// without forcing every test to set `XDG_CACHE_HOME`.
pub fn cache_root_for(shas: &SourceShas) -> PathBuf {
    let base = base_cache_dir();
    let short = short_sha(shas);
    base.join("oap-factory").join(short)
}

/// Test-visible: derive the short SHA prefix used in the cache directory
/// name. Pure function — no environment access. Useful in unit tests that
/// assert a specific hex prefix without depending on the global cache dir.
pub fn short_sha(shas: &SourceShas) -> String {
    let full = shas.run_sha();
    full[..SHORT_SHA_LEN].to_string()
}

/// Resolve the base cache directory respecting:
///
/// 1. `XDG_CACHE_HOME` (explicit override — also respected by `dirs::cache_dir`
///    on Linux but not all platforms; we honour it everywhere for test parity).
/// 2. `dirs::cache_dir()` (platform-native cache root).
/// 3. `~/.cache` (fallback when nothing else resolves).
///
/// Final fallback is the relative path `.cache/` — never reached in
/// practice but keeps the function infallible.
fn base_cache_dir() -> PathBuf {
    if let Ok(explicit) = std::env::var("XDG_CACHE_HOME")
        && !explicit.is_empty()
    {
        return PathBuf::from(explicit);
    }
    if let Some(native) = dirs::cache_dir() {
        return native;
    }
    if let Some(home) = dirs::home_dir() {
        return home.join(FALLBACK_CACHE_DIR);
    }
    PathBuf::from(FALLBACK_CACHE_DIR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AgentRef, source_shas_from_pairs};
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    // The two tests below mutate `XDG_CACHE_HOME`. Rust 2024 marks
    // `set_var` unsafe precisely because cargo's default parallel test
    // execution makes the writes race; serialise them through a single
    // process-local mutex so the assertions remain deterministic.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn fixture() -> SourceShas {
        SourceShas {
            adapter: "ada".into(),
            process: "proc".into(),
            contracts: BTreeMap::from_iter([("c1".to_string(), "h1".to_string())]),
            agents: vec![AgentRef {
                org_agent_id: "a-1".into(),
                version: 1,
                content_hash: "h-1".into(),
            }],
        }
    }

    #[test]
    fn cache_root_uses_xdg_cache_home_when_set() {
        let _guard = ENV_LOCK.lock().unwrap();
        // SAFETY: ENV_LOCK serialises every env-mutating test in this
        // module so the read below cannot race a concurrent set_var.
        unsafe {
            std::env::set_var("XDG_CACHE_HOME", "/tmp/oap-test-cache");
        }
        let shas = fixture();
        let path = cache_root_for(&shas);
        assert!(
            path.starts_with("/tmp/oap-test-cache/oap-factory/"),
            "expected /tmp/oap-test-cache/oap-factory/<short>/, got {:?}",
            path
        );
        let last = path
            .file_name()
            .and_then(|s| s.to_str())
            .expect("trailing path component");
        assert_eq!(last.len(), SHORT_SHA_LEN);
        assert!(last.chars().all(|c| c.is_ascii_hexdigit()));
        unsafe {
            std::env::remove_var("XDG_CACHE_HOME");
        }
    }

    #[test]
    fn cache_root_layout_matches_documented_shape() {
        let _guard = ENV_LOCK.lock().unwrap();
        // Even without XDG_CACHE_HOME the path's tail must be
        // `oap-factory/<short>` so the materialiser can rely on the
        // segment positions when laying out adapters/process/contract.
        // SAFETY: ENV_LOCK above prevents a parallel set_var.
        unsafe {
            std::env::set_var("XDG_CACHE_HOME", "/tmp/oap-test-cache-2");
        }
        let shas = fixture();
        let path = cache_root_for(&shas);
        let segments: Vec<&str> = path.iter().filter_map(|s| s.to_str()).collect();
        let n = segments.len();
        assert!(n >= 2, "path must contain at least two segments");
        assert_eq!(segments[n - 2], "oap-factory");
        assert_eq!(segments[n - 1].len(), SHORT_SHA_LEN);
        unsafe {
            std::env::remove_var("XDG_CACHE_HOME");
        }
    }

    #[test]
    fn short_sha_prefix_is_stable_across_calls() {
        let s1 = source_shas_from_pairs("a", "p", [], vec![]);
        let s2 = source_shas_from_pairs("a", "p", [], vec![]);
        assert_eq!(short_sha(&s1), short_sha(&s2));
    }

    #[test]
    fn short_sha_differs_when_inputs_differ() {
        let s1 = source_shas_from_pairs("a", "p", [], vec![]);
        let s2 = source_shas_from_pairs("a", "DIFFERENT", [], vec![]);
        // Cryptographically extremely unlikely to collide on the prefix.
        assert_ne!(short_sha(&s1), short_sha(&s2));
    }
}
