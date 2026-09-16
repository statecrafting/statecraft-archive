//! Cross-repo factory contract lockstep checker (spec 212).
//!
//! Compares OAP's canonical factory contract surface
//! (`standards/schemas/factory/**`) against the owned factory source
//! (`factory`'s `contract/schemas/**`) under the **three-mode**
//! comparison spec 212 defines, plus the spec-197 FR-005 GoA-concept guard.
//!
//! The three modes (see spec 212 §"Semantic diff" / §"The lockstep set"):
//!
//! * **Exact** — the genuinely shared, no-additive-evolution surface; any
//!   structural difference on either side fails.
//! * **Floor** — OAP is the floor: every OAP field/enum-value must persist on
//!   the factory side (no removal/rename/narrowing), but factory-side
//!   additions pass. The open-standard reading.
//! * **SectionScoped** — for an adapter-specialised file, compare only the
//!   named contract-governed top-level sections under the floor rule; the
//!   adapter-determined sections are excluded (spec 197 FR-007).
//!
//! Comparison is structural: comments (dropped by the YAML parser) and
//! free-form prose values (`description`, `$comment`, `examples`) are ignored.
//!
//! The per-file classification below mirrors spec 212 §"The lockstep set" — it
//! IS the tool's copy of the authored table (Principle I). Moving a file
//! between modes is a coupling-gated edit to that spec.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

// ───────────────────────────── classification ──────────────────────────────

/// On-disk format of a lockstep file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Yaml,
    Json,
}

/// The comparison mode for a lockstep file (spec 212 §"The lockstep set").
#[derive(Debug, Clone)]
pub enum Mode {
    /// Hard-fail on any structural divergence (either side).
    Exact,
    /// OAP is the floor; factory additions pass.
    Floor,
    /// Compare only these top-level sections, each under the floor rule.
    SectionScoped {
        include_top_keys: &'static [&'static str],
    },
}

/// One file under lockstep, with its format and compare mode.
pub struct LockstepFile {
    pub rel_path: &'static str,
    pub format: Format,
    pub mode: Mode,
}

/// The authored lockstep set (spec 212 §"The lockstep set"). The relative
/// paths are identical on both sides (OAP `standards/schemas/factory/` and
/// factory `contract/schemas/`).
pub fn lockstep_files() -> Vec<LockstepFile> {
    use Format::*;
    use Mode::*;
    vec![
        // Exact parity — byte/structurally identical at the pin.
        LockstepFile { rel_path: "pipeline-state.schema.yaml", format: Yaml, mode: Exact },
        LockstepFile { rel_path: "verification.schema.yaml", format: Yaml, mode: Exact },
        LockstepFile { rel_path: "stage-outputs/business-rules.schema.json", format: Json, mode: Exact },
        LockstepFile { rel_path: "stage-outputs/entity-model.schema.json", format: Json, mode: Exact },
        LockstepFile { rel_path: "stage-outputs/use-cases.schema.json", format: Json, mode: Exact },
        LockstepFile { rel_path: "stage-outputs/audiences.schema.json", format: Json, mode: Exact },
        // Directional floor — factory has additively evolved (workspace_id, the
        // larger page_type catalog); OAP fields must persist.
        LockstepFile { rel_path: "build-spec.schema.yaml", format: Yaml, mode: Floor },
        LockstepFile { rel_path: "stage-outputs/sitemap.schema.json", format: Json, mode: Floor },
        // Section-scoped floor — adapter-specialised (spec 197 FR-007); the
        // schema_version, the governance sub-envelope (spec 198 FR-012), and
        // the dual_stack variant contract are contract-governed. dual_stack
        // was added (2026-06-12) after a live OPC adapter-load failure exposed
        // stack->variant drift that fell outside the gate's coverage.
        LockstepFile {
            rel_path: "adapter-manifest.schema.yaml",
            format: Yaml,
            mode: SectionScoped {
                include_top_keys: &["schema_version", "governance", "dual_stack"],
            },
        },
    ]
}

/// Files present on OAP but expected-absent on factory today
/// (spec 212 Tier B). Reported as an advisory gap, never a hard failure.
pub const TIER_B_FILES: &[&str] = &["governance-envelope.schema.yaml"];

/// Prose/annotation keys whose *values* are ignored in every compare mode.
const PROSE_KEYS: &[&str] = &["description", "$comment", "examples"];

// ─────────────────────────────── shapes ────────────────────────────────────

