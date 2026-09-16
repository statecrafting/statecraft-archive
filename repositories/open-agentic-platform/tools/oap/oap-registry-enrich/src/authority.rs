//! Spec 217 FR-302: the `by-authority` query, re-implemented over the published
//! library's typed [`Registry`] (the in-tree `registry-consumer` that hosted it
//! is deleted in Phase 3).
//!
//! Semantics ported intact from spec 181's `authority_for_path` (and spec 216
//! Phase 2b): by-authority is an EXACT-path query against declared file/directory
//! units (subtree-prefix matching is the coupling gate's concern, not this).
//! Relationship priority per spec is `establishes` > `extends` > `refines` >
//! `co_authority` > `supersedes` (partial). Fully-superseded specs and
//! predecessors partially superseded over the path by a live successor are
//! excluded, so the result is the `authorities(P)` set the gate enforces. This is
//! the function the blast-radius gate (AC-BLAST) diffs before and after the wave.

use std::collections::BTreeSet;

use serde::Serialize;
use spec_spine_types::{
    CoAuthorityItem, ExtendItem, RefineItem, Registry, SpecRecord, Status, SupersedeItem,
    SupersedeScope, Unit,
};

/// One entry in the authority set for a path. Field names match the in-tree
/// `registry-consumer` `AuthorityEntry` so `--json` output is shape-compatible.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuthorityEntry {
    pub spec_id: String,
    /// "establishes" | "extends" | "refines" | "co_authority" | "supersedes".
    pub relationship: String,
}

/// A file/directory unit names exactly `path`. Other unit kinds (symbol, crate,
/// module) are not path-addressable here; `section` is handled by co-authority.
fn unit_matches_path(unit: &Unit, path: &str) -> bool {
    match unit {
        Unit::File { path: p } | Unit::Directory { path: p } => p == path,
        _ => false,
    }
}

/// co_authority match: a `section` unit matches its `file` plus an optional
/// `anchor`; a whole-file/directory unit matches the path (section filter N/A).
fn co_authority_matches(item: &CoAuthorityItem, path: &str, section: Option<&str>) -> bool {
    match &item.unit {
        Unit::Section { file, anchor } => file == path && section.is_none_or(|s| anchor == s),
        Unit::File { path: p } | Unit::Directory { path: p } => p == path,
        _ => false,
    }
}

fn extends_matches(e: &ExtendItem, path: &str) -> bool {
    e.unit.as_ref().is_some_and(|u| unit_matches_path(u, path))
}

fn refines_matches(r: &RefineItem, path: &str) -> bool {
    r.unit.as_ref().is_some_and(|u| unit_matches_path(u, path))
}

/// A `supersedes` item that partially supersedes exactly `path` (a partial item
/// with no unit is a documentary marker and transfers nothing).
fn supersede_partial_matches(item: &SupersedeItem, path: &str) -> bool {
    match item {
        SupersedeItem::Scoped(s) if s.scope == SupersedeScope::Partial => {
            s.unit.as_ref().is_some_and(|u| unit_matches_path(u, path))
        }
        _ => false,
    }
}

/// First relationship (in spec-181 priority order) by which `f` claims `path`.
fn classify(f: &SpecRecord, path: &str, section: Option<&str>) -> Option<&'static str> {
    if f.establishes.iter().any(|u| unit_matches_path(u, path)) {
        return Some("establishes");
    }
    if f.extends.iter().any(|e| extends_matches(e, path)) {
        return Some("extends");
    }
    if f.refines.iter().any(|r| refines_matches(r, path)) {
        return Some("refines");
    }
    if f.co_authority.iter().any(|c| co_authority_matches(c, path, section)) {
        return Some("co_authority");
    }
    if f.supersedes.iter().any(|s| supersede_partial_matches(s, path)) {
        return Some("supersedes");
    }
    None
}

/// The authority set over `specs`, factored out so tests need no full `Registry`.
fn authorities_over(specs: &[SpecRecord], path: &str, section: Option<&str>) -> Vec<AuthorityEntry> {
    // Predecessors partially superseded over `path` by a LIVE successor are
    // removed from the authority set (spec 216 Phase 2b). A dead (superseded)
    // successor transfers no authority, so it does not contribute here.
    let mut superseded_over_path: BTreeSet<String> = BTreeSet::new();
    for f in specs {
        if f.status == Status::Superseded {
            continue;
        }
        for item in &f.supersedes {
            if supersede_partial_matches(item, path) {
                superseded_over_path.insert(item.spec().to_string());
            }
        }
    }

    let mut result: Vec<AuthorityEntry> = Vec::new();
    for f in specs {
        if f.status == Status::Superseded {
            continue; // fully superseded: excluded
        }
        if superseded_over_path.contains(&f.id) {
            continue; // partially superseded over this path by a live successor
        }
        if let Some(rel) = classify(f, path, section) {
            result.push(AuthorityEntry {
                spec_id: f.id.clone(),
                relationship: rel.to_string(),
            });
        }
    }
    result.sort_by(|a, b| a.spec_id.cmp(&b.spec_id));
    result
}

