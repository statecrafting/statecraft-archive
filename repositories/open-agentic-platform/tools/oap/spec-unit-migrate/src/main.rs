//! `spec-unit-migrate` — one-shot Segment 5 migrator (spec 154 §9).
//!
//! Rewrites legacy path-string declarations in every `specs/*/spec.md`
//! frontmatter into typed logical-unit form. Idempotent: items already
//! carrying a `unit:` field pass through unchanged.
//!
//! Conversion rules per spec 154 §3 / §5:
//!
//! - `establishes: [<bare-path>, ...]`
//!   → one item per path: `{ unit: { kind: <classified>, ... } }`.
//! - `extends: [{ spec, paths, nature, ...other }]`
//!   → one item per path, each carrying the surrounding `spec`/`nature`
//!   plus `unit:`.
//! - `refines: [{ aspect, paths, ...other }]`
//!   → one item per path, each carrying `aspect` plus `unit:`.
//! - `co_authority: [{ paths, section, with_specs, ...other }]`
//!   → one item per path, with `unit: { kind: section, file: <path>,
//!   anchor: <section> }` when `section` is set, else `unit:` is the
//!   classified kind on the bare path.
//! - `constrains: [{ kind | flavor, paths, ...other }]`
//!   → renames `kind` → `flavor`; splits into one item per path each
//!   with `unit:`.
//! - `supersedes: [{ spec, scope, paths?, ...other }]`
//!   → splits per-path when `paths:` is present (partial supersession);
//!   whole-spec items pass through unchanged.
//! - `amends:` — short form (id list) passes through; long form items
//!   with `paths:` are split per path.
//! - `references: [<bare-path>, ...]`
//!   → one item per path: `{ unit: { kind: <classified>, ... } }`.
//!
//! Path classification:
//!
//! - Workspace member root (Rust `[workspace].members` or npm package
//!   under `product/apps/*` / `product/packages/*`) → `crate:` with the
//!   manifest's `name` as `id`.
//! - Otherwise directory on disk → `directory:`.
//! - Otherwise file on disk → `file:`.
//! - Otherwise (orphan / not-on-disk path) → `file:` with a warning.

use clap::Parser;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Parser, Debug)]
#[command(
    name = "spec-unit-migrate",
    about = "Spec 154 Segment 5 — migrate spec frontmatter relationship-field paths to typed unit declarations.",
    version
)]
struct Cli {
    /// Repo root.
    #[arg(long, default_value = ".")]
    repo: PathBuf,
    /// Restrict to the named spec id(s). Without this flag, every
    /// `specs/*/spec.md` is migrated.
    #[arg(long)]
    spec: Vec<String>,
    /// Don't write files; print a summary of changes.
    #[arg(long)]
    dry_run: bool,
    /// Quieter output for full-corpus runs.
    #[arg(long)]
    quiet: bool,
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    let ctx = match WorkspaceCtx::load(&cli.repo) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("spec-unit-migrate: load workspace: {e}");
            return std::process::ExitCode::from(2);
        }
    };
    let specs_dir = cli.repo.join("specs");
    let mut total = 0usize;
    let mut migrated = 0usize;
    let mut skipped = 0usize;
    let mut warnings: Vec<String> = Vec::new();
    for entry in WalkDir::new(&specs_dir).max_depth(2) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.file_name() != "spec.md" {
            continue;
        }
        let path = entry.path();
        let spec_id = path
            .parent()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if !cli.spec.is_empty() && !cli.spec.iter().any(|s| s == &spec_id) {
            continue;
        }
        total += 1;
        let original = match fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                warnings.push(format!("{}: read failed: {e}", path.display()));
                continue;
            }
        };
        let outcome = match migrate(&original, &ctx, &cli.repo) {
            Ok(o) => o,
            Err(e) => {
                warnings.push(format!("{}: migrate failed: {e}", path.display()));
                continue;
            }
        };
        if outcome.changed {
            migrated += 1;
            if !cli.quiet {
                eprintln!(
                    "{}: migrated ({} field(s)) ",
                    path.display(),
                    outcome.fields_changed
                );
            }
            for w in &outcome.warnings {
                warnings.push(format!("{}: {w}", path.display()));
            }
            if !cli.dry_run {
                if let Err(e) = fs::write(path, &outcome.new_text) {
                    warnings.push(format!("{}: write failed: {e}", path.display()));
                }
            }
        } else {
            skipped += 1;
        }
    }
    eprintln!(
        "\nspec-unit-migrate: scanned {total}, migrated {migrated}, already-typed {skipped}"
    );
    if !warnings.is_empty() {
        eprintln!("\n{} warning(s):", warnings.len());
        for w in &warnings {
            eprintln!("  {w}");
        }
    }
    std::process::ExitCode::SUCCESS
}

// ── Workspace context ──────────────────────────────────────────────────────