/// A structural "shape" of a parsed schema document: the comparison surface.
/// Scalar leaf *values* are kept (a `string`→`integer` type-token change is
/// real drift) but prose values collapse to `Ignored`.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Shape {
    Map(BTreeMap<String, Shape>),
    Seq(Box<Shape>),
    /// A set of scalar values — captures `enum:` lists and `[string]`-style
    /// type lists alike. Compared as a set (floor: subset; exact: equality).
    ValueSet(BTreeSet<String>),
    Scalar(String),
    /// A prose value, ignored.
    Ignored,
    Null,
}

fn scalar_string(v: &serde_yaml::Value) -> Option<String> {
    match v {
        serde_yaml::Value::Bool(b) => Some(b.to_string()),
        serde_yaml::Value::Number(n) => Some(n.to_string()),
        serde_yaml::Value::String(s) => Some(s.clone()),
        serde_yaml::Value::Null => Some("null".to_string()),
        _ => None,
    }
}

fn key_string(v: &serde_yaml::Value) -> String {
    scalar_string(v).unwrap_or_else(|| format!("{v:?}"))
}

/// Merge two shapes into the union shape (used to collapse a sequence of
/// exemplar elements into one element shape). Maps union their keys;
/// value-sets union their members.
///
/// Known limitation: a sequence-of-sequences (`Seq` merged with `Seq`) hits
/// the catch-all and keeps only the first element's shape. The lockstep
/// contract files contain no nested arrays today, so this is unreachable in
/// practice; a future `oneOf`/`anyOf` array would need a `Seq+Seq` arm here.
fn merge(a: Shape, b: Shape) -> Shape {
    match (a, b) {
        (Shape::Map(mut am), Shape::Map(bm)) => {
            for (k, bv) in bm {
                match am.remove(&k) {
                    Some(av) => {
                        am.insert(k, merge(av, bv));
                    }
                    None => {
                        am.insert(k, bv);
                    }
                }
            }
            Shape::Map(am)
        }
        (Shape::ValueSet(mut a), Shape::ValueSet(b)) => {
            a.extend(b);
            Shape::ValueSet(a)
        }
        // Differing kinds (rare in these exemplar seqs): keep the first.
        (a, _) => a,
    }
}

fn normalize(v: &serde_yaml::Value) -> Shape {
    match v {
        serde_yaml::Value::Null => Shape::Null,
        serde_yaml::Value::Bool(_) | serde_yaml::Value::Number(_) | serde_yaml::Value::String(_) => {
            Shape::Scalar(scalar_string(v).unwrap())
        }
        serde_yaml::Value::Sequence(seq) => {
            if seq.iter().all(|e| scalar_string(e).is_some()) {
                // value set (enum list, [string] type list, etc.)
                Shape::ValueSet(seq.iter().filter_map(scalar_string).collect())
            } else {
                // sequence of structured exemplars → merge to one element shape
                let elem = seq
                    .iter()
                    .map(normalize)
                    .reduce(merge)
                    .unwrap_or(Shape::Null);
                Shape::Seq(Box::new(elem))
            }
        }
        serde_yaml::Value::Mapping(map) => {
            let mut m = BTreeMap::new();
            for (k, val) in map {
                let key = key_string(k);
                if PROSE_KEYS.contains(&key.as_str()) {
                    m.insert(key, Shape::Ignored);
                } else {
                    m.insert(key, normalize(val));
                }
            }
            Shape::Map(m)
        }
        serde_yaml::Value::Tagged(t) => normalize(&t.value),
    }
}

fn parse_to_shape(path: &Path, format: Format) -> Result<Shape, OpError> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| OpError(format!("cannot read {}: {e}", path.display())))?;
    let value: serde_yaml::Value = match format {
        Format::Yaml => serde_yaml::from_str(&text)
            .map_err(|e| OpError(format!("cannot parse YAML {}: {e}", path.display())))?,
        Format::Json => {
            let jv: serde_json::Value = serde_json::from_str(&text)
                .map_err(|e| OpError(format!("cannot parse JSON {}: {e}", path.display())))?;
            serde_yaml::to_value(&jv)
                .map_err(|e| OpError(format!("cannot lift JSON {}: {e}", path.display())))?
        }
    };
    Ok(normalize(&value))
}

// ─────────────────────────────── compare ───────────────────────────────────

/// A structural divergence (a hard failure).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Divergence {
    pub file: String,
    pub path: String,
    pub detail: String,
}

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
}

