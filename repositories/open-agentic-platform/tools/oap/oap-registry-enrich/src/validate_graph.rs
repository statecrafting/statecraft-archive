//! Spec 217 FR-302: a thin `validate-graph` over the published library's typed
//! [`Registry`]. The in-tree `registry-consumer` that hosted this verb is
//! deleted (Phase 3), and `spec-spine compile` already rejects dangling
//! relationship references as a hard error. This restates that check as an
//! explicit, registry-reading query (the pre-PR convenience the architect
//! workflow recommends, per `.claude/agent-memory/architect`) and adds a
//! supersession-cycle guard. It reads the COMMITTED registry (post-compile) and
//! reports any spec id named by a relationship edge that does not resolve, plus
//! any cycle in the supersession graph. Exit 0 when well-formed, 1 otherwise.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use spec_spine_types::{Registry, SpecRecord};

/// One well-formedness finding. `code` is `dangling_reference` or
/// `supersession_cycle`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GraphFinding {
    pub code: String,
    pub spec_id: String,
    pub edge: String,
    pub referenced: String,
    pub message: String,
}

/// The result of a graph validation pass over the registry.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct GraphReport {
    pub ok: bool,
    pub spec_count: usize,
    pub findings: Vec<GraphFinding>,
}

/// Every spec id named by a relationship edge of `s`, paired with the edge that
/// names it. `references:` is excluded: it points at units/provenance, not spec
/// ids (it is the non-owning edge the coupling gate also ignores). `constrains`
/// is included only for its `target_specs` (the spec-scoped shape); its
/// path-scoped `unit:` shape names no spec.
fn referenced_ids(s: &SpecRecord) -> Vec<(&'static str, String)> {
    let mut out: Vec<(&'static str, String)> = Vec::new();
    for d in &s.depends_on {
        out.push(("depends_on", d.clone()));
    }
    for a in &s.amends {
        out.push(("amends", a.clone()));
    }
    if let Some(sb) = &s.superseded_by {
        out.push(("superseded_by", sb.clone()));
    }
    for e in &s.extends {
        out.push(("extends", e.spec.clone()));
    }
    for r in &s.refines {
        for rs in &r.refines_specs {
            out.push(("refines", rs.clone()));
        }
    }
    for sup in &s.supersedes {
        out.push(("supersedes", sup.spec().to_string()));
    }
    for c in &s.co_authority {
        for w in &c.with_specs {
            out.push(("co_authority", w.clone()));
        }
    }
    for c in &s.constrains {
        for t in &c.target_specs {
            out.push(("constrains", t.clone()));
        }
    }
    out
}

/// Validate the relationship graph of `registry`.
pub fn validate_graph(registry: &Registry) -> GraphReport {
    validate_specs(&registry.specs)
}

/// Core pass over a slice of records, factored out so tests need no full
/// [`Registry`].
fn validate_specs(specs: &[SpecRecord]) -> GraphReport {
    let known: BTreeSet<&str> = specs.iter().map(|s| s.id.as_str()).collect();
    let mut findings: Vec<GraphFinding> = Vec::new();

    // 1. Dangling references: any spec id named by an edge that no spec declares.
    for s in specs {
        for (edge, target) in referenced_ids(s) {
            if !known.contains(target.as_str()) {
                let message =
                    format!("{} edge `{}` references unknown spec `{}`", s.id, edge, target);
                findings.push(GraphFinding {
                    code: "dangling_reference".to_string(),
                    spec_id: s.id.clone(),
                    edge: edge.to_string(),
                    referenced: target,
                    message,
                });
            }
        }
    }

    // 2. Supersession acyclicity: an edge a -> b means `a supersedes b`. A cycle
    //    (a supersedes ... supersedes a) is a contradiction. Only edges to known
    //    specs are followed; unknown targets are already reported above.
    let mut edges: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for s in specs {
        for sup in &s.supersedes {
            let pred = sup.spec();
            if known.contains(pred) {
                edges.entry(s.id.as_str()).or_default().push(pred);
            }
        }
    }
    findings.extend(supersession_cycles(&edges));

    findings.sort_by(|a, b| {
        (a.code.as_str(), a.spec_id.as_str(), a.referenced.as_str()).cmp(&(
            b.code.as_str(),
            b.spec_id.as_str(),
            b.referenced.as_str(),
        ))
    });

    GraphReport {
        ok: findings.is_empty(),
        spec_count: specs.len(),
        findings,
    }
}

/// Find specs on (or feeding into) a supersession cycle by Kahn-style sink
/// elimination over the `a supersedes b` edge map: iteratively drop any node all
/// of whose still-present successors are already gone. A node on a cycle never
/// loses its in-cycle successor, so the survivors are exactly the nodes that
/// cannot reach a sink. This is iterative (no recursion), so a long supersession
/// chain cannot exhaust the stack, and deterministic via `BTreeSet` ordering. It
/// reports a node that merely feeds a cycle as well as one strictly on it; both
/// are contradictions, and the expected output is empty (supersession is a DAG).
fn supersession_cycles(edges: &BTreeMap<&str, Vec<&str>>) -> Vec<GraphFinding> {
    // Every node touched by a supersedes edge (source or target).
    let mut remaining: BTreeSet<&str> = BTreeSet::new();
    for (&k, v) in edges {
        remaining.insert(k);
        for &m in v {
            remaining.insert(m);
        }
    }
    loop {
        let removable: Vec<&str> = remaining
            .iter()
            .copied()
            .filter(|n| {
                edges
                    .get(n)
                    .is_none_or(|succ| succ.iter().all(|m| !remaining.contains(m)))
            })
            .collect();
        if removable.is_empty() {
            break;
        }
        for r in removable {
            remaining.remove(r);
        }
    }
    remaining
        .iter()
        .map(|&n| {
            // A concrete still-cyclic successor `n` supersedes, for `referenced`;
            // falls back to `n` itself only for a self-supersession.
            let succ = edges
                .get(n)
                .and_then(|s| s.iter().find(|m| remaining.contains(*m)))
                .copied()
                .unwrap_or(n);
            GraphFinding {
                message: format!("{n} is on or feeds a supersession cycle (supersedes `{succ}`)"),
                code: "supersession_cycle".to_string(),
                spec_id: n.to_string(),
                edge: "supersedes".to_string(),
                referenced: succ.to_string(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn specs(json: &str) -> Vec<SpecRecord> {
        serde_json::from_str(json).expect("specs JSON")
    }

    const BASE: &str = r#""title":"t","created":"2026-01-01","summary":"s""#;

    #[test]
    fn clean_graph_is_ok() {
        let s = specs(&format!(
            r#"[
              {{"id":"010","status":"approved",{BASE},"specPath":"specs/010/spec.md"}},
              {{"id":"020","status":"approved",{BASE},"specPath":"specs/020/spec.md","dependsOn":["010"],"amends":["010"]}}
            ]"#
        ));
        let r = validate_specs(&s);
        assert!(r.ok, "{:?}", r.findings);
        assert_eq!(r.spec_count, 2);
    }

    #[test]
    fn dangling_reference_across_edge_kinds_is_flagged() {
        let s = specs(&format!(
            r#"[
              {{"id":"020","status":"approved",{BASE},"specPath":"specs/020/spec.md","dependsOn":["999"],"extends":[{{"spec":"998","unit":"a.rs"}}],"supersededBy":"997"}}
            ]"#
        ));
        let r = validate_specs(&s);
        assert!(!r.ok);
        let mut got: Vec<(String, String)> = r
            .findings
            .iter()
            .map(|f| (f.edge.clone(), f.referenced.clone()))
            .collect();
        got.sort();
        assert_eq!(
            got,
            vec![
                ("depends_on".to_string(), "999".to_string()),
                ("extends".to_string(), "998".to_string()),
                ("superseded_by".to_string(), "997".to_string()),
            ]
        );
        assert!(r.findings.iter().all(|f| f.code == "dangling_reference"));
    }

    #[test]
    fn supersession_cycle_is_flagged() {
        // 010 supersedes 020, 020 supersedes 010: a contradiction.
        let s = specs(&format!(
            r#"[
              {{"id":"010","status":"approved",{BASE},"specPath":"specs/010/spec.md","supersedes":["020"]}},
              {{"id":"020","status":"approved",{BASE},"specPath":"specs/020/spec.md","supersedes":["010"]}}
            ]"#
        ));
        let r = validate_specs(&s);
        assert!(!r.ok);
        let cyclic: BTreeSet<String> = r
            .findings
            .iter()
            .filter(|f| f.code == "supersession_cycle")
            .map(|f| f.spec_id.clone())
            .collect();
        assert_eq!(
            cyclic,
            ["010".to_string(), "020".to_string()].into_iter().collect()
        );
    }

    #[test]
    fn linear_supersession_chain_is_acyclic() {
        // 030 supersedes 020 supersedes 010: a DAG, no cycle finding.
        let s = specs(&format!(
            r#"[
              {{"id":"010","status":"superseded",{BASE},"specPath":"specs/010/spec.md"}},
              {{"id":"020","status":"superseded",{BASE},"specPath":"specs/020/spec.md","supersedes":["010"]}},
              {{"id":"030","status":"approved",{BASE},"specPath":"specs/030/spec.md","supersedes":["020"]}}
            ]"#
        ));
        let r = validate_specs(&s);
        assert!(r.ok, "{:?}", r.findings);
    }

    #[test]
    fn dangling_reference_covers_remaining_edge_kinds() {
        // amends, refines (refinesSpecs), co_authority (withSpecs), and
        // constrains (targetSpecs) each name a spec id that no record declares.
        let s = specs(&format!(
            r#"[{{"id":"020","status":"approved",{BASE},"specPath":"specs/020/spec.md",
              "amends":["991"],
              "refines":[{{"aspect":"x","refines_specs":["992"]}}],
              "coAuthority":[{{"unit":{{"kind":"section","file":"Makefile","anchor":"b"}},"with_specs":["993"]}}],
              "constrains":[{{"target_specs":["994"]}}]
            }}]"#
        ));
        let r = validate_specs(&s);
        let mut got: Vec<(String, String)> = r
            .findings
            .iter()
            .map(|f| (f.edge.clone(), f.referenced.clone()))
            .collect();
        got.sort();
        assert_eq!(
            got,
            vec![
                ("amends".to_string(), "991".to_string()),
                ("co_authority".to_string(), "993".to_string()),
                ("constrains".to_string(), "994".to_string()),
                ("refines".to_string(), "992".to_string()),
            ]
        );
    }

    #[test]
    fn three_node_cycle_flagged_shared_dag_clean() {
        // 010->020->030->010 is a 3-cycle (all flagged); 050 and 070 both
        // supersede the shared sink 060 with NO cycle (none flagged).
        let s = specs(&format!(
            r#"[
              {{"id":"010","status":"approved",{BASE},"specPath":"specs/010/spec.md","supersedes":["020"]}},
              {{"id":"020","status":"approved",{BASE},"specPath":"specs/020/spec.md","supersedes":["030"]}},
              {{"id":"030","status":"approved",{BASE},"specPath":"specs/030/spec.md","supersedes":["010"]}},
              {{"id":"050","status":"approved",{BASE},"specPath":"specs/050/spec.md","supersedes":["060"]}},
              {{"id":"060","status":"superseded",{BASE},"specPath":"specs/060/spec.md"}},
              {{"id":"070","status":"approved",{BASE},"specPath":"specs/070/spec.md","supersedes":["060"]}}
            ]"#
        ));
        let r = validate_specs(&s);
        let cyclic: BTreeSet<String> = r
            .findings
            .iter()
            .filter(|f| f.code == "supersession_cycle")
            .map(|f| f.spec_id.clone())
            .collect();
        assert_eq!(
            cyclic,
            ["010", "020", "030"]
                .into_iter()
                .map(str::to_string)
                .collect()
        );
    }
}
