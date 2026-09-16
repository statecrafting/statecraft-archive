//! Optional conformance warnings (Feature 006) — does not replace spec-compiler validation.

use open_agentic_spec_types::{
    CONVENTIONAL_CATEGORIES, SHAPE_TABLE, VALID_DOMAINS, split_frontmatter_optional,
};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Warning {
    pub code: &'static str,
    /// Spec 128 §7.1 (amended by spec 147) — severity tier registered at
    /// the W-code's site. `"warning"` participates in `--fail-on-warn`
    /// gating; `"info"` is informational only and is exempt from
    /// fail-on-warn. A future `--fail-on-info` flag may gate info-tier
    /// diagnostics independently. Spec 161 §2.3 / SC-004 added the
    /// `"error"` tier — V-026-equivalent, fails spec-lint unconditionally
    /// (independent of `--fail-on-warn`) so a reserved-role contract
    /// violation cannot be silenced by omitting the gate flag.
    pub severity: &'static str,
    pub path: String,
    pub message: String,
}

fn shape_table_has_kind(kind: &str) -> bool {
    SHAPE_TABLE.iter().any(|(k, _)| *k == kind)
}

fn shape_table_allows(kind: &str, shape: &str) -> bool {
    SHAPE_TABLE
        .iter()
        .any(|(k, shapes)| *k == kind && shapes.contains(&shape))
}

/// Discover `specs/<NNN>-<kebab>/` directories (same shape as spec-compiler).
pub fn feature_spec_dirs(repo_root: &Path) -> std::io::Result<Vec<PathBuf>> {
    let specs = repo_root.join("specs");
    let mut out = Vec::new();
    if !specs.is_dir() {
        return Ok(out);
    }
    for ent in fs::read_dir(&specs)? {
        let p = ent?.path();
        if !p.is_dir() {
            continue;
        }
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if is_feature_dir_name(name) && p.join("spec.md").is_file() {
            out.push(p);
        }
    }
    out.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    Ok(out)
}

fn is_feature_dir_name(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() >= 5 && b[..3].iter().all(|c| c.is_ascii_digit()) && b[3] == b'-'
}

fn is_example_changeset(content: &str) -> bool {
    let head: String = content.chars().take(4096).collect();
    let lower = head.to_lowercase();
    lower.contains("example")
        || lower.contains("illustrates")
        || lower.contains("non-normative template")
}