/// Exact: any structural difference (either side) is a divergence.
fn compare_exact(oap: &Shape, fac: &Shape, path: &str, out: &mut Vec<(String, String)>) {
    match (oap, fac) {
        (Shape::Ignored, _) | (_, Shape::Ignored) => {}
        (Shape::Map(a), Shape::Map(b)) => {
            let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
            for k in keys {
                match (a.get(k), b.get(k)) {
                    (Some(x), Some(y)) => compare_exact(x, y, &join(path, k), out),
                    (Some(_), None) => out.push((join(path, k), "present in OAP only".into())),
                    (None, Some(_)) => out.push((join(path, k), "present in factory only".into())),
                    (None, None) => unreachable!(),
                }
            }
        }
        (Shape::ValueSet(a), Shape::ValueSet(b)) => {
            for v in a.difference(b) {
                out.push((path.to_string(), format!("value `{v}` present in OAP only")));
            }
            for v in b.difference(a) {
                out.push((path.to_string(), format!("value `{v}` present in factory only")));
            }
        }
        (Shape::Seq(a), Shape::Seq(b)) => compare_exact(a, b, &format!("{path}[]"), out),
        (Shape::Scalar(a), Shape::Scalar(b)) => {
            if a != b {
                out.push((path.to_string(), format!("scalar differs: OAP `{a}` vs factory `{b}`")));
            }
        }
        (Shape::Null, Shape::Null) => {}
        _ => out.push((path.to_string(), format!("shape kind differs: OAP {} vs factory {}", kind(oap), kind(fac)))),
    }
}

/// Floor: every OAP field/value must be present on factory; factory may add.
fn compare_floor(oap: &Shape, fac: &Shape, path: &str, out: &mut Vec<(String, String)>) {
    match (oap, fac) {
        (Shape::Ignored, _) | (_, Shape::Ignored) => {}
        (Shape::Map(a), Shape::Map(b)) => {
            for (k, x) in a {
                match b.get(k) {
                    Some(y) => compare_floor(x, y, &join(path, k), out),
                    None => out.push((join(path, k), "present in OAP only (floor: factory must mirror it)".into())),
                }
            }
            // factory-only keys are allowed additive evolution
        }
        (Shape::ValueSet(a), Shape::ValueSet(b)) => {
            for v in a.difference(b) {
                out.push((path.to_string(), format!("value `{v}` present in OAP only (floor: factory must mirror it)")));
            }
            // factory-only values allowed (additive)
        }
        (Shape::Seq(a), Shape::Seq(b)) => compare_floor(a, b, &format!("{path}[]"), out),
        (Shape::Scalar(a), Shape::Scalar(b)) => {
            if a != b {
                out.push((path.to_string(), format!("scalar differs: OAP `{a}` vs factory `{b}`")));
            }
        }
        (Shape::Null, Shape::Null) => {}
        _ => out.push((path.to_string(), format!("shape kind differs: OAP {} vs factory {}", kind(oap), kind(fac)))),
    }
}

fn compare_section_scoped(
    oap: &Shape,
    fac: &Shape,
    include: &[&str],
    out: &mut Vec<(String, String)>,
) {
    if let (Shape::Map(a), Shape::Map(b)) = (oap, fac) {
        for key in include {
            match (a.get(*key), b.get(*key)) {
                (Some(x), Some(y)) => compare_floor(x, y, key, out),
                (Some(_), None) => out.push((
                    (*key).to_string(),
                    "contract-governed section present in OAP only (floor: factory must mirror it)".into(),
                )),
                // OAP lacks the section → nothing to enforce.
                (None, _) => {}
            }
        }
    } else {
        out.push((String::new(), "top-level shape is not a mapping on both sides".into()));
    }
}

fn kind(s: &Shape) -> &'static str {
    match s {
        Shape::Map(_) => "map",
        Shape::Seq(_) => "seq",
        Shape::ValueSet(_) => "value-set",
        Shape::Scalar(_) => "scalar",
        Shape::Ignored => "prose",
        Shape::Null => "null",
    }
}

// ─────────────────────────────── GoA guard ─────────────────────────────────

/// A spec-197-FR-005 forbidden-vocabulary hit (a hard failure).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuardHit {
    pub file: String,
    pub line: usize,
    pub token: String,
    pub clause: &'static str,
}

