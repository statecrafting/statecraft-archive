//! Spec-spine shared types.
//!
//! Canonical home for the vocabularies and code registries that
//! spec-compiler, spec-lint, codebase-indexer, and policy-compiler all
//! consume. Frontmatter parsing helpers (formerly the
//! `open_agentic_frontmatter` crate) live here too; they have no
//! semantic dependency on the vocabularies but ship from the same
//! leaf crate so every spec-spine producer takes exactly one
//! foundational dep.
//!
//! Hard leaf — depends only on `serde` / `serde_yaml`.

use serde_yaml::Value;

// ─────────────────────────────────────────────────────────────────────
// Frontmatter parsing (absorbed from open_agentic_frontmatter)
// ─────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum FrontmatterError {
    MissingFrontmatter,
    Yaml(serde_yaml::Error),
}

impl From<serde_yaml::Error> for FrontmatterError {
    fn from(value: serde_yaml::Error) -> Self {
        Self::Yaml(value)
    }
}

pub fn split_frontmatter_required(raw: &str) -> Result<(Value, String), FrontmatterError> {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let rest = raw
        .strip_prefix("---")
        .ok_or(FrontmatterError::MissingFrontmatter)?;
    let rest = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))
        .ok_or(FrontmatterError::MissingFrontmatter)?;

    let (yaml_str, body) = if let Some(i) = rest.find("\n---\n") {
        (&rest[..i], rest[i + 5..].to_string())
    } else if let Some(i) = rest.find("\r\n---\r\n") {
        (&rest[..i], rest[i + 7..].to_string())
    } else {
        return Err(FrontmatterError::MissingFrontmatter);
    };

    let value: Value = serde_yaml::from_str(yaml_str)?;
    Ok((value, body))
}

pub fn split_frontmatter_optional(raw: &str) -> Option<(Value, String)> {
    split_frontmatter_required(raw).ok()
}

// ─────────────────────────────────────────────────────────────────────
// Spec-format vocabularies (canonical source; consumers hoist from here
// once W-02 lands)
// ─────────────────────────────────────────────────────────────────────

/// Known frontmatter keys consumed into normalized fields (remainder → extraFrontmatter).
///
/// Cut D W-06c: `compliance` retained in this allowlist but NO LONGER
/// emitted by spec-compiler (the FeatureRecord.compliance field was
/// removed in W-06c). The OAP-side enricher (oap-registry-enrich) is
/// the canonical reader of `compliance:` and emits it to
/// registry-oap.json. Keeping the key in KNOWN_KEYS prevents V-002
/// errors when the spec corpus carries `compliance:` frontmatter that
/// extra_frontmatter would otherwise reject as an unsupported complex
/// type. (KNOWN_KEYS is a "permitted frontmatter" allowlist, not a
/// "fields emitted by spec-compiler" list — the two were aligned
/// before W-06c.)
pub const KNOWN_KEYS: &[&str] = &[
    "id",
    "title",
    "status",
    "created",
    "summary",
    "authors",
    "kind",
    "feature_branch",
    "code_aliases",
    "depends_on",
    "owner",
    "risk",
    "implementation",
    "implements",
    "compliance",
    // Spec 132 — unamendable invariants.
    "amends",
    "amends_sections",
    "unamendable",
    // Spec 147 — universal dimensions and governance lifecycle.
    "shape",
    "category",
    "supersedes",
    "superseded_by",
    "retirement_rationale",
    // Spec 147 — per-kind structural fields (kind: capability / registry / profile).
    "provides",
    "composition",
    "selectable_by",
    "selector",
    "default",
    "production_forbidden",
    "member_contract",
    "identity",
    "selects",
    "policy",
    // Spec 130 (relationship graph) — eight relationship fields. Authors
    // declare relationships explicitly; `implements:` is derived from the
    // union of paths in `establishes`, `extends.paths`, `refines.paths`,
    // and `co_authority.paths`. `origin: retroactive: true` is the
    // bootstrap marker for specs not yet curated into the graph.
    "establishes",
    "extends",
    "refines",
    "supersedes",  // bare id = full scope; `{spec, scope, unit?, note?, rationale?}` object carries partial scope (spec 216 Phase 2a). Full normalises to a bare id; malformed entries are rejected with V-034. Canonical partial key is `unit:` (spec 154 §6); the pre-154 `paths:` template is retired.
    "amends",      // bare-id list only (spec 216 Phase 1); a non-string/object entry is rejected with V-033. Section-scoping uses `amends_sections:` (spec 132); code authority uses `refines:`/`extends:`.
    "co_authority",
    "constrains",
    "origin",
    // Spec 154 (logical-unit ownership grammar) — ninth relationship,
    // declaratively non-owning. Items are units the spec mentions for
    // evidence / illustration / provenance without claiming authority
    // over them. The coupling gate ignores references; the indexer
    // surfaces them for navigation.
    "references",
    // Spec 179 — universal tract-authority lens. Closed enum
    // (`opc | platform | substrate | tooling`). V-030 validates the
    // enum at error severity; V-031 emits at warning severity when
    // the field is absent.
    "domain",
];

/// Valid values for the `risk` frontmatter field.
pub const VALID_RISK_LEVELS: &[&str] = &["low", "medium", "high", "critical"];

/// Spec 147 — valid values for the `kind` frontmatter field (V-012).
pub const VALID_KINDS: &[&str] = &[
    "platform",
    "platform-delivery",
    "governance",
    "product",
    "amendment",
    "tooling",
    "desktop",
    "process",
    "ui",
    "architecture",
    "constitutional-bootstrap",
    "migration",
    "product-consolidation",
    "capability",
    "registry",
    "profile",
];

/// Spec 147 — declared `(kind, shape)` table. Reserved for downstream
/// consumers: spec-lint emits W-131 against entries outside this table.
pub const SHAPE_TABLE: &[(&str, &[&str])] = &[
    (
        "capability",
        &["driver", "module", "web-snippet", "middleware-stack"],
    ),
    (
        "amendment",
        &[
            "field-addition",
            "field-modification",
            "mechanism-add",
            "mechanism-modification",
            "bug-fix",
            "retirement-record",
            "consolidation",
        ],
    ),
];

/// Spec 179 — valid values for the `domain:` frontmatter field (V-030).
/// Closed enum; future amendments widen it.
pub const VALID_DOMAINS: &[&str] = &["opc", "platform", "substrate", "tooling"];

/// Spec 147 — conventional `category:` vocabulary (W-130, info severity).
pub const CONVENTIONAL_CATEGORIES: &[&str] = &[
    "security",
    "auth",
    "data",
    "ui",
    "infrastructure",
    "governance",
    "audit",
    "compliance",
    "identity",
    "lifecycle",
    "policy",
    "performance",
    "observability",
    "release",
    "testing",
];

#[cfg(test)]
mod frontmatter_tests {
    use super::*;

    #[test]
    fn splits_required_frontmatter() {
        let raw = "---\nid: x\n---\nbody\n";
        let (fm, body) = split_frontmatter_required(raw).unwrap();
        assert_eq!(fm.get("id").and_then(|v| v.as_str()), Some("x"));
        assert_eq!(body, "body\n");
    }

    #[test]
    fn missing_frontmatter_returns_err() {
        let raw = "no frontmatter here";
        assert!(matches!(
            split_frontmatter_required(raw),
            Err(FrontmatterError::MissingFrontmatter)
        ));
    }

    #[test]
    fn optional_returns_none_when_absent() {
        assert!(split_frontmatter_optional("no frontmatter").is_none());
    }
}