fn rel(repo_root: &Path, p: &Path) -> String {
    p.strip_prefix(repo_root)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Run all MVP lint rules; warnings are best-effort heuristics (see Feature 006 spec).
pub fn lint_feature_dir(repo_root: &Path, feature_dir: &Path) -> Vec<Warning> {
    let mut w = Vec::new();
    let spec_path = feature_dir.join("spec.md");
    let tasks_path = feature_dir.join("tasks.md");
    let changeset_path = feature_dir.join("execution/changeset.md");
    let verification_path = feature_dir.join("execution/verification.md");

    let spec_raw = match fs::read_to_string(&spec_path) {
        Ok(s) => s,
        Err(_) => return w,
    };

    const VALID_STATUSES: &[&str] = &["draft", "approved", "superseded", "retired"];
    const VALID_IMPLEMENTATIONS: &[&str] =
        &["pending", "in-progress", "complete", "n/a", "deferred"];

    if let Some((fm, _body)) = split_frontmatter_optional(&spec_raw) {
        if let Some(status) = fm.get("status").and_then(|v| v.as_str()) {
            if !VALID_STATUSES.contains(&status) {
                w.push(Warning {
                    code: "W-006",
                    severity: "warning",
                    path: rel(repo_root, &spec_path),
                    message: format!(
                        "status '{}' is not in the canonical enum (draft | active | approved | superseded | retired) per Feature 000",
                        status
                    ),
                });
            }
            // W-002 / W-003 — spec 147 Phase 4 rewired these from prose
            // scans on the body to frontmatter-presence checks. The
            // governance-lifecycle fields (`superseded_by`,
            // `retirement_rationale`) are now KNOWN_KEYS in the spec
            // compiler and carry typed authority; the lint surface
            // checks that authors actually filled them in.
            if status == "superseded" && fm.get("superseded_by").is_none() {
                w.push(Warning {
                    code: "W-002",
                    severity: "warning",
                    path: rel(repo_root, &spec_path),
                    message: "status is superseded but frontmatter is missing `superseded_by:` (spec 147 governance-lifecycle fields)".into(),
                });
            }
            if status == "retired" && fm.get("retirement_rationale").is_none() {
                w.push(Warning {
                    code: "W-003",
                    severity: "warning",
                    path: rel(repo_root, &spec_path),
                    message: "status is retired but frontmatter is missing `retirement_rationale:` (spec 147 governance-lifecycle fields)".into(),
                });
            }
        }
        if let Some(impl_status) = fm.get("implementation").and_then(|v| v.as_str()) {
            if !VALID_IMPLEMENTATIONS.contains(&impl_status) {
                w.push(Warning {
                    code: "W-007",
                    severity: "warning",
                    path: rel(repo_root, &spec_path),
                    message: format!(
                        "implementation '{}' is not in the canonical enum (pending | in-progress | complete | n/a | deferred) per Feature 000",
                        impl_status
                    ),
                });
            }
        }
        // ── Spec 147 — W-130: category value not in conventional vocabulary (info severity) ──
        if let Some(seq) = fm.get("category").and_then(|v| v.as_sequence()) {
            for item in seq {
                let Some(tag) = item.as_str() else {
                    continue;
                };
                if !CONVENTIONAL_CATEGORIES.contains(&tag) {
                    w.push(Warning {
                        code: "W-130",
                        severity: "info",
                        path: rel(repo_root, &spec_path),
                        message: format!(
                            "category value {tag:?} is not in the conventional vocabulary; conventional values: {}",
                            CONVENTIONAL_CATEGORIES.join(", ")
                        ),
                    });
                }
            }
        }
        // ── Spec 147 — W-131: shape value outside the declared (kind, shape) table (warning severity) ──
        if let (Some(kind), Some(shape)) = (
            fm.get("kind").and_then(|v| v.as_str()),
            fm.get("shape").and_then(|v| v.as_str()),
        ) {
            if shape_table_has_kind(kind) && !shape_table_allows(kind, shape) {
                w.push(Warning {
                    code: "W-131",
                    severity: "warning",
                    path: rel(repo_root, &spec_path),
                    message: format!(
                        "shape value {shape:?} is not in the declared (kind, shape) table for kind={kind:?}; novel shape values must trigger an explicit table update per spec 147 §`shape:`"
                    ),
                });
            }
        }
        // ── Spec 179 — V-030 / V-031: `domain:` enum + presence ──
        //
        // V-030 (error): `domain:` present but not in the closed enum.
        //   Re-emitted from spec-lint at the same severity as the
        //   spec-compiler emission so contributors who run the linter
        //   in isolation catch the same violation. Mirrors V-020's
        //   dual-emission posture.
        //
        // V-031 (warning): `domain:` absent from frontmatter. Spec 179
        //   §3.3 stages this at warning severity for Phase 1; a
        //   follow-on amendment promotes to error once the backfilled
        //   corpus is empirically clean.
        match fm.get("domain") {
            None => {
                w.push(Warning {
                    code: "V-031",
                    severity: "warning",
                    path: rel(repo_root, &spec_path),
                    message: format!(
                        "spec frontmatter is missing `domain:` (closed enum: {}); spec 179 establishes the tract-authority lens",
                        VALID_DOMAINS.join(", ")
                    ),
                });
            }
            Some(value) => {
                if let Some(d) = value.as_str() {
                    if !VALID_DOMAINS.contains(&d) {
                        w.push(Warning {
                            code: "V-030",
                            severity: "error",
                            path: rel(repo_root, &spec_path),
                            message: format!(
                                "domain value {d:?} is not in the declared enum; expected one of: {}",
                                VALID_DOMAINS.join(", ")
                            ),
                        });
                    }
                } else {
                    w.push(Warning {
                        code: "V-030",
                        severity: "error",
                        path: rel(repo_root, &spec_path),
                        message: "domain value must be a single string from the closed enum (opc, platform, substrate, tooling); list and mapping forms are not accepted at this version (spec 179)".into(),
                    });
                }
            }
        }

        // ── Spec 130 — V-020: spec lacks relationship fields ──
        //
        // Fires when a spec declares no relationship to code or other specs
        // (none of the eight owning relationships: `establishes`, `extends`,
        // `refines`, `supersedes`, `amends`, `co_authority`, `constrains`;
        // none of the ninth non-owning relationship `references` either)
        // and does not carry the bootstrap marker `origin: retroactive:
        // true`. The relationship fields are the corpus's machine-readable
        // governance model (spec 130, extended to nine edges by spec 154 §4).
        // V-020 prevents new specs from accreting without declaring their
        // relationships. Spec 154 Segment 6 widened the check to include
        // `references:` — a spec whose authority surface has eroded into
        // historical / planned pointers (the post-excision pattern for
        // approved-complete specs whose code paths were refactored away)
        // still declares an honest non-owning relationship.
        let has_relationship_field = [
            "establishes",
            "extends",
            "refines",
            "supersedes",
            "amends",
            "co_authority",
            "constrains",
            "references",
        ]
        .iter()
        .any(|k| fm.get(*k).is_some());

        let is_retroactive_bootstrap = fm
            .get("origin")
            .and_then(|v| v.as_mapping())
            .and_then(|m| m.get("retroactive"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // `superseded_by:` is the inverse pointer to `supersedes:` and
        // is itself a declared relationship — a spec that says "I am
        // superseded by X" has named its place in the graph. Treated
        // as relationship-satisfying alongside the eight ownership
        // edges and `references`. (Segment 6 lift: superseded-spec
        // hygiene becomes consistent across the corpus once the bare-
        // string `establishes:` arm is excised.)
        let is_superseded = fm.get("superseded_by").is_some();

        // `kind: profile` (spec 147) declares its relationships via
        // `composition.requires:` (capability spec ids) and `selects:`
        // (registry → capability bindings). Either is an honest place
        // in the graph — V-020 accepts both as relationship-satisfying
        // for profile specs without forcing a synthetic `references:`
        // block. Spec 147 §`kind: profile` requires `composition.requires`
        // so this check is well-grounded.
        let has_composition_requires = fm
            .get("composition")
            .and_then(|v| v.as_mapping())
            .and_then(|m| m.get("requires"))
            .is_some();
        let has_selects = fm.get("selects").is_some();

        if !has_relationship_field
            && !is_retroactive_bootstrap
            && !is_superseded
            && !has_composition_requires
            && !has_selects
        {
            w.push(Warning {
                code: "V-020",
                severity: "warning",
                path: rel(repo_root, &spec_path),
                message: "spec carries no relationship fields (establishes / extends / refines / supersedes / amends / co_authority / constrains / references) and is not marked `origin: retroactive: true`; declare an honest relationship per spec 130".into(),
            });
        }

        // ── Spec 161 — W-161: decomposition-origin role reservation ──
        //
        // The role `decomposition-origin` is reserved by spec 161 for
        // `references:` entries emitted by the OPC decomposition
        // pipeline (spec 165). Such entries MUST use the `provenance:`
        // arm (spec 156 grammar) and MUST carry `provenance.derived_at:`
        // as a non-empty ISO-8601 timestamp recording when the pipeline
        // read the source artifact. Severity is `error` (SC-004 calls
        // for V-026-equivalent semantics); fails spec-lint
        // unconditionally regardless of `--fail-on-warn`. Hand-authored
        // specs that do not carry the role are unaffected (SC-003).
        check_decomposition_origin_role(&fm, repo_root, &spec_path, &mut w);
    }

    if let Ok(tasks_raw) = fs::read_to_string(&tasks_path) {
        let has_pending_tag = tasks_raw.contains("(pending)");
        for line in tasks_raw.lines() {
            let l = line.trim();
            if l.starts_with("- [x]")
                && l.to_lowercase().contains("(complete)")
                && !verification_path.is_file()
            {
                w.push(Warning {
                    code: "W-001",
                    severity: "warning",
                    path: rel(repo_root, &tasks_path),
                    message: "task marked (complete) but execution/verification.md is missing (Feature 005)".into(),
                });
                break;
            }
        }
        if has_pending_tag && tasks_raw.contains("### ") {
            w.push(Warning {
                code: "W-005",
                severity: "warning",
                path: rel(repo_root, &tasks_path),
                message: "mixed task-state notation: (pending) tags and ### section headings in one tasks.md (Feature 004)".into(),
            });
        }
    }

    if changeset_path.is_file() {
        if let Ok(cs) = fs::read_to_string(&changeset_path) {
            if !is_example_changeset(&cs) && !verification_path.is_file() {
                w.push(Warning {
                    code: "W-004",
                    severity: "warning",
                    path: rel(repo_root, &changeset_path),
                    message: "execution/changeset.md exists but execution/verification.md is missing (Feature 005)".into(),
                });
            }
        }
    }

    w
}

/// Spec 161 §2.1/§2.3 — enforce the `role: decomposition-origin`
/// reservation on `references:` entries. Emits W-161 (severity `error`)
/// in any of these conditions:
///
/// 1. Entry carries `role: decomposition-origin` and uses the `unit:`
///    arm instead of `provenance:` (the role is reserved for entries
///    derived from external sources; in-tree units cannot carry it).
/// 2. Entry carries `role: decomposition-origin` and has neither
///    `unit:` nor `provenance:` (V-025 also fires from spec-compiler;
///    W-161 names the role-specific contract).
/// 3. Entry carries `role: decomposition-origin` and `provenance:` but
///    `provenance.derived_at:` is missing or empty (FR-007).
/// 4. Entry carries `role: decomposition-origin` and a `derived_at:`
///    value that is not a syntactically plausible ISO-8601 date — the
///    check requires a `YYYY-MM-DD` prefix; a full RFC-3339 timestamp
///    is accepted, a bare year or a free-form string is rejected.
///
/// Hand-authored specs that do not carry the role are unaffected
/// (SC-003). The check is keyed on the role string, not on the kind
/// of source artifact — both `kind: knowledge` and
/// `kind: code-fingerprint` entries flow through the same gate.
fn check_decomposition_origin_role(
    fm: &serde_yaml::Value,
    repo_root: &Path,
    spec_path: &Path,
    warnings: &mut Vec<Warning>,
) {
    const RESERVED_ROLE: &str = "decomposition-origin";
    let Some(seq) = fm.get("references").and_then(|v| v.as_sequence()) else {
        return;
    };
    for item in seq {
        let Some(map) = item.as_mapping() else {
            continue;
        };
        let role = map.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if role != RESERVED_ROLE {
            continue;
        }
        let has_unit = map.get("unit").is_some();
        let provenance = map.get("provenance");
        if has_unit {
            warnings.push(Warning {
                code: "W-161",
                severity: "error",
                path: rel(repo_root, spec_path),
                message: format!(
                    "references entry carries `role: {RESERVED_ROLE}` with a `unit:` arm; the role is reserved by spec 161 for `provenance:` entries (knowledge or code-fingerprint sources)"
                ),
            });
            continue;
        }
        let Some(prov_map) = provenance.and_then(|v| v.as_mapping()) else {
            warnings.push(Warning {
                code: "W-161",
                severity: "error",
                path: rel(repo_root, spec_path),
                message: format!(
                    "references entry carries `role: {RESERVED_ROLE}` without a `provenance:` sibling; spec 161 §2.1 requires a populated provenance arm on every decomposition-origin entry"
                ),
            });
            continue;
        };
        let derived_at = prov_map
            .get("derived_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if derived_at.is_empty() {
            warnings.push(Warning {
                code: "W-161",
                severity: "error",
                path: rel(repo_root, spec_path),
                message: format!(
                    "references entry with `role: {RESERVED_ROLE}` is missing `provenance.derived_at:`; spec 161 FR-007 requires an ISO-8601 timestamp recording when the decomposition pipeline read the source"
                ),
            });
            continue;
        }
        if !is_iso8601_date_prefix(derived_at) {
            warnings.push(Warning {
                code: "W-161",
                severity: "error",
                path: rel(repo_root, spec_path),
                message: format!(
                    "references entry with `role: {RESERVED_ROLE}` has `provenance.derived_at: {derived_at:?}` which is not a well-formed ISO-8601 timestamp (expected `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`)"
                ),
            });
        }
    }
}

/// Cheap ISO-8601 well-formedness check: accept any string whose first
/// ten bytes match `YYYY-MM-DD` with ASCII digits, and whose remaining
/// content (if any) starts with `T` followed by digits/colons/period or
/// is exactly empty. Avoids pulling in a date-parsing crate — the goal
/// is to reject obviously wrong values (`"yesterday"`, `"2026"`,
/// `"05/22/2026"`), not to be a complete RFC-3339 validator.
fn is_iso8601_date_prefix(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 10 {
        return false;
    }
    let ok_date = b[..4].iter().all(|c| c.is_ascii_digit())
        && b[4] == b'-'
        && b[5].is_ascii_digit()
        && b[6].is_ascii_digit()
        && b[7] == b'-'
        && b[8].is_ascii_digit()
        && b[9].is_ascii_digit();
    if !ok_date {
        return false;
    }
    if b.len() == 10 {
        return true;
    }
    // Anything beyond the date prefix must begin with `T` (per ISO-8601).
    b[10] == b'T'
}

pub fn lint_repo(repo_root: &Path) -> Vec<Warning> {
    let mut all = Vec::new();
    let dirs = feature_spec_dirs(repo_root).unwrap_or_default();
    for d in &dirs {
        all.extend(lint_feature_dir(repo_root, d));
    }
    all.extend(corpus_lint_pass(repo_root, &dirs));
    all.extend(spec154_l005_pass(repo_root, &dirs));
    all
}

// ─────────────────────────────────────────────────────────────────────
// Spec 154 — L-005 advisory soft lint
// ─────────────────────────────────────────────────────────────────────

/// Discover workspace-member directory paths from the root Cargo.toml.
/// Returns a sorted set of relative directory paths (e.g.
/// `"crates/canonical-json"`, `"tools/spec-spine/spec-lint"`).
/// Empty when the manifest is absent or unparseable.
fn workspace_member_dirs(repo_root: &Path) -> Vec<String> {
    let manifest = repo_root.join("Cargo.toml");
    let Ok(raw) = fs::read_to_string(&manifest) else {
        return Vec::new();
    };
    let Ok(parsed) = raw.parse::<toml::Value>() else {
        return Vec::new();
    };
    let Some(members) = parsed
        .get("workspace")
        .and_then(|w| w.get("members"))
        .and_then(|m| m.as_array())
    else {
        return Vec::new();
    };
    let mut out: Vec<String> = members
        .iter()
        .filter_map(|m| m.as_str().map(String::from))
        .collect();
    out.sort();
    out
}

/// L-005 — corpus-migration enforcement lint. Promoted from `info` to
/// `error` severity by spec 154 Segment 6's explicit-only flip: once
/// the bare-string parse arm is excised from spec-compiler, any
/// remaining bare-string path that resolves into a workspace member
/// must be rewritten as `unit: { kind: crate, id: <manifest-name> }`
/// (spec 154 §3.1). The compat window closed when the corpus migrated
/// to explicit declarations in Tier 2 Segment 5.
///
/// Does not fire on:
///   * explicit `unit: {kind: ...}` declarations (already typed);
///   * paths outside any workspace member directory (legitimate
///     `file:` cases — `Makefile`, `deny.toml`, `standards/...`).
fn spec154_l005_pass(repo_root: &Path, feature_dirs: &[PathBuf]) -> Vec<Warning> {
    let members = workspace_member_dirs(repo_root);
    if members.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<Warning> = Vec::new();
    for d in feature_dirs {
        let spec_path = d.join("spec.md");
        let Ok(raw) = fs::read_to_string(&spec_path) else {
            continue;
        };
        let Some((fm, _)) = split_frontmatter_optional(&raw) else {
            continue;
        };
        let mapping = match fm.as_mapping() {
            Some(m) => m,
            None => continue,
        };
        let mut seen_paths: std::collections::BTreeSet<String> =
            std::collections::BTreeSet::new();
        collect_legacy_paths(mapping, &mut seen_paths);
        for path in &seen_paths {
            if let Some(member) = match_workspace_member(path, &members) {
                out.push(Warning {
                    code: "L-005",
                    severity: "error",
                    path: rel(repo_root, &spec_path),
                    message: format!(
                        "legacy bare-string path {path:?} sits inside workspace member {member:?}; rewrite as `unit: {{ kind: crate, id: <manifest-name> }}` per spec 154 §3.1 (corpus migration completed in Tier 2 Segment 6)",
                    ),
                });
            }
        }
    }
    out
}

/// Walk a frontmatter mapping, collecting every bare-string path that
/// appears in a relationship field (`establishes`, `extends.paths`,
/// `refines.paths`, `co_authority.paths`, `constrains.paths`,
/// `references`). Strings inside explicit `unit:` fields are not
/// collected — they are already typed.
fn collect_legacy_paths(
    fm: &serde_yaml::Mapping,
    out: &mut std::collections::BTreeSet<String>,
) {
    // `establishes:` — array, items are strings or `{unit:...}`/`{kind:...}`.
    if let Some(seq) = fm.get("establishes").and_then(|v| v.as_sequence()) {
        for item in seq {
            if let Some(s) = item.as_str() {
                out.insert(s.to_string());
            }
        }
    }
    // Item-based relationships with legacy `paths:` plural form.
    for key in &["extends", "refines", "supersedes", "co_authority", "constrains"] {
        let Some(seq) = fm.get(*key).and_then(|v| v.as_sequence()) else {
            continue;
        };
        for item in seq {
            let Some(map) = item.as_mapping() else {
                continue;
            };
            if let Some(paths) = map.get("paths").and_then(|v| v.as_sequence()) {
                for p in paths {
                    if let Some(s) = p.as_str() {
                        out.insert(s.to_string());
                    }
                }
            }
        }
    }
    // `references:` — bare strings (legacy / shorthand form).
    if let Some(seq) = fm.get("references").and_then(|v| v.as_sequence()) {
        for item in seq {
            if let Some(s) = item.as_str() {
                out.insert(s.to_string());
            }
        }
    }
}

/// Return the workspace-member directory that contains `path`, if
/// any. `path` is a repo-relative posix path (e.g.
/// `"crates/foo/src/lib.rs"` or `"crates/foo/"`); `members` is the
/// sorted list of workspace-member directory paths.
fn match_workspace_member(path: &str, members: &[String]) -> Option<String> {
    let normalised = path.trim_end_matches('/');
    for m in members {
        if normalised == m {
            return Some(m.clone());
        }
        let prefix = format!("{m}/");
        if normalised.starts_with(&prefix) || path.starts_with(&prefix) {
            return Some(m.clone());
        }
    }
    None
}

/// Spec 147 — corpus-level W-codes that need to see every spec at once.
/// Today this is W-132 (orphan capability surface); future corpus-wide
/// info diagnostics slot in here.
fn corpus_lint_pass(repo_root: &Path, feature_dirs: &[PathBuf]) -> Vec<Warning> {
    let mut out: Vec<Warning> = Vec::new();
    // Collect (spec-id, kind, frontmatter, path) for every spec.
    #[derive(Clone)]
    struct SpecView {
        id: String,
        kind: Option<String>,
        selectable_by: Option<String>,
        selects: Vec<String>, // capability ids selected by a profile, if any
        path: String,
    }
    let mut views: Vec<SpecView> = Vec::new();
    for d in feature_dirs {
        let spec_path = d.join("spec.md");
        let Ok(raw) = fs::read_to_string(&spec_path) else {
            continue;
        };
        let Some((fm, _)) = split_frontmatter_optional(&raw) else {
            continue;
        };
        let id = fm
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let kind = fm.get("kind").and_then(|v| v.as_str()).map(|s| s.to_string());
        let selectable_by = fm
            .get("selectable_by")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let selects: Vec<String> = fm
            .get("selects")
            .and_then(|v| v.as_mapping())
            .map(|m| {
                m.values()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        views.push(SpecView {
            id,
            kind,
            selectable_by,
            selects,
            path: rel(repo_root, &spec_path),
        });
    }

    // W-132 — capability declares `selectable_by:` but no profile spec
    // selects this capability. Surfaces orphan capabilities. Info
    // severity (spec 128 §7.3): not a contract violation.
    let selected_caps: std::collections::BTreeSet<String> = views
        .iter()
        .filter(|s| s.kind.as_deref() == Some("profile"))
        .flat_map(|s| s.selects.iter().cloned())
        .collect();
    for s in &views {
        if s.kind.as_deref() != Some("capability") {
            continue;
        }
        if s.selectable_by.is_none() {
            continue;
        }
        let id_prefix = s.id.split_once('-').map(|(p, _)| p).unwrap_or(s.id.as_str());
        let referenced = selected_caps.iter().any(|c| {
            c == &s.id
                || c == id_prefix
                || c.split_once('-').map(|(p, _)| p).unwrap_or(c.as_str()) == id_prefix
        });
        if !referenced {
            out.push(Warning {
                code: "W-132",
                severity: "info",
                path: s.path.clone(),
                message: format!(
                    "capability {id:?} declares `selectable_by:` but no profile spec selects it; orphan capability (advisory, info-tier)",
                    id = s.id
                ),
            });
        }
    }

    out
}
