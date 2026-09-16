// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §2.6 step 5, §3 FR-008

//! Output-artifact hashing for the K8s sandbox backend.
//!
//! Spec 162 §FR-008 binds the certificate to the SHA-256 of every
//! per-execution output artifact. This module produces a stable
//! `(sandbox-mount-relative-path → sha256-hex)` map from a tar stream
//! representing the output emptyDir contents. The tar stream is
//! produced by `kube::Api::<Pod>::exec`-ing `tar c /out` inside the
//! per-execution container during cleanup.
//!
//! The hashing is performed in pure Rust against an in-memory byte
//! slice or a streaming reader; no kube-rs dependency here. The
//! `lifecycle.rs` consumer is responsible for shuttling bytes from
//! the cluster.

use std::collections::BTreeMap;
use std::io::Read;

use sha2::{Digest, Sha256};

/// Parse a tar stream and hash each contained file. Returns a
/// `(path → hex(sha256))` map.
///
/// Paths are normalised: the leading `/out/` prefix is stripped (so
/// `output_artifact_hashes` keys are relative to the writable mount
/// root, matching spec 162's mount-relative convention). Directories
/// and zero-length entries are skipped.
pub(crate) fn hash_tar_stream<R: Read>(
    reader: R,
) -> Result<BTreeMap<String, String>, std::io::Error> {
    let mut archive = tar::Archive::new(reader);
    let mut out = BTreeMap::new();
    for entry in archive.entries()? {
        let mut entry = entry?;
        let header = entry.header();
        // Skip everything that's not a regular file. We hash file
        // contents only; directory entries / symlinks / hard-links
        // are out of scope for FU-002 (input handling) and would
        // require a content-vs-link distinction the cert verifier
        // does not currently model.
        if header.entry_type() != tar::EntryType::Regular {
            continue;
        }
        let path = entry.path()?.to_string_lossy().to_string();
        let normalised = normalise_path(&path);
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        let hex = sha256_hex(&buf);
        out.insert(normalised, hex);
    }
    Ok(out)
}

/// SHA-256 over the byte slice; hex output, lowercase. Used by tests
/// to verify the hashing wire format; the lifecycle consumer goes
/// through [`hash_tar_stream`].
pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let digest = h.finalize();
    let mut s = String::with_capacity(64);
    for b in digest.iter() {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// Normalise an in-archive path against the spec 162 mount-relative
/// convention. GNU tar / busybox tar emit `out/...` (the leading `/`
/// is stripped from the on-disk path when archiving). Strip the
/// `out/` prefix and re-prepend a single leading `/` so the resulting
/// key is the in-Pod path relative to the writable mount root. Paths
/// without that prefix pass through unchanged.
fn normalise_path(p: &str) -> String {
    if let Some(stripped) = p.strip_prefix("out/") {
        format!("/{}", stripped.trim_start_matches('/'))
    } else {
        p.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_tar(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut buf);
            for (path, content) in entries {
                let mut header = tar::Header::new_gnu();
                header.set_size(content.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                builder
                    .append_data(&mut header, path, *content)
                    .expect("tar append");
            }
            builder.finish().expect("tar finish");
        }
        buf
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        // RFC 6234 §8.5 hash of "abc" (and well-known beyond).
        let hex = sha256_hex(b"abc");
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hash_tar_stream_hashes_each_regular_file() {
        let tar_bytes = make_tar(&[("out/a.txt", b"hello"), ("out/b.bin", &[1, 2, 3, 4])]);
        let map = hash_tar_stream(&tar_bytes[..]).unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(map.get("/a.txt").unwrap(), &sha256_hex(b"hello"));
        assert_eq!(map.get("/b.bin").unwrap(), &sha256_hex(&[1, 2, 3, 4]));
    }

    #[test]
    fn hash_tar_stream_normalises_leading_out_prefix() {
        let tar_bytes = make_tar(&[
            ("out/nested/x", b"x"),
            ("out/sibling/y", b"y"),
            ("z-no-prefix", b"z"),
        ]);
        let map = hash_tar_stream(&tar_bytes[..]).unwrap();
        // out/-prefixed paths get a leading slash and stripped prefix.
        assert!(map.contains_key("/nested/x"));
        assert!(map.contains_key("/sibling/y"));
        // Paths without the prefix pass through unchanged.
        assert!(map.contains_key("z-no-prefix"));
    }

    #[test]
    fn hash_tar_stream_returns_sorted_map() {
        let tar_bytes = make_tar(&[
            ("out/z.bin", b"z"),
            ("out/a.bin", b"a"),
            ("out/m.bin", b"m"),
        ]);
        let map = hash_tar_stream(&tar_bytes[..]).unwrap();
        let keys: Vec<&String> = map.keys().collect();
        assert_eq!(keys, vec!["/a.bin", "/m.bin", "/z.bin"]);
    }

    #[test]
    fn hash_tar_stream_skips_directories() {
        let mut buf = Vec::new();
        {
            let mut b = tar::Builder::new(&mut buf);
            // Directory entry, then a regular file underneath.
            let mut dir = tar::Header::new_gnu();
            dir.set_entry_type(tar::EntryType::Directory);
            dir.set_size(0);
            dir.set_mode(0o755);
            dir.set_cksum();
            b.append_data(&mut dir, "out/d/", std::io::empty()).unwrap();
            let mut file = tar::Header::new_gnu();
            file.set_size(3);
            file.set_mode(0o644);
            file.set_cksum();
            b.append_data(&mut file, "out/d/f", &b"abc"[..]).unwrap();
            b.finish().unwrap();
        }
        let map = hash_tar_stream(&buf[..]).unwrap();
        assert_eq!(map.len(), 1);
        assert!(map.contains_key("/d/f"));
    }
}