/// Strip a YAML line's comment (everything from the first unquoted `#`), so
/// the guard scans contract structure, not the schema's own
/// rejection-documenting comments. JSON has no `#` comments.
fn strip_yaml_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut in_single = false;
    let mut in_double = false;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'\'' if !in_double => in_single = !in_single,
            b'"' if !in_single => in_double = !in_double,
            b'#' if !in_single && !in_double => {
                // a `#` mid-token (no preceding space) is unusual in these
                // schemas; treat any unquoted `#` as a comment start.
                return &line[..i];
            }
            _ => {}
        }
    }
    line
}

/// True when a line's key is one of [`PROSE_KEYS`] — its value is free-form
/// documentation, scanned OUT of the guard the same way `#` comments are. A
/// `description:` that mentions a rejected GoA concept to *document its
/// rejection* must not trip the guard (AC-3): the guard asserts the forbidden
/// vocabulary never entered the contract STRUCTURE (a key/enum value), not its
/// prose. Handles single-line YAML (`description: ...`) and JSON
/// (`"description": ...`); multi-line block scalars are not the shape these
/// schemas use.
fn is_prose_value_line(line: &str) -> bool {
    let trimmed = line.trim_start().trim_start_matches('"');
    PROSE_KEYS.iter().any(|k| match trimmed.strip_prefix(*k) {
        Some(rest) => rest.trim_start().trim_start_matches('"').trim_start().starts_with(':'),
        None => false,
    })
}

/// Whether `guard_scan`'s `#`-comment strip applies: YAML has line comments,
/// JSON does not. Derived from the extension so callers need no format table.
fn strip_for(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("yaml") | Some("yml")
    )
}

/// Scan one contract file for spec-197 FR-005 forbidden vocabulary. `strip`
/// controls YAML comment stripping (true for YAML, false for JSON).
fn guard_scan(path: &Path, strip: bool, out: &mut Vec<GuardHit>) -> Result<(), OpError> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| OpError(format!("cannot read {}: {e}", path.display())))?;
    let file = path.display().to_string();
    for (idx, raw) in text.lines().enumerate() {
        let line = if strip { strip_yaml_comment(raw) } else { raw };
        // A documentation-prose value (description/$comment/examples) is not
        // contract structure — skip it, so a description that names a rejected
        // GoA concept to document the rejection does not false-fail (AC-3).
        if is_prose_value_line(line) {
            continue;
        }
        let lower = line.to_lowercase();
        // Classification labels: Protected A/B/C (unambiguous).
        for c in ['a', 'b', 'c'] {
            if lower.contains(&format!("protected {c}")) {
                out.push(GuardHit {
                    file: file.clone(),
                    line: idx + 1,
                    token: format!("Protected {}", c.to_ascii_uppercase()),
                    clause: "FR-005: security classification labels",
                });
            }
        }
        // `Public` only in a classification context (avoids the ordinary
        // lowercase `public` in view_type/auth enums).
        if line.contains("Public") && (lower.contains("protected") || lower.contains("classification")) {
            out.push(GuardHit {
                file: file.clone(),
                line: idx + 1,
                token: "Public".into(),
                clause: "FR-005: security classification labels",
            });
        }
        // External service catalogue + its rejected enum value.
        if lower.contains("catalog-auto") {
            out.push(GuardHit {
                file: file.clone(),
                line: idx + 1,
                token: "catalog-auto".into(),
                clause: "FR-005: external service catalogue",
            });
        }
        if lower.contains("service catalogue")
            || lower.contains("service-catalogue")
            || lower.contains("service catalog")
        {
            out.push(GuardHit {
                file: file.clone(),
                line: idx + 1,
                token: "service catalogue".into(),
                clause: "FR-005: external service catalogue",
            });
        }
    }
    Ok(())
}

// ─────────────────────────────── driver ────────────────────────────────────

/// An operational error (missing dir, unparseable file) — distinct from a
/// content divergence. Maps to exit code 2: never skipped-green.
#[derive(Debug, Clone)]
pub struct OpError(pub String);

impl std::fmt::Display for OpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for OpError {}

/// The full lockstep result.
#[derive(Debug, Default)]
pub struct Report {
    /// Hard-failure structural divergences.
    pub divergences: Vec<Divergence>,
    /// Hard-failure GoA-concept guard hits.
    pub guard_hits: Vec<GuardHit>,
    /// Advisory Tier-B gaps (present on OAP, expected-absent on factory).
    pub tier_b_gaps: Vec<String>,
    /// Informational notes (e.g. a Tier-B gap that has closed).
    pub notes: Vec<String>,
}

