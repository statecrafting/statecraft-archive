// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/115-knowledge-extraction-pipeline/spec.md (FR-027 legacy
//   transition); specs/120-factory-extraction-stage/spec.md (library API).

//! Legacy CLI wrapper around the spec-120 deterministic library.
//!
//! Walks `<root>/.artifacts/raw/`, runs `extract_deterministic` per file,
//! writes one `ExtractionOutput` JSON per file to
//! `<root>/.artifacts/extracted/<basename>.json`, and emits a JSONL summary
//! on stdout matching the contract that statecraft's
//! `advanceKnowledgeToExtracted` endpoint (`api/projects/projectKnowledge.ts`)
//! parses. The endpoint is gated on `STATECRAFT_EXTRACT_LEGACY_TRANSITION`
//! (spec 115 FR-027) — modern flow goes through the content-addressed
//! `POST .../extraction-output` endpoint introduced by spec 120.
//!
//! Per-file event:
//!   {"kind":"file","path":"<basename>","status":"<ok|error|skip-unsupported>","message":"..."}
//! Final event:
//!   {"kind":"summary","ok":N,"cached":N,"error":N,"skip_unsupported":N}

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use artifact_extract::{
    DETERMINISTIC_TEXT_MIMES, DOCX_MIME, ExtractError, PDF_MIME, extract_deterministic,
};
use serde_json::json;

fn main() -> ExitCode {
    let mut root = PathBuf::from(".");
    let mut raw_override: Option<PathBuf> = None;
    let mut out_override: Option<PathBuf> = None;
    let mut json_mode = false;
    // `--force` is accepted for backwards compatibility with the pre-spec-120
    // CLI; this shim always re-extracts (no cache layer).
    let mut _force = false;

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--root" => {
                root = PathBuf::from(args.next().unwrap_or_else(|| ".".into()));
            }
            "--raw" => raw_override = args.next().map(PathBuf::from),
            "--out" => out_override = args.next().map(PathBuf::from),
            "--json" => json_mode = true,
            "--force" => _force = true,
            "--quiet" => {}
            "--help" | "-h" => {
                eprintln!(
                    "artifact-extract --root <DIR> [--raw <DIR>] [--out <DIR>] [--json] [--force]"
                );
                return ExitCode::SUCCESS;
            }
            other => {
                eprintln!("artifact-extract: unknown argument {other}");
                return ExitCode::from(2);
            }
        }
    }

    if !json_mode {
        eprintln!("artifact-extract: --json is required (legacy text mode is removed; spec 120)");
        return ExitCode::from(2);
    }

    let raw_dir = raw_override.unwrap_or_else(|| root.join(".artifacts/raw"));
    let out_dir = out_override.unwrap_or_else(|| root.join(".artifacts/extracted"));

    if let Err(e) = std::fs::create_dir_all(&out_dir) {
        eprintln!("artifact-extract: cannot create out dir {:?}: {e}", out_dir);
        return ExitCode::FAILURE;
    }

    let entries = match std::fs::read_dir(&raw_dir) {
        Ok(it) => it,
        Err(e) => {
            // Empty raw dir is not an error — emit a zero summary so the
            // caller can distinguish "nothing to do" from a failure.
            if e.kind() == std::io::ErrorKind::NotFound {
                emit_summary(0, 0, 0, 0);
                return ExitCode::SUCCESS;
            }
            eprintln!("artifact-extract: cannot read raw dir {:?}: {e}", raw_dir);
            return ExitCode::FAILURE;
        }
    };

    let mut ok = 0u64;
    let mut errored = 0u64;
    let mut skipped = 0u64;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let basename = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();

        let mime = sniff_mime(&path);
        match extract_deterministic(&path, &mime) {
            Ok(output) => {
                let dst = out_dir.join(format!("{basename}.json"));
                match serde_json::to_vec_pretty(&output)
                    .map_err(|e| e.to_string())
                    .and_then(|b| std::fs::write(&dst, b).map_err(|e| e.to_string()))
                {
                    Ok(()) => {
                        ok += 1;
                        emit_file(&basename, "ok", "");
                    }
                    Err(e) => {
                        errored += 1;
                        emit_file(&basename, "error", &format!("write failed: {e}"));
                    }
                }
            }
            Err(ExtractError::RequiresAgent { reason, .. }) => {
                skipped += 1;
                emit_file(&basename, "skip-unsupported", &reason);
            }
            Err(e) => {
                errored += 1;
                emit_file(&basename, "error", &e.to_string());
            }
        }
    }

    emit_summary(ok, 0, errored, skipped);
    ExitCode::SUCCESS
}

fn sniff_mime(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    let mime: &str = match ext.as_deref() {
        Some("txt") | Some("log") | Some("text") => "text/plain",
        Some("md") | Some("markdown") => "text/markdown",
        Some("json") => "application/json",
        Some("csv") => "text/csv",
        Some("pdf") => PDF_MIME,
        Some("docx") => DOCX_MIME,
        // Anything else hands back to the library which returns
        // RequiresAgent → reported as `skip-unsupported`.
        _ => "application/octet-stream",
    };
    debug_assert!(
        !matches!(ext.as_deref(), Some("txt") | Some("log") | Some("text"))
            || DETERMINISTIC_TEXT_MIMES.contains(&mime),
        "text mime drifted from DETERMINISTIC_TEXT_MIMES",
    );
    mime.to_string()
}

fn emit_file(path: &str, status: &str, message: &str) {
    println!(
        "{}",
        json!({"kind": "file", "path": path, "status": status, "message": message})
    );
}

fn emit_summary(ok: u64, cached: u64, error: u64, skip_unsupported: u64) {
    println!(
        "{}",
        json!({
            "kind": "summary",
            "ok": ok,
            "cached": cached,
            "error": error,
            "skip_unsupported": skip_unsupported,
        })
    );
}