#[derive(Debug, Default)]
struct WorkspaceCtx {
    /// Map: workspace-member directory (relative, POSIX) → manifest
    /// `name`. Rust crates and npm packages share this map; the
    /// resolver's `crate:` kind treats them uniformly per spec 154 §3.1.
    crate_at_path: BTreeMap<String, String>,
    repo: PathBuf,
}

impl WorkspaceCtx {
    fn load(repo: &Path) -> Result<Self, String> {
        let mut ctx = WorkspaceCtx {
            crate_at_path: BTreeMap::new(),
            repo: repo.to_path_buf(),
        };
        // Rust workspace members.
        let root_manifest = fs::read_to_string(repo.join("Cargo.toml"))
            .map_err(|e| format!("read Cargo.toml: {e}"))?;
        let root: toml::Value = root_manifest
            .parse()
            .map_err(|e| format!("parse root Cargo.toml: {e}"))?;
        if let Some(members) = root
            .get("workspace")
            .and_then(|w| w.get("members"))
            .and_then(|m| m.as_array())
        {
            for m in members {
                let Some(p) = m.as_str() else {
                    continue;
                };
                let manifest = repo.join(p).join("Cargo.toml");
                let Ok(text) = fs::read_to_string(&manifest) else {
                    continue;
                };
                let Ok(parsed) = text.parse::<toml::Value>() else {
                    continue;
                };
                if let Some(name) = parsed
                    .get("package")
                    .and_then(|p| p.get("name"))
                    .and_then(|n| n.as_str())
                {
                    ctx.crate_at_path
                        .insert(p.to_string(), name.to_string());
                }
            }
        }
        // npm packages under product/ (apps + packages).
        for pkg_root in ["product/apps", "product/packages"] {
            let full = repo.join(pkg_root);
            if !full.exists() {
                continue;
            }
            for entry in WalkDir::new(&full).max_depth(3) {
                let Ok(entry) = entry else { continue };
                if !entry.file_type().is_file() || entry.file_name() != "package.json" {
                    continue;
                }
                let Some(parent) = entry.path().parent() else {
                    continue;
                };
                let Ok(rel) = parent.strip_prefix(repo) else {
                    continue;
                };
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                let Ok(text) = fs::read_to_string(entry.path()) else {
                    continue;
                };
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                    ctx.crate_at_path.insert(rel_str, name.to_string());
                }
            }
        }
        Ok(ctx)
    }

    /// Classify `path_in` against the worktree. Returns the typed unit
    /// when the path resolves cleanly; returns `None` when the path is
    /// not on disk (an "orphan" path the spec author claimed but never
    /// landed). Orphan paths cannot be safely typed: an explicit
    /// `file:` declaration would trip V-023 at compile time (spec 155
    /// §2.4 — missing-file is unconditionally a hard error in the
    /// resolver compile context). Spec 154 §8 keeps legacy bare-string
    /// form valid; the migration emits orphan paths as bare strings so
    /// the corpus remains compile-clean. Segment 6 (legacy excision)
    /// must resolve the orphans — delete the claim, reclassify under
    /// `references:`, or land the missing target — before flipping the
    /// parser.
    fn classify(&self, path_in: &str) -> Option<Unit> {
        let clean = path_in.trim_end_matches('/');
        // Paths under the resolver's standard exclusion set (spec 154
        // §3.7) point to generated build output, not authored sources.
        // The file may exist locally after `make registry` etc. but
        // not in fresh checkouts — explicit `file:` declarations would
        // then trip I-008 in CI mirrors. Keep these in legacy form so
        // the indexer's I-108 advisory remains the right diagnostic
        // surface.
        const GENERATED_PREFIXES: &[&str] = &[
            ".derived/",
            "target/",
            "node_modules/",
            "dist/",
            "build/",
            ".next/",
        ];
        if GENERATED_PREFIXES.iter().any(|p| clean.starts_with(p)) {
            return None;
        }
        if let Some(name) = self.crate_at_path.get(clean) {
            return Some(Unit::Crate { id: name.clone() });
        }
        let full = self.repo.join(clean);
        if full.is_dir() {
            return Some(Unit::Directory {
                path: clean.to_string(),
            });
        }
        if full.is_file() {
            return Some(Unit::File {
                path: clean.to_string(),
            });
        }
        None
    }

    /// Check whether a `section:` anchor exists in the target file
    /// under the per-file-kind anchor syntax of spec 152 §2.1.
    /// Returns `false` if the file is absent or the anchor cannot be
    /// found — those co_authority items stay in legacy form so the
    /// resolver's I-006 diagnostic does not regress under migration.
    /// The check is intentionally coarse (substring on the anchor
    /// marker line) — the resolver's strict parser is the
    /// authoritative check; this heuristic only decides whether to
    /// emit the typed form during migration.
    fn anchor_exists(&self, file: &str, anchor: &str) -> bool {
        let full = self.repo.join(file);
        let Ok(content) = fs::read_to_string(&full) else {
            return false;
        };
        if file == "Makefile" || file.ends_with("/Makefile") {
            // `## tag: <anchor>` line.
            for line in content.lines() {
                if let Some(rest) = line.trim_start().strip_prefix("## tag:") {
                    if rest.trim() == anchor {
                        return true;
                    }
                }
            }
            return false;
        }
        if file.ends_with(".yml") || file.ends_with(".yaml") {
            // Top-level `jobs:` mapping + the named job. Coarse check:
            // scan for a line `<anchor>:` indented two spaces under
            // `jobs:` — accept any matching indentation.
            let mut in_jobs = false;
            for line in content.lines() {
                let trim = line.trim_start();
                if line.starts_with("jobs:") {
                    in_jobs = true;
                    continue;
                }
                if in_jobs {
                    let indent = line.len() - trim.len();
                    if !line.is_empty() && indent == 0 {
                        in_jobs = false;
                    } else if let Some(rest) = trim.strip_suffix(':') {
                        if rest == anchor {
                            return true;
                        }
                    }
                }
            }
            return false;
        }
        if file.ends_with(".md") {
            // GFM heading slug — coarse match: any `# Heading` line
            // whose slugified text equals the anchor.
            for line in content.lines() {
                let trim = line.trim_start();
                if !trim.starts_with('#') {
                    continue;
                }
                let text = trim.trim_start_matches('#').trim();
                let slug: String = text
                    .chars()
                    .filter_map(|c| match c {
                        c if c.is_alphanumeric() => Some(c.to_ascii_lowercase()),
                        ' ' | '-' | '_' => Some('-'),
                        _ => None,
                    })
                    .collect();
                if slug == anchor {
                    return true;
                }
            }
            return false;
        }
        // For other file kinds (Rust, TS, JS, TOML, shell, etc.) —
        // mirror the resolver's RegionMarkerParser, which is hardcoded
        // to `// region: <anchor>` (no support for `# region:` even
        // though spec 152 §2.1 names that as the shell-script form).
        // The discrepancy is a known Segment 3 implementation gap;
        // until it lands, shell anchors must stay in legacy form.
        for line in content.lines() {
            let trimmed = line.trim_start();
            let Some(rest) = trimmed.strip_prefix("//") else {
                continue;
            };
            let Some(name) = rest.trim_start().strip_prefix("region:") else {
                continue;
            };
            if name.trim() == anchor {
                return true;
            }
        }
        false
    }
}