impl Report {
    /// A hard failure occurred (a real divergence or a guard hit). Tier-B gaps
    /// and notes are advisory and do NOT make the run fail.
    pub fn failed(&self) -> bool {
        !self.divergences.is_empty() || !self.guard_hits.is_empty()
    }
}

/// Run the full lockstep check. `oap_dir` is `standards/schemas/factory`;
/// `factory_dir` is the fetched factory `contract/schemas` tree.
pub fn run_check(oap_dir: &Path, factory_dir: &Path) -> Result<Report, OpError> {
    if !oap_dir.is_dir() {
        return Err(OpError(format!("OAP schema dir not found: {}", oap_dir.display())));
    }
    if !factory_dir.is_dir() {
        return Err(OpError(format!(
            "factory schema dir not found: {} (fetch failed? check UPSTREAM_SOURCES_RO_TOKEN)",
            factory_dir.display()
        )));
    }

    let mut report = Report::default();

    for f in lockstep_files() {
        let oap_path = oap_dir.join(f.rel_path);
        let fac_path = factory_dir.join(f.rel_path);
        if !oap_path.exists() {
            return Err(OpError(format!(
                "lockstep file missing on OAP side: {} — the spec 212 lockstep set is stale",
                oap_path.display()
            )));
        }
        // GoA guard scans the OAP side regardless of factory presence.
        let strip = f.format == Format::Yaml;
        guard_scan(&oap_path, strip, &mut report.guard_hits)?;

        if !fac_path.exists() {
            report.divergences.push(Divergence {
                file: f.rel_path.to_string(),
                path: String::new(),
                detail: "lockstep file present on OAP, absent on factory (not a Tier-B gap)".into(),
            });
            continue;
        }
        guard_scan(&fac_path, strip, &mut report.guard_hits)?;

        let oap_shape = parse_to_shape(&oap_path, f.format)?;
        let fac_shape = parse_to_shape(&fac_path, f.format)?;
        let mut diffs: Vec<(String, String)> = Vec::new();
        match &f.mode {
            Mode::Exact => compare_exact(&oap_shape, &fac_shape, "", &mut diffs),
            Mode::Floor => compare_floor(&oap_shape, &fac_shape, "", &mut diffs),
            Mode::SectionScoped { include_top_keys } => {
                compare_section_scoped(&oap_shape, &fac_shape, include_top_keys, &mut diffs)
            }
        }
        for (path, detail) in diffs {
            report.divergences.push(Divergence { file: f.rel_path.to_string(), path, detail });
        }
    }

    // Tier B — advisory gaps + guard scan on whatever is present. The
    // `#`-comment strip is YAML-only; derive it from the file extension rather
    // than hardcoding, so a future JSON Tier-B file is scanned correctly.
    for tb in TIER_B_FILES {
        let oap_path = oap_dir.join(tb);
        let fac_path = factory_dir.join(tb);
        if oap_path.exists() {
            guard_scan(&oap_path, strip_for(&oap_path), &mut report.guard_hits)?;
        }
        if fac_path.exists() {
            guard_scan(&fac_path, strip_for(&fac_path), &mut report.guard_hits)?;
        }
        match (oap_path.exists(), fac_path.exists()) {
            (true, false) => report.tier_b_gaps.push(format!(
                "{tb}: present on OAP, absent on factory — expected Tier-B gap \
                 (spec 198 §AC: factory must file a conformant envelope)"
            )),
            (true, true) => report.notes.push(format!(
                "{tb}: now present on BOTH sides — Tier-B gap closed; graduate it to a \
                 compare mode in spec 212 §\"The lockstep set\""
            )),
            _ => {}
        }
    }

    Ok(report)
}