/// The set of specs currently authoritative over `path` (spec 181 / 216 Phase 2b).
pub fn authority_for_path(
    registry: &Registry,
    path: &str,
    section: Option<&str>,
) -> Vec<AuthorityEntry> {
    authorities_over(&registry.specs, path, section)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn specs(json: &str) -> Vec<SpecRecord> {
        serde_json::from_str(json).expect("specs JSON")
    }

    fn ids_rels(entries: &[AuthorityEntry]) -> Vec<(String, String)> {
        entries
            .iter()
            .map(|e| (e.spec_id.clone(), e.relationship.clone()))
            .collect()
    }

    // Required SpecRecord fields minus `status` (each spec sets its own status,
    // so a single status key is present and serde sees no duplicate).
    const BASE: &str = r#""title":"t","created":"2026-01-01","summary":"s""#;

    #[test]
    fn establishes_exact_file_match() {
        let s = specs(&format!(
            r#"[{{"id":"010","status":"approved",{BASE},"specPath":"specs/010/spec.md","establishes":["crates/x/src/lib.rs"]}}]"#
        ));
        assert_eq!(
            ids_rels(&authorities_over(&s, "crates/x/src/lib.rs", None)),
            vec![("010".to_string(), "establishes".to_string())]
        );
        // Exact-path: a child path is NOT matched by a file unit.
        assert!(authorities_over(&s, "crates/x/src/other.rs", None).is_empty());
    }

    #[test]
    fn priority_establishes_over_extends_and_dir_unit() {
        let s = specs(&format!(
            r#"[
              {{"id":"010","status":"approved",{BASE},"specPath":"specs/010/spec.md","establishes":[{{"kind":"directory","path":"crates/x"}}]}},
              {{"id":"020","status":"approved",{BASE},"specPath":"specs/020/spec.md","extends":[{{"spec":"010","unit":{{"kind":"directory","path":"crates/x"}}}}]}}
            ]"#
        ));
        assert_eq!(
            ids_rels(&authorities_over(&s, "crates/x", None)),
            vec![
                ("010".to_string(), "establishes".to_string()),
                ("020".to_string(), "extends".to_string())
            ]
        );
    }

    #[test]
    fn fully_superseded_spec_excluded() {
        let s = specs(&format!(
            r#"[{{"id":"010","status":"superseded",{BASE},"specPath":"specs/010/spec.md","establishes":["a.rs"]}}]"#
        ));
        // A fully superseded spec transfers no authority, so it is excluded.
        assert!(authorities_over(&s, "a.rs", None).is_empty());
    }

    #[test]
    fn partial_supersede_transfers_authority_and_excludes_predecessor() {
        let s = specs(&format!(
            r#"[
              {{"id":"010","status":"approved",{BASE},"specPath":"specs/010/spec.md","establishes":["a.rs"]}},
              {{"id":"020","status":"approved",{BASE},"specPath":"specs/020/spec.md","supersedes":[{{"spec":"010","scope":"partial","unit":"a.rs"}}]}}
            ]"#
        ));
        // 010 partially superseded over a.rs by the live 020 -> only 020 owns it.
        assert_eq!(
            ids_rels(&authorities_over(&s, "a.rs", None)),
            vec![("020".to_string(), "supersedes".to_string())]
        );
    }

    #[test]
    fn co_authority_section_filter() {
        let s = specs(&format!(
            r#"[{{"id":"010","status":"approved",{BASE},"specPath":"specs/010/spec.md","coAuthority":[{{"unit":{{"kind":"section","file":"Makefile","anchor":"build"}}}}]}}]"#
        ));
        // Whole-file query (no section) matches the section unit's file.
        assert_eq!(
            ids_rels(&authorities_over(&s, "Makefile", None)),
            vec![("010".to_string(), "co_authority".to_string())]
        );
        // Matching anchor.
        assert_eq!(authorities_over(&s, "Makefile", Some("build")).len(), 1);
        // Non-matching anchor.
        assert!(authorities_over(&s, "Makefile", Some("other")).is_empty());
    }
}