// ── Unit shape ─────────────────────────────────────────────────────────────

#[derive(Debug)]
enum Unit {
    Crate { id: String },
    Directory { path: String },
    File { path: String },
    Section { file: String, anchor: String },
}

impl Unit {
    fn to_inline(&self) -> String {
        match self {
            Unit::Crate { id } => format!("{{ kind: crate, id: {} }}", yaml_scalar(id)),
            Unit::Directory { path } => {
                format!("{{ kind: directory, path: {} }}", yaml_scalar(path))
            }
            Unit::File { path } => format!("{{ kind: file, path: {} }}", yaml_scalar(path)),
            Unit::Section { file, anchor } => {
                format!(
                    "{{ kind: section, file: {}, anchor: {} }}",
                    yaml_scalar(file),
                    yaml_scalar(anchor)
                )
            }
        }
    }
}

/// Emit `s` as a YAML scalar inside flow-style context, quoting only
/// when the value contains characters that would otherwise be parsed
/// as flow syntax or YAML indicators. The conservative trigger set
/// covers npm scoped-package names (`@scope/pkg` — `@` is a reserved
/// indicator in YAML 1.1 / 1.2 plain scalars) and any plain-scalar
/// hazards like flow punctuation or unicode quirks.
fn yaml_scalar(s: &str) -> String {
    let needs_quote = s.is_empty()
        || s.starts_with(['@', '`', '*', '&', '!', '|', '>', '%', '?', '-', ',', '['])
        || s.chars().any(|c| matches!(c, '{' | '}' | '[' | ']' | ',' | '#'))
        || s.contains(": ")
        || s.ends_with(':');
    if needs_quote {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

// ── Migration driver ───────────────────────────────────────────────────────

#[derive(Debug)]
struct MigrationOutcome {
    changed: bool,
    fields_changed: usize,
    new_text: String,
    warnings: Vec<String>,
}

const FIELDS: &[&str] = &[
    "establishes",
    "extends",
    "refines",
    "supersedes",
    "amends",
    "co_authority",
    "constrains",
    "references",
];

fn migrate(
    original: &str,
    ctx: &WorkspaceCtx,
    _repo: &Path,
) -> Result<MigrationOutcome, String> {
    // Locate the frontmatter — between the first two `---` lines.
    let mut lines: Vec<String> = original.lines().map(|l| l.to_string()).collect();
    // Track whether the original ends with a trailing newline so we can
    // round-trip without spuriously adding/removing it.
    let trailing_newline = original.ends_with('\n');
    let mut fm_start: Option<usize> = None;
    let mut fm_end: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if line == "---" {
            if fm_start.is_none() {
                fm_start = Some(i);
            } else {
                fm_end = Some(i);
                break;
            }
        }
    }
    let (Some(fm_start), Some(fm_end)) = (fm_start, fm_end) else {
        return Ok(MigrationOutcome {
            changed: false,
            fields_changed: 0,
            new_text: original.to_string(),
            warnings: Vec::new(),
        });
    };
    // Migrate from the bottom up so indices stay valid.
    let mut fields_changed = 0usize;
    let mut warnings: Vec<String> = Vec::new();
    // Find each relationship-field block in the frontmatter, top-down,
    // collect (start_index, end_index, field_name), then apply
    // bottom-up.
    let mut blocks: Vec<(usize, usize, String)> = Vec::new();
    let mut i = fm_start + 1;
    while i < fm_end {
        let line = &lines[i];
        let stripped = line.trim_end();
        // Detect a top-level relationship-field header. The header may
        // be `field:` (block-style value following) or `field: [...]`
        // (inline list — these are short-form amends/etc that don't
        // need migration). We treat only the block-style form here.
        if let Some(field) = top_level_field(stripped) {
            if FIELDS.contains(&field) {
                // Find block end: the next zero-indent non-empty line
                // OR fm_end.
                let mut j = i + 1;
                while j < fm_end {
                    let l = &lines[j];
                    if l.is_empty() {
                        j += 1;
                        continue;
                    }
                    let leading = l.chars().take_while(|c| c.is_whitespace()).count();
                    if leading == 0 {
                        break;
                    }
                    j += 1;
                }
                blocks.push((i, j, field.to_string()));
                i = j;
                continue;
            }
        }
        i += 1;
    }
    for (block_start, block_end, field) in blocks.into_iter().rev() {
        let block_lines = &lines[block_start..block_end];
        let block_text = block_lines.join("\n");
        match migrate_block(&field, &block_text, ctx) {
            Ok(MigratedBlock::Same) => {}
            Ok(MigratedBlock::Replaced { text, warnings: w }) => {
                let new_lines: Vec<String> =
                    text.lines().map(|l| l.to_string()).collect();
                lines.splice(block_start..block_end, new_lines);
                fields_changed += 1;
                warnings.extend(w);
            }
            Err(e) => {
                warnings.push(format!("field {field}: {e}"));
            }
        }
    }
    let mut new_text = lines.join("\n");
    if trailing_newline && !new_text.ends_with('\n') {
        new_text.push('\n');
    }
    Ok(MigrationOutcome {
        changed: new_text != original,
        fields_changed,
        new_text,
        warnings,
    })
}

fn top_level_field(line: &str) -> Option<&str> {
    if line.is_empty() || line.starts_with(' ') || line.starts_with('\t') {
        return None;
    }
    // `field:` (block-style; nothing or only whitespace follows the colon)
    // distinguishes block values from inline scalars / sequences.
    let colon = line.find(':')?;
    let key = &line[..colon];
    let rest = line[colon + 1..].trim();
    if !rest.is_empty() {
        return None;
    }
    if key.chars().all(|c| c.is_alphanumeric() || c == '_') {
        Some(key)
    } else {
        None
    }
}

// ── Per-field block migration ──────────────────────────────────────────────

#[derive(Debug)]
enum MigratedBlock {
    Same,
    Replaced {
        text: String,
        warnings: Vec<String>,
    },
}

fn migrate_block(
    field: &str,
    block_text: &str,
    ctx: &WorkspaceCtx,
) -> Result<MigratedBlock, String> {
    // Parse the block as a single-key mapping via serde_yaml. The block
    // is well-formed YAML in isolation.
    let parsed: serde_yaml::Mapping = serde_yaml::from_str(block_text)
        .map_err(|e| format!("parse block: {e}"))?;
    let value = parsed
        .get(serde_yaml::Value::String(field.to_string()))
        .cloned()
        .ok_or_else(|| format!("field {field} not found in block"))?;
    let Some(items) = value.as_sequence().cloned() else {
        // Field has a non-sequence value (e.g. `amends: ["..."]` parsed
        // inline) — but block-form is what we matched above; treat as
        // pass-through.
        return Ok(MigratedBlock::Same);
    };
    let mut new_items: Vec<MigratedItem> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut any_change = false;
    for item in items {
        match migrate_item(field, &item, ctx, &mut warnings) {
            ItemOutcome::Unchanged => new_items.push(MigratedItem::Verbatim(item)),
            ItemOutcome::Split(items) => {
                any_change = true;
                new_items.extend(items.into_iter().map(MigratedItem::Generated));
            }
        }
    }
    if !any_change {
        return Ok(MigratedBlock::Same);
    }
    let mut out = format!("{field}:\n");
    for item in &new_items {
        match item {
            MigratedItem::Verbatim(v) => {
                emit_verbatim_item(&mut out, v);
            }
            MigratedItem::Generated(g) => {
                out.push_str(g);
            }
        }
    }
    // Trim trailing newline so splice doesn't double up.
    while out.ends_with('\n') {
        out.pop();
    }
    Ok(MigratedBlock::Replaced {
        text: out,
        warnings,
    })
}

#[derive(Debug)]
enum MigratedItem {
    Verbatim(serde_yaml::Value),
    Generated(String),
}

#[derive(Debug)]
enum ItemOutcome {
    Unchanged,
    Split(Vec<String>),
}

fn migrate_item(
    field: &str,
    item: &serde_yaml::Value,
    ctx: &WorkspaceCtx,
    warnings: &mut Vec<String>,
) -> ItemOutcome {
    // Already-typed items (any item carrying a `unit:` key) are left
    // alone — idempotent pass.
    if let Some(map) = item.as_mapping() {
        if map.contains_key(serde_yaml::Value::String("unit".to_string())) {
            return ItemOutcome::Unchanged;
        }
    }
    match field {
        "establishes" => migrate_bare_path_item(item, ctx, warnings),
        "references" => migrate_bare_path_item(item, ctx, warnings),
        "extends" => migrate_extends_or_refines_item(field, item, ctx, warnings, "spec"),
        "refines" => migrate_extends_or_refines_item(field, item, ctx, warnings, "aspect"),
        "co_authority" => migrate_co_authority_item(item, ctx, warnings),
        "constrains" => migrate_constrains_item(item, ctx, warnings),
        "supersedes" => migrate_supersedes_item(item, ctx, warnings),
        "amends" => migrate_amends_item(item, ctx, warnings),
        _ => ItemOutcome::Unchanged,
    }
}

fn migrate_bare_path_item(
    item: &serde_yaml::Value,
    ctx: &WorkspaceCtx,
    warnings: &mut Vec<String>,
) -> ItemOutcome {
    if let Some(path) = item.as_str() {
        match ctx.classify(path) {
            Some(unit) => {
                let s = format!("  - unit: {}\n", unit.to_inline());
                return ItemOutcome::Split(vec![s]);
            }
            None => {
                // Orphan path — emit legacy bare-string form so the
                // implicit file: parse path keeps the corpus
                // compile-clean (spec 154 §8). Segment 6 must resolve.
                warnings.push(format!("orphan path kept as legacy bare string: {path}"));
                return ItemOutcome::Unchanged;
            }
        }
    }
    ItemOutcome::Unchanged
}

fn migrate_extends_or_refines_item(
    _field: &str,
    item: &serde_yaml::Value,
    ctx: &WorkspaceCtx,
    warnings: &mut Vec<String>,
    primary_key: &str, // "spec" for extends, "aspect" for refines
) -> ItemOutcome {
    let Some(map) = item.as_mapping() else {
        return ItemOutcome::Unchanged;
    };
    let Some(paths) = map
        .get(serde_yaml::Value::String("paths".to_string()))
        .and_then(|v| v.as_sequence())
        .cloned()
    else {
        return ItemOutcome::Unchanged;
    };
    let primary = map
        .get(serde_yaml::Value::String(primary_key.to_string()))
        .cloned();
    let nature = map
        .get(serde_yaml::Value::String("nature".to_string()))
        .cloned();
    let mut out: Vec<String> = Vec::new();
    let mut orphans: Vec<String> = Vec::new();
    for p in &paths {
        let Some(path_str) = p.as_str() else {
            warnings.push(format!("non-string path in {primary_key} item"));
            continue;
        };
        let Some(unit) = ctx.classify(path_str) else {
            warnings.push(format!(
                "orphan path kept as legacy paths item: {path_str}"
            ));
            orphans.push(path_str.to_string());
            continue;
        };
        out.push(emit_keyed_item(
            primary_key,
            primary.as_ref(),
            nature.as_ref(),
            &unit,
        ));
    }
    if !orphans.is_empty() {
        out.push(emit_legacy_paths_item(
            primary_key,
            primary.as_ref(),
            nature.as_ref(),
            &orphans,
        ));
    }
    if out.is_empty() {
        ItemOutcome::Unchanged
    } else {
        ItemOutcome::Split(out)
    }
}

/// Emit a single typed-unit item carrying `{primary_key}: <primary>`,
/// optional `nature:`, and `unit:` at the same indent. Order follows
/// the spec 154 canonical examples (primary key first, modifiers, then
/// `unit:` last).
fn emit_keyed_item(
    primary_key: &str,
    primary: Option<&serde_yaml::Value>,
    nature: Option<&serde_yaml::Value>,
    unit: &Unit,
) -> String {
    let mut s = String::from("  - ");
    let mut first = true;
    if let Some(pv) = primary {
        if let Some(pstr) = pv.as_str() {
            if first {
                s.push_str(&format!("{primary_key}: \"{pstr}\"\n"));
                first = false;
            } else {
                s.push_str(&format!("    {primary_key}: \"{pstr}\"\n"));
            }
        }
    }
    if let Some(nv) = nature {
        if let Some(nstr) = nv.as_str() {
            if first {
                s.push_str(&format!("nature: {nstr}\n"));
                first = false;
            } else {
                s.push_str(&format!("    nature: {nstr}\n"));
            }
        }
    }
    if first {
        s.push_str(&format!("unit: {}\n", unit.to_inline()));
    } else {
        s.push_str(&format!("    unit: {}\n", unit.to_inline()));
    }
    s
}

/// Emit a single legacy item carrying `{primary_key}: <primary>`,
/// optional `nature:`, and a `paths: [list]` block. Used as the
/// catch-all for orphan paths a spec author claimed but never landed
/// — spec 154 §8 keeps this form valid for the migration window.
fn emit_legacy_paths_item(
    primary_key: &str,
    primary: Option<&serde_yaml::Value>,
    nature: Option<&serde_yaml::Value>,
    orphans: &[String],
) -> String {
    let mut s = String::from("  - ");
    let mut first = true;
    if let Some(pv) = primary {
        if let Some(pstr) = pv.as_str() {
            if first {
                s.push_str(&format!("{primary_key}: \"{pstr}\"\n"));
                first = false;
            } else {
                s.push_str(&format!("    {primary_key}: \"{pstr}\"\n"));
            }
        }
    }
    if first {
        s.push_str("paths:\n");
        first = false;
    } else {
        s.push_str("    paths:\n");
    }
    for p in orphans {
        s.push_str(&format!("      - {p}\n"));
    }
    if let Some(nv) = nature {
        if let Some(nstr) = nv.as_str() {
            s.push_str(&format!("    nature: {nstr}\n"));
        }
    }
    let _ = first;
    s
}

fn migrate_co_authority_item(
    item: &serde_yaml::Value,
    ctx: &WorkspaceCtx,
    warnings: &mut Vec<String>,
) -> ItemOutcome {
    let Some(map) = item.as_mapping() else {
        return ItemOutcome::Unchanged;
    };
    let Some(paths) = map
        .get(serde_yaml::Value::String("paths".to_string()))
        .and_then(|v| v.as_sequence())
        .cloned()
    else {
        return ItemOutcome::Unchanged;
    };
    let section = map
        .get(serde_yaml::Value::String("section".to_string()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let with_specs = map
        .get(serde_yaml::Value::String("with_specs".to_string()))
        .and_then(|v| v.as_sequence())
        .cloned();
    let mut out: Vec<String> = Vec::new();
    let mut orphans: Vec<String> = Vec::new();
    for p in &paths {
        let Some(path_str) = p.as_str() else {
            warnings.push("non-string path in co_authority item".to_string());
            continue;
        };
        let unit = if let Some(anchor) = &section {
            if !ctx.anchor_exists(path_str, anchor) {
                warnings.push(format!(
                    "orphan section anchor \"{anchor}\" not in {path_str} — kept as legacy"
                ));
                orphans.push(path_str.to_string());
                continue;
            }
            Unit::Section {
                file: path_str.to_string(),
                anchor: anchor.clone(),
            }
        } else if let Some(u) = ctx.classify(path_str) {
            u
        } else {
            warnings.push(format!(
                "orphan path kept as legacy co_authority paths item: {path_str}"
            ));
            orphans.push(path_str.to_string());
            continue;
        };
        out.push(emit_co_authority_item(with_specs.as_ref(), &unit));
    }
    if !orphans.is_empty() {
        out.push(emit_legacy_co_authority_item(
            &orphans,
            section.as_deref(),
            with_specs.as_ref(),
        ));
    }
    if out.is_empty() {
        ItemOutcome::Unchanged
    } else {
        ItemOutcome::Split(out)
    }
}

fn emit_co_authority_item(
    with_specs: Option<&Vec<serde_yaml::Value>>,
    unit: &Unit,
) -> String {
    let mut s = String::from("  -");
    if let Some(ws) = with_specs {
        s.push_str(" with_specs:\n");
        for w in ws {
            if let Some(wstr) = w.as_str() {
                s.push_str(&format!("      - \"{wstr}\"\n"));
            }
        }
        s.push_str(&format!("    unit: {}\n", unit.to_inline()));
    } else {
        s.push_str(&format!(" unit: {}\n", unit.to_inline()));
    }
    s
}

fn emit_legacy_co_authority_item(
    orphans: &[String],
    section: Option<&str>,
    with_specs: Option<&Vec<serde_yaml::Value>>,
) -> String {
    let mut s = String::from("  - paths:\n");
    for p in orphans {
        s.push_str(&format!("      - {p}\n"));
    }
    if let Some(sec) = section {
        s.push_str(&format!("    section: {sec}\n"));
    }
    if let Some(ws) = with_specs {
        s.push_str("    with_specs:\n");
        for w in ws {
            if let Some(wstr) = w.as_str() {
                s.push_str(&format!("      - \"{wstr}\"\n"));
            }
        }
    }
    s
}

fn migrate_constrains_item(
    item: &serde_yaml::Value,
    ctx: &WorkspaceCtx,
    warnings: &mut Vec<String>,
) -> ItemOutcome {
    let Some(map) = item.as_mapping() else {
        return ItemOutcome::Unchanged;
    };
    // `kind:` renamed to `flavor:` per spec 154 §5.
    let flavor = map
        .get(serde_yaml::Value::String("flavor".to_string()))
        .or_else(|| map.get(serde_yaml::Value::String("kind".to_string())))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let Some(paths) = map
        .get(serde_yaml::Value::String("paths".to_string()))
        .and_then(|v| v.as_sequence())
        .cloned()
    else {
        return ItemOutcome::Unchanged;
    };
    let mut out: Vec<String> = Vec::new();
    let mut orphans: Vec<String> = Vec::new();
    for p in &paths {
        let Some(path_str) = p.as_str() else {
            warnings.push("non-string path in constrains item".to_string());
            continue;
        };
        let Some(unit) = ctx.classify(path_str) else {
            warnings.push(format!(
                "orphan path kept as legacy constrains paths item: {path_str}"
            ));
            orphans.push(path_str.to_string());
            continue;
        };
        let mut s = String::from("  -");
        let mut first = true;
        if let Some(f) = &flavor {
            s.push_str(&format!(" flavor: {f}\n"));
            first = false;
        }
        if first {
            s.push_str(&format!(" unit: {}\n", unit.to_inline()));
        } else {
            s.push_str(&format!("    unit: {}\n", unit.to_inline()));
        }
        out.push(s);
    }
    if !orphans.is_empty() {
        let mut s = String::from("  -");
        let mut first = true;
        if let Some(f) = &flavor {
            s.push_str(&format!(" kind: {f}\n"));
            first = false;
        }
        if first {
            s.push_str(" paths:\n");
        } else {
            s.push_str("    paths:\n");
        }
        for p in &orphans {
            s.push_str(&format!("      - {p}\n"));
        }
        out.push(s);
    }
    if out.is_empty() {
        ItemOutcome::Unchanged
    } else {
        ItemOutcome::Split(out)
    }
}

fn migrate_supersedes_item(
    item: &serde_yaml::Value,
    ctx: &WorkspaceCtx,
    warnings: &mut Vec<String>,
) -> ItemOutcome {
    // Whole-spec supersession (no `paths:`) passes through; partial
    // supersession (with `paths:`) splits per path.
    let Some(map) = item.as_mapping() else {
        return ItemOutcome::Unchanged;
    };
    let Some(paths) = map
        .get(serde_yaml::Value::String("paths".to_string()))
        .and_then(|v| v.as_sequence())
        .cloned()
    else {
        return ItemOutcome::Unchanged;
    };
    let spec = map
        .get(serde_yaml::Value::String("spec".to_string()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let scope = map
        .get(serde_yaml::Value::String("scope".to_string()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut out: Vec<String> = Vec::new();
    let mut orphans: Vec<String> = Vec::new();
    for p in &paths {
        let Some(path_str) = p.as_str() else {
            warnings.push("non-string path in supersedes item".to_string());
            continue;
        };
        let Some(unit) = ctx.classify(path_str) else {
            warnings.push(format!(
                "orphan path kept as legacy supersedes paths item: {path_str}"
            ));
            orphans.push(path_str.to_string());
            continue;
        };
        let mut s = String::from("  -");
        let mut first = true;
        if let Some(sp) = &spec {
            s.push_str(&format!(" spec: \"{sp}\"\n"));
            first = false;
        }
        if let Some(sc) = &scope {
            if first {
                s.push_str(&format!(" scope: {sc}\n"));
                first = false;
            } else {
                s.push_str(&format!("    scope: {sc}\n"));
            }
        }
        if first {
            s.push_str(&format!(" unit: {}\n", unit.to_inline()));
        } else {
            s.push_str(&format!("    unit: {}\n", unit.to_inline()));
        }
        out.push(s);
    }
    if !orphans.is_empty() {
        let mut s = String::from("  -");
        let mut first = true;
        if let Some(sp) = &spec {
            s.push_str(&format!(" spec: \"{sp}\"\n"));
            first = false;
        }
        if let Some(sc) = &scope {
            if first {
                s.push_str(&format!(" scope: {sc}\n"));
                first = false;
            } else {
                s.push_str(&format!("    scope: {sc}\n"));
            }
        }
        if first {
            s.push_str(" paths:\n");
        } else {
            s.push_str("    paths:\n");
        }
        for p in &orphans {
            s.push_str(&format!("      - {p}\n"));
        }
        out.push(s);
    }
    if out.is_empty() {
        ItemOutcome::Unchanged
    } else {
        ItemOutcome::Split(out)
    }
}

fn migrate_amends_item(
    item: &serde_yaml::Value,
    ctx: &WorkspaceCtx,
    warnings: &mut Vec<String>,
) -> ItemOutcome {
    // Bare id strings (short form) pass through unchanged. Long-form
    // mapping items with `paths:` split per path.
    if item.as_str().is_some() {
        return ItemOutcome::Unchanged;
    }
    let Some(map) = item.as_mapping() else {
        return ItemOutcome::Unchanged;
    };
    let Some(paths) = map
        .get(serde_yaml::Value::String("paths".to_string()))
        .and_then(|v| v.as_sequence())
        .cloned()
    else {
        return ItemOutcome::Unchanged;
    };
    let spec = map
        .get(serde_yaml::Value::String("spec".to_string()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let flavor = map
        .get(serde_yaml::Value::String("flavor".to_string()))
        .or_else(|| map.get(serde_yaml::Value::String("kind".to_string())))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut out: Vec<String> = Vec::new();
    let mut orphans: Vec<String> = Vec::new();
    for p in &paths {
        let Some(path_str) = p.as_str() else {
            warnings.push("non-string path in amends item".to_string());
            continue;
        };
        let Some(unit) = ctx.classify(path_str) else {
            warnings.push(format!(
                "orphan path kept as legacy amends paths item: {path_str}"
            ));
            orphans.push(path_str.to_string());
            continue;
        };
        let mut s = String::from("  -");
        let mut first = true;
        if let Some(sp) = &spec {
            s.push_str(&format!(" spec: \"{sp}\"\n"));
            first = false;
        }
        if let Some(f) = &flavor {
            if first {
                s.push_str(&format!(" flavor: {f}\n"));
                first = false;
            } else {
                s.push_str(&format!("    flavor: {f}\n"));
            }
        }
        if first {
            s.push_str(&format!(" unit: {}\n", unit.to_inline()));
        } else {
            s.push_str(&format!("    unit: {}\n", unit.to_inline()));
        }
        out.push(s);
    }
    if !orphans.is_empty() {
        let mut s = String::from("  -");
        let mut first = true;
        if let Some(sp) = &spec {
            s.push_str(&format!(" spec: \"{sp}\"\n"));
            first = false;
        }
        if let Some(f) = &flavor {
            if first {
                s.push_str(&format!(" kind: {f}\n"));
                first = false;
            } else {
                s.push_str(&format!("    kind: {f}\n"));
            }
        }
        if first {
            s.push_str(" paths:\n");
        } else {
            s.push_str("    paths:\n");
        }
        for p in &orphans {
            s.push_str(&format!("      - {p}\n"));
        }
        out.push(s);
    }
    if out.is_empty() {
        ItemOutcome::Unchanged
    } else {
        ItemOutcome::Split(out)
    }
}

// ── Verbatim emission for already-typed items ─────────────────────────────

fn emit_verbatim_item(out: &mut String, item: &serde_yaml::Value) {
    // For items that are already in typed form (carry `unit:`), serialise
    // them back via serde_yaml but coerce the `unit:` value to inline
    // flow so the output matches the corpus style.
    match item {
        serde_yaml::Value::String(s) => {
            out.push_str(&format!("  - {s}\n"));
        }
        serde_yaml::Value::Mapping(_) => {
            // Best-effort: serde_yaml block-style emit. Acceptable; we
            // do not have a perfect block→inline coercion API.
            let yaml = serde_yaml::to_string(&serde_yaml::Value::Sequence(vec![item.clone()]))
                .unwrap_or_default();
            // Indent the result by two spaces under the field header.
            for line in yaml.lines() {
                if line.is_empty() {
                    continue;
                }
                if line.starts_with("- ") || line.starts_with("-") {
                    out.push_str("  ");
                    out.push_str(line);
                    out.push('\n');
                } else {
                    out.push_str(line);
                    out.push('\n');
                }
            }
        }
        _ => {
            out.push_str(&format!("  - {}\n", item_to_oneline(item)));
        }
    }
}

fn item_to_oneline(v: &serde_yaml::Value) -> String {
    serde_yaml::to_string(v).unwrap_or_default().trim().to_string()
}

#[derive(Deserialize)]
struct _CargoManifest {
    package: Option<_CargoPackage>,
}

#[derive(Deserialize)]
struct _CargoPackage {
    name: Option<String>,
}