// ─────────────────────────────── tests ─────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn shape_yaml(s: &str) -> Shape {
        normalize(&serde_yaml::from_str(s).unwrap())
    }
    fn diffs_exact(a: &str, b: &str) -> Vec<(String, String)> {
        let mut out = Vec::new();
        compare_exact(&shape_yaml(a), &shape_yaml(b), "", &mut out);
        out
    }
    fn diffs_floor(a: &str, b: &str) -> Vec<(String, String)> {
        let mut out = Vec::new();
        compare_floor(&shape_yaml(a), &shape_yaml(b), "", &mut out);
        out
    }

    // AC-1: removing/renaming an OAP field, or narrowing an enum, fails the floor.
    #[test]
    fn floor_flags_removed_field() {
        let oap = "project:\n  name: string\n  workspace_id: string\n";
        let fac = "project:\n  name: string\n"; // factory dropped workspace_id
        let d = diffs_floor(oap, fac);
        assert!(d.iter().any(|(p, _)| p == "project.workspace_id"), "{d:?}");
    }
    #[test]
    fn floor_flags_renamed_field() {
        let oap = "audiences:\n  provisioning_model: x\n";
        let fac = "audiences:\n  provisioningModel: x\n"; // renamed on factory
        let d = diffs_floor(oap, fac);
        assert!(d.iter().any(|(p, _)| p == "audiences.provisioning_model"), "{d:?}");
    }
    #[test]
    fn floor_flags_narrowed_enum() {
        let oap = "variant:\n  enum: [a, b, c]\n";
        let fac = "variant:\n  enum: [a, b]\n"; // factory narrowed (dropped c)
        let d = diffs_floor(oap, fac);
        assert!(d.iter().any(|(_, m)| m.contains("`c`")), "{d:?}");
    }
    #[test]
    fn exact_flags_added_field_either_side() {
        // exact-parity file: a factory-only field is also a failure
        let oap = "a: string\n";
        let fac = "a: string\nb: string\n";
        let d = diffs_exact(oap, fac);
        assert!(d.iter().any(|(p, _)| p == "b"), "{d:?}");
    }

    // AC-2: tolerated differences do NOT fail.
    #[test]
    fn floor_allows_factory_additions() {
        let oap = "project:\n  name: string\n";
        let fac = "project:\n  name: string\n  workspace_id: string\n"; // factory added
        assert!(diffs_floor(oap, fac).is_empty());
    }
    #[test]
    fn floor_allows_widened_enum() {
        let oap = "page_type:\n  enum: [landing, list]\n";
        let fac = "page_type:\n  enum: [landing, list, wizard, directory]\n"; // factory widened
        assert!(diffs_floor(oap, fac).is_empty());
    }
    #[test]
    fn description_prose_is_ignored() {
        let oap = "f:\n  description: \"the OAP wording\"\n  type: string\n";
        let fac = "f:\n  description: \"DIFFERENT factory wording\"\n  type: string\n";
        assert!(diffs_exact(oap, fac).is_empty());
        assert!(diffs_floor(oap, fac).is_empty());
    }

    // Section-scoped: adapter-determined sections excluded; governance compared.
    #[test]
    fn section_scoped_ignores_adapter_sections_but_checks_governance() {
        let oap = "schema_version: \"1.1.0\"\n\
                   directory_conventions:\n  api_controller: string\n\
                   governance:\n  max_tier: string\n  agents_from: string\n";
        let fac = "schema_version: \"1.1.0\"\n\
                   directory_conventions:\n  api_endpoint: string\n  bff_proxy: string\n\
                   governance:\n  max_tier: string\n  agents_from: string\n";
        let mut out = Vec::new();
        compare_section_scoped(&shape_yaml(oap), &shape_yaml(fac), &["schema_version", "governance"], &mut out);
        assert!(out.is_empty(), "adapter-specialised sections must be excluded: {out:?}");
    }
    #[test]
    fn section_scoped_flags_governance_drift() {
        let oap = "schema_version: \"1.1.0\"\n\
                   governance:\n  max_tier: string\n  agents_from: string\n";
        let fac = "schema_version: \"1.1.0\"\n\
                   governance:\n  max_tier: string\n"; // factory dropped a governance key
        let mut out = Vec::new();
        compare_section_scoped(&shape_yaml(oap), &shape_yaml(fac), &["schema_version", "governance"], &mut out);
        assert!(out.iter().any(|(p, _)| p == "governance.agents_from"), "{out:?}");
    }
    #[test]
    fn section_scoped_flags_dual_stack_variant_drift() {
        // Regression for the 2026-06-12 OPC adapter-load failure: the factory
        // side renaming/dropping a dual_stack variant key must now be caught.
        let oap = "schema_version: \"1.1.0\"\n\
                   dual_stack:\n  audience_to_variant:\n    citizen: string\n  variants:\n    public:\n      web: string\n";
        let fac = "schema_version: \"1.1.0\"\n\
                   dual_stack:\n  audience_to_stack:\n    citizen: string\n  stacks:\n    public:\n      web: string\n"; // legacy stack-model drift
        let mut out = Vec::new();
        compare_section_scoped(
            &shape_yaml(oap),
            &shape_yaml(fac),
            &["schema_version", "governance", "dual_stack"],
            &mut out,
        );
        assert!(
            out.iter().any(|(p, _)| p == "dual_stack.audience_to_variant"
                || p == "dual_stack.variants"),
            "stack->variant drift must be flagged: {out:?}"
        );
    }
    #[test]
    fn section_scoped_dual_stack_aligned_passes() {
        // When both sides carry the variant model, dual_stack is clean.
        let s = "schema_version: \"1.1.0\"\n\
                 dual_stack:\n  audience_to_variant:\n    citizen: string\n  variants:\n    public:\n      web: string\n      port_web: integer\n";
        let mut out = Vec::new();
        compare_section_scoped(
            &shape_yaml(s),
            &shape_yaml(s),
            &["schema_version", "governance", "dual_stack"],
            &mut out,
        );
        assert!(out.is_empty(), "aligned dual_stack must not drift: {out:?}");
    }

    // AC-3: GoA-concept guard.
    #[test]
    fn guard_catches_protected_label() {
        let mut out = Vec::new();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.yaml");
        std::fs::write(&p, "classification:\n  enum: [Protected B, Protected C]\n").unwrap();
        guard_scan(&p, true, &mut out).unwrap();
        assert!(out.iter().any(|h| h.token == "Protected B"), "{out:?}");
    }
    #[test]
    fn guard_catches_catalog_auto_value() {
        let mut out = Vec::new();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.yaml");
        std::fs::write(&p, "implementation_status:\n  enum: [live, stub, catalog-auto]\n").unwrap();
        guard_scan(&p, true, &mut out).unwrap();
        assert!(out.iter().any(|h| h.token == "catalog-auto"), "{out:?}");
    }
    #[test]
    fn guard_ignores_rejection_documentation_comment() {
        // The schema's own comment documenting the rejection must NOT trip the guard.
        let mut out = Vec::new();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.yaml");
        std::fs::write(
            &p,
            "# NOTE: deliberately NO catalog-auto / service-catalogue value (classification labels live in the adapter layer)\nimplementation_status:\n  enum: [live, stub, deferred]\n",
        )
        .unwrap();
        guard_scan(&p, true, &mut out).unwrap();
        assert!(out.is_empty(), "comment-only rejection doc must not be flagged: {out:?}");
    }
    #[test]
    fn guard_ignores_ordinary_lowercase_public() {
        // `public` as a legitimate view_type/auth enum value is not a classification label.
        let mut out = Vec::new();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.yaml");
        std::fs::write(&p, "view_type:\n  enum: [public, public-authenticated, private-authenticated]\n").unwrap();
        guard_scan(&p, true, &mut out).unwrap();
        assert!(out.is_empty(), "lowercase public enum must not be flagged: {out:?}");
    }
    #[test]
    fn guard_ignores_forbidden_token_in_description_value() {
        // A description that NAMES a rejected GoA concept to document the
        // rejection is prose, not contract structure — must not trip the guard
        // (AC-3). Both YAML and JSON-Schema description shapes.
        // JSON case is pretty-printed (one key per line) — the shape the real
        // stage-output schemas use; the line-based prose skip assumes that.
        for (name, body) in [
            ("y.yaml", "classification:\n  description: \"Do NOT accept Protected B in this surface\"\n  type: string\n"),
            ("j.json", "{\n  \"properties\": {\n    \"x\": {\n      \"description\": \"no Protected C / service catalogue here\"\n    }\n  }\n}\n"),
        ] {
            let mut out = Vec::new();
            let dir = tempfile::tempdir().unwrap();
            let p = dir.path().join(name);
            std::fs::write(&p, body).unwrap();
            guard_scan(&p, strip_for(&p), &mut out).unwrap();
            assert!(out.is_empty(), "forbidden token in a description value must not be flagged ({name}): {out:?}");
        }
        // ...but the SAME token as an actual enum value still fails.
        let mut out = Vec::new();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("real.yaml");
        std::fs::write(&p, "classification:\n  enum: [Protected B]\n").unwrap();
        guard_scan(&p, true, &mut out).unwrap();
        assert!(out.iter().any(|h| h.token == "Protected B"), "a real enum value must still fail: {out:?}");
    }
}
