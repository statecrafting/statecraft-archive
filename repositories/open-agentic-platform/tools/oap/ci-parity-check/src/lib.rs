//! CI parity drift-check (spec 104, rebound by spec 135 FR-04).
//!
//! For every enforcing GitHub Actions workflow, extract significant command
//! tokens from each step's `run:` block and assert they appear in the root
//! Makefile. Drift means the Makefile has fallen behind CI — a gate exists
//! in CI that `make ci-strict` does not mirror.
//!
//! Spec 135 (2026-05-03) reversed the `ci` ↔ `ci-fast` semantic positions:
//! `make ci` is now the parity-exempt fast loop (sentinel-bracketed); the
//! parity-bound recipe is `make ci-strict`. The `# BEGIN ci-fast (spec 134)`
//! / `# END ci-fast` sentinel markers are unchanged — they bind to the spec
//! 134 contract identifier, not the make-target name.

use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Deserialize)]
struct Workflow {
    jobs: BTreeMap<String, Job>,
}

#[derive(Debug, Deserialize, Default)]
struct Job {
    #[serde(default)]
    steps: Vec<Step>,
}

#[derive(Debug, Deserialize, Default)]
struct Step {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    run: Option<String>,
}

/// Workflows whose gates `make ci-strict` must mirror. Order is stable for reporting.
/// Keep in sync with spec 104 §2.2 (post-spec-135 amendment).
///
/// Workflows that exist as **coverage** (running tests already mirrored by an
/// enforcing workflow, on triggers the enforcing workflow's path filter
/// misses) belong in [`COVERAGE_WORKFLOWS`] below. They are intentionally NOT
/// in this list because the tests they run are already covered by the
/// enforcing workflow's broader job — adding them here would over-count the
/// `make ci-strict` mirror obligation.
pub const ENFORCING_WORKFLOWS: &[&str] = &[
    "ci-axiomregent.yml",
    // spec 188 Phase 3 — the broad `ci-codebase-index.yml` staleness gate
    // was retired (the broad index is now a best-effort cache; drift is
    // surfaced post-merge by the report-only `cd-index-staleness-report.yml`,
    // parity-exempt per §5). The NARROW config-hash gate replaced it in the
    // constitutional set; on 2026-06-10 its `check-config` run-block was
    // re-homed from the standalone `ci-config-hash.yml` (deleted) into
    // `spec-conformance.yml`, already in this list — `make ci-config-hash`
    // still mirrors the run-block.
    "ci-crates.yml",
    "ci-deployd-api-rs.yml",
    "ci-desktop.yml",
    // spec 212 — cross-repo factory contract lockstep; `make ci-strict`
    // mirrors it via the `factory-schema-lockstep` target (cargo build + the
    // checker invocation). The against-main cron lane
    // (ci-factory-schema-lockstep-cron.yml) is advisory, NOT enforcing.
    "ci-factory-schema-lockstep.yml",
    "ci-orchestrator.yml",
    "ci-policy-kernel.yml",
    // spec 191 — schema-parity gate; `make ci-strict` mirrors it via
    // the `ci-schema-parity` target (cargo fingerprints + bun walker).
    "ci-schema-parity.yml",
    "ci-spec-code-coupling.yml",
    "ci-statecraft.yml",
    // spec 211 — the DB-bound encore-test lane; `make ci-strict` mirrors it
    // via the `ci-statecraft-encore` target (lane derivation + encore test +
    // the skip-as-pass coverage guard).
    "ci-statecraft-encore.yml",
    "ci-supply-chain.yml",
    "spec-conformance.yml",
];

/// Workflows that run **existing** tests on triggers the enforcing set
/// misses — closing path-filter gaps without adding new test surface.
///
/// These exist as durable coverage for cases where a test's actual input
/// surface (e.g. `specs/**`) doesn't match the path filter of the enforcing
/// workflow that owns the test (e.g. `ci-crates.yml`, which filters on
/// `crates/**` + `Cargo.toml`/`Cargo.lock` + workspace tool roots). On PRs
/// that trigger both an enforcing workflow and a coverage workflow, both
/// fire and both run the same test — the redundancy is the price of
/// structural drift-prevention.
///
/// Why they are NOT in [`ENFORCING_WORKFLOWS`]:
///
/// 1. `make ci-strict` already mirrors the underlying test via the enforcing
///    workflow that runs it as part of a broader job. Listing the coverage
///    workflow here would falsely claim a *second* mirror obligation for
///    a test that's already in the strict-mirror set once.
/// 2. Adding a coverage entry would force authoring a Makefile target that
///    duplicates work already covered by the enforcing target's broader
///    job — the kind of redundancy spec 135 §2 explicitly refused.
///
/// Forward-looking gap: no automated check today asserts that every
/// `.github/workflows/*.yml` lands in exactly one of these two sets.
/// A future "ghost workflow" gate analogous to spec 135's "ghost crate"
/// closure could add that assertion. For now, the lists are
/// authored-and-reviewed plus a unit test below (`enforcing_and_coverage_disjoint`)
/// asserts they're at least non-overlapping.
pub const COVERAGE_WORKFLOWS: &[&str] = &[
    // Issue #192 / PR #193. Runs
    // `crates/featuregraph/tests/golden.rs::test_golden_graph` on changes
    // under `specs/**`, which `ci-crates.yml`'s path filter misses. The
    // golden test is also run by `ci-crates.yml` as part of
    // `cargo test --workspace`; `make ci-strict` mirrors that via
    // `ci-rust`. No new mirror obligation lands with this entry.
    "ci-featuregraph-golden.yml",
];

/// Lines that appear in an enforcing workflow but have no local analogue.
/// Each entry MUST carry a one-line rationale. If this grows past ~5 entries,
/// spec 104 must be revisited (FR-06, SC-04).
const ALLOW_LIST: &[&str] = &[
    // ci-desktop.yml creates a sidecar binary stub named for the CI runner's
    // host triple (aarch64-apple-darwin on macOS runners). The Makefile's
    // ci-desktop target creates the same stub using the local host triple
    // detected at runtime: not byte-identical, but equivalent in intent.
    "axiomregent-aarch64-apple-darwin",
    // ci-spec-code-coupling.yml runs the coupling gate against the PR's
    // base/head SHAs with the PR body as the waiver source. The Makefile
    // mirror (ci-spec-code-coupling) runs the same `spec-spine couple` against
    // the working-tree-vs-origin/main diff via `--paths-from`. Same gate,
    // intentionally different invocation per environment (spec 217 rewire of
    // the former spec-code-coupling-check call). Pre-spec-217 this was masked
    // by the workflow's two-line `\` continuation (the args landed on a line
    // whose first word was not a significant command); the single-line CLI
    // form exposes it, so allowlist the CI-specific invocation explicitly.
    "spec-spine couple --base \"$BASE_SHA\"",
];

#[derive(Debug, Clone)]
pub struct Drift {
    pub workflow: String,
    pub job: String,
    pub step: String,
    pub missing_token: String,
    pub source_line: String,
}

/// Run the parity check against `repo_root`. Returns `Ok(vec![])` when the
/// Makefile mirrors every significant `run:` token across every enforcing
/// workflow.
pub fn check_parity(repo_root: &Path) -> Result<Vec<Drift>, String> {
    let raw = fs::read_to_string(repo_root.join("Makefile"))
        .map_err(|e| format!("reading Makefile: {e}"))?;
    // Spec 134 §FR-03: lines between `# BEGIN ci-fast (spec 134)` and
    // `# END ci-fast` are parity-exempt. Strip them before scanning so
    // tokens inside that region neither satisfy parity nor are scanned for it.
    let makefile = strip_cifast_region(&raw);
    let workflows_dir = repo_root.join(".github").join("workflows");

    let mut drifts = Vec::new();
    for wf_name in ENFORCING_WORKFLOWS {
        let wf_path = workflows_dir.join(wf_name);
        let content = fs::read_to_string(&wf_path)
            .map_err(|e| format!("reading {}: {e}", wf_path.display()))?;
        let wf: Workflow = serde_yaml::from_str(&content)
            .map_err(|e| format!("parsing {}: {e}", wf_path.display()))?;

        for (job_name, job) in &wf.jobs {
            for step in &job.steps {
                let Some(run) = &step.run else { continue };
                let step_name = step.name.clone().unwrap_or_else(|| "<unnamed>".to_string());

                for raw_line in run.lines() {
                    let line = normalise(raw_line);
                    if line.is_empty() {
                        continue;
                    }
                    if allow_list_suppresses(&line) {
                        continue;
                    }
                    let tokens = significant_tokens(&line);
                    if tokens.is_empty() {
                        continue;
                    }
                    for token in &tokens {
                        if !makefile.contains(token) {
                            drifts.push(Drift {
                                workflow: (*wf_name).to_string(),
                                job: job_name.clone(),
                                step: step_name.clone(),
                                missing_token: token.clone(),
                                source_line: line.clone(),
                            });
                            break; // report first missing token per line
                        }
                    }
                }
            }
        }
    }
    Ok(drifts)
}

fn allow_list_suppresses(line: &str) -> bool {
    ALLOW_LIST.iter().any(|entry| line.contains(entry))
}

/// Sentinel markers bracketing the parity-exempt `ci-fast` region in the
/// Makefile (spec 134 §FR-03). Match leading whitespace tolerantly but
/// require the marker text to be exact so a comment that happens to
/// mention `ci-fast` doesn't accidentally open the region.
const CIFAST_BEGIN: &str = "# BEGIN ci-fast (spec 134)";
const CIFAST_END: &str = "# END ci-fast";

/// Strip the parity-exempt `ci-fast` region (spec 134 §FR-03) from a
/// Makefile string before parity scanning. Lines between (and including)
/// the BEGIN/END sentinels are removed; everything outside is preserved
/// verbatim, including line breaks, so substring matches behave identically.
///
/// Unmatched markers (BEGIN without END, or END without BEGIN) are tolerated
/// by treating an unclosed BEGIN as opening a region that runs to EOF, and
/// a stray END outside a region as a no-op. This is forgiving by design —
/// the load-bearing assertion is that real `ci-fast` recipe lines do not
/// satisfy parity, not that the markers are perfectly balanced.
fn strip_cifast_region(makefile: &str) -> String {
    let mut out = String::with_capacity(makefile.len());
    let mut in_region = false;
    for line in makefile.lines() {
        let trimmed = line.trim_start();
        if !in_region && trimmed.starts_with(CIFAST_BEGIN) {
            in_region = true;
            continue;
        }
        if in_region && trimmed.starts_with(CIFAST_END) {
            in_region = false;
            continue;
        }
        if !in_region {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// Precondition check (spec 104 fix 4): fresh-clone execution parity.
//
// `ci-parity-check` base pass guarantees command equality between workflow
// and Makefile. It does NOT guarantee that running those commands on a
// fresh clone yields the same result as running them in a dev workspace.
//
// The concrete case that prompted this: a `spec-conformance.yml` step ran
// `codebase-indexer check` BEFORE `codebase-indexer compile`. The tool read
// `.derived/codebase-index/index.json`; on CI's fresh clone it did not exist,
// so the step failed with ENOENT while `make ci-tools` passed locally.
// (That broad `check` was retired by spec 188 Phase 4b, which gitignores the
// broad index; the narrow `check-config` reads the tracked `config-hash.json`.)
//
// The rule: any step that invokes a "consumer" of a governed artifact
// under `build/` MUST be preceded (in the same job) by a "producer" of
// that artifact, OR the artifact MUST be tracked in git. Otherwise the
// CI runner has nothing to feed the consumer and will error.
// ─────────────────────────────────────────────────────────────────────────────

struct ConsumerRule {
    pattern: &'static str,
    artifact: &'static str,
}

struct ProducerRule {
    pattern: &'static str,
    artifact: &'static str,
}

/// Commands known to READ a governed artifact under `.derived/`.
/// Extend as new tools are added to the governed-read surface.
const CONSUMERS: &[ConsumerRule] = &[
    // Spec 217: the in-tree engine was replaced by the published `spec-spine`
    // CLI, and the registry/index are sharded (spec 188-supersession commits
    // the shards present-on-clone). The config-slice check reads slices.json;
    // the broad index check + render and the registry reads read the shard
    // trees. NOTE: the `--slice` rule MUST precede the bare `index check` rule
    // so the more specific artifact (slices.json) wins the first-match.
    ConsumerRule {
        pattern: "spec-spine index check --slice",
        artifact: ".derived/codebase-index/slices.json",
    },
    ConsumerRule {
        pattern: "spec-spine index check",
        artifact: ".derived/codebase-index/by-spec",
    },
    ConsumerRule {
        pattern: "spec-spine index render",
        artifact: ".derived/codebase-index/by-spec",
    },
    ConsumerRule {
        pattern: "spec-spine registry list",
        artifact: ".derived/spec-registry/by-spec",
    },
    ConsumerRule {
        pattern: "spec-spine registry show",
        artifact: ".derived/spec-registry/by-spec",
    },
    ConsumerRule {
        pattern: "spec-spine registry status-report",
        artifact: ".derived/spec-registry/by-spec",
    },
    ConsumerRule {
        pattern: "spec-spine registry relationships",
        artifact: ".derived/spec-registry/by-spec",
    },
    ConsumerRule {
        pattern: "oap-registry-enrich compliance-report",
        artifact: ".derived/spec-registry/registry-oap.json",
    },
];

/// Commands known to WRITE a governed artifact under `.derived/`.
const PRODUCERS: &[ProducerRule] = &[
    ProducerRule {
        pattern: "spec-spine compile",
        artifact: ".derived/spec-registry/by-spec",
    },
    // `spec-spine index` (bare) builds the index shards. It is a substring of
    // the `spec-spine index check`/`render` consumer lines, so a check/render
    // line also registers as a producer here; that is benign because the
    // committed shards satisfy `covered_by_git` post spec-188-supersession, so
    // it can never mask a real precondition into a false green.
    ProducerRule {
        pattern: "spec-spine index",
        artifact: ".derived/codebase-index/by-spec",
    },
    ProducerRule {
        pattern: "adapter-scopes-compiler",
        artifact: "platform/services/statecraft/api/factory/adapter-scopes.json",
    },
];

#[derive(Debug, Clone)]
pub struct PreconditionDrift {
    pub workflow: String,
    pub job: String,
    pub step: String,
    pub missing_artifact: String,
    pub consumer_line: String,
}

/// For every enforcing workflow, assert each governed-artifact consumer
/// has its artifact either (a) produced by an earlier step in the same job,
/// or (b) tracked in git.
pub fn check_preconditions(repo_root: &Path) -> Result<Vec<PreconditionDrift>, String> {
    let tracked = load_tracked_files(repo_root)?;
    let workflows_dir = repo_root.join(".github").join("workflows");
    let mut drifts = Vec::new();

    for wf_name in ENFORCING_WORKFLOWS {
        let wf_path = workflows_dir.join(wf_name);
        let content = fs::read_to_string(&wf_path)
            .map_err(|e| format!("reading {}: {e}", wf_path.display()))?;
        let wf: Workflow = serde_yaml::from_str(&content)
            .map_err(|e| format!("parsing {}: {e}", wf_path.display()))?;

        for (job_name, job) in &wf.jobs {
            let mut produced: BTreeSet<String> = BTreeSet::new();
            for step in &job.steps {
                let Some(run) = &step.run else { continue };
                let step_name = step.name.clone().unwrap_or_else(|| "<unnamed>".to_string());

                for raw_line in run.lines() {
                    let line = raw_line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if let Some(c) = CONSUMERS.iter().find(|c| line.contains(c.pattern)) {
                        let covered_by_earlier_step = covered(&produced, c.artifact);
                        let covered_by_git = covered(&tracked, c.artifact);
                        if !covered_by_earlier_step && !covered_by_git {
                            drifts.push(PreconditionDrift {
                                workflow: (*wf_name).to_string(),
                                job: job_name.clone(),
                                step: step_name.clone(),
                                missing_artifact: c.artifact.to_string(),
                                consumer_line: line.to_string(),
                            });
                        }
                    }
                }

                for raw_line in run.lines() {
                    if let Some(p) = PRODUCERS.iter().find(|p| raw_line.contains(p.pattern)) {
                        produced.insert(p.artifact.to_string());
                    }
                }
            }
        }
    }
    Ok(drifts)
}

fn load_tracked_files(repo_root: &Path) -> Result<BTreeSet<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["ls-files"])
        .output()
        .map_err(|e| format!("spawn git ls-files: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git ls-files exited with status {:?}",
            output.status.code()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::to_string)
        .collect())
}

/// True when `artifact` is satisfied by `set`: either an exact member, or a
/// directory whose shard files live under it (`<artifact>/...`). Spec 217
/// sharded the registry/index, so they are committed (and produced) as
/// `by-spec/*.json` / `by-package/*.json` files rather than a bare directory
/// path; an exact `.contains` would miss every committed shard.
fn covered(set: &BTreeSet<String>, artifact: &str) -> bool {
    if set.contains(artifact) {
        return true;
    }
    let prefix = format!("{artifact}/");
    set.iter().any(|p| p.starts_with(&prefix))
}

/// Normalise a raw `run:` line: strip whitespace, line-continuation slash,
/// trailing `# comment`, and obvious shell suffixes.
fn normalise(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.ends_with('\\') {
        s.pop();
        s = s.trim_end().to_string();
    }
    if let Some(idx) = s.find(" # ") {
        s.truncate(idx);
    }
    for suffix in [" || true", " 2>&1", " > /dev/null"] {
        if let Some(stripped) = s.strip_suffix(suffix) {
            s = stripped.to_string();
        }
    }
    s.trim().to_string()
}

/// Extract the tokens we expect to find mirrored in the Makefile.
/// Returns empty for lines that aren't validation commands (shell control
/// flow, variable assignments, echo/cd/grep preambles, etc.).
pub fn significant_tokens(line: &str) -> Vec<String> {
    let words: Vec<&str> = line.split_whitespace().collect();
    if words.is_empty() {
        return vec![];
    }
    let cmd = words[0];
    // `spec-spine` is the published governance CLI invoked bare on PATH
    // (spec 217 replaced the in-tree `./tools/spec-spine/*` engine binaries);
    // it must stay significant so Makefile<->workflow parity still compares
    // the compile/index/registry/couple commands.
    let significant = matches!(cmd, "cargo" | "pnpm" | "npm" | "npx" | "node" | "spec-spine")
        || cmd.starts_with("./tools/");
    if !significant {
        return vec![];
    }
    let mut out = vec![cmd.to_string()];
    let mut i = 1usize;
    while i < words.len() {
        let w = words[i];
        // `--` separator — cargo clippy passes flags after it; skip the marker.
        if w == "--" {
            i += 1;
            continue;
        }
        // GitHub Actions matrix/expression substitution (`${{ matrix.x }}`)
        // can't possibly be a literal token in the Makefile. Strip the three
        // whitespace-split fragments together so the Makefile recipe (which
        // uses `$$VAR` or an explicit list) is still considered a valid mirror.
        if w == "${{" {
            // Skip until we see the closing `}}`.
            let mut j = i + 1;
            while j < words.len() && words[j] != "}}" {
                j += 1;
            }
            i = j + 1;
            continue;
        }
        // Flags that consume the next token as their value.
        if matches!(w, "--manifest-path" | "--target" | "--all" | "--filter") {
            if let Some(v) = words.get(i + 1) {
                // If the value is a `${{ … }}` expression, skip the flag entirely
                // — it can't be mirrored as a literal token. The Makefile is
                // expected to provide an equivalent loop or per-target recipe.
                if *v == "${{" {
                    let mut j = i + 2;
                    while j < words.len() && words[j] != "}}" {
                        j += 1;
                    }
                    i = j + 1;
                    continue;
                }
                out.push(w.to_string());
                out.push((*v).to_string());
                i += 2;
                continue;
            }
        }
        // Paired short flags: `-D warnings`, `-A dead_code`.
        if (w == "-D" || w == "-A") && i + 1 < words.len() {
            out.push(format!("{w} {}", words[i + 1]));
            i += 2;
            continue;
        }
        // Shell operators — skip.
        if matches!(w, "|" | "&&" | "||" | ">" | ">>" | "<" | "2>&1") {
            i += 1;
            continue;
        }
        out.push(w.to_string());
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Workflows must land in exactly one of `ENFORCING_WORKFLOWS` or
    /// `COVERAGE_WORKFLOWS`. Overlap would mean both a mirror obligation
    /// AND a coverage classification on the same workflow — incoherent.
    #[test]
    fn enforcing_and_coverage_disjoint() {
        for wf in COVERAGE_WORKFLOWS {
            assert!(
                !ENFORCING_WORKFLOWS.contains(wf),
                "{wf} is in both ENFORCING_WORKFLOWS and COVERAGE_WORKFLOWS — \
                 a workflow is either mirrored to `make ci-strict` (enforcing) \
                 or runs an already-mirrored test on a missed trigger \
                 (coverage), never both",
            );
        }
    }

    #[test]
    fn tokens_cargo_test_with_manifest_path_and_filter() {
        let t = significant_tokens(
            "cargo test --manifest-path tools/spec-spine/registry-consumer/Cargo.toml --all readme_",
        );
        assert!(t.contains(&"cargo".into()));
        assert!(t.contains(&"test".into()));
        assert!(t.contains(&"--manifest-path".into()));
        assert!(t.contains(&"tools/spec-spine/registry-consumer/Cargo.toml".into()));
        assert!(t.contains(&"--all".into()));
        assert!(t.contains(&"readme_".into()));
    }

    #[test]
    fn tokens_clippy_paired_flags() {
        let t = significant_tokens(
            "cargo clippy --manifest-path apps/opc/src-tauri/Cargo.toml -- -A dead_code -D warnings",
        );
        assert!(t.contains(&"-A dead_code".into()));
        assert!(t.contains(&"-D warnings".into()));
    }

    #[test]
    fn tokens_pnpm_filter() {
        let t = significant_tokens("pnpm --filter @opc/desktop exec tsc --noEmit");
        assert!(t.contains(&"pnpm".into()));
        assert!(t.contains(&"--filter".into()));
        assert!(t.contains(&"@opc/desktop".into()));
        assert!(t.contains(&"--noEmit".into()));
    }

    #[test]
    fn tokens_skip_shell_assignment() {
        // Shell var assignment with $() subshell — not a direct command.
        let t = significant_tokens("CARGO_VERSION=$(grep '^version' apps/opc/src-tauri/Cargo.toml)");
        assert!(t.is_empty());
    }

    #[test]
    fn tokens_strip_matrix_expression_value() {
        let t = significant_tokens(
            "cargo check --target ${{ matrix.target }} --manifest-path apps/opc/src-tauri/Cargo.toml",
        );
        assert!(t.contains(&"cargo".into()));
        assert!(t.contains(&"--manifest-path".into()));
        assert!(t.contains(&"apps/opc/src-tauri/Cargo.toml".into()));
        // The matrix expression and its sigils MUST NOT leak into the output.
        for forbidden in ["${{", "matrix.target", "}}"] {
            assert!(
                !t.iter().any(|tok| tok == forbidden),
                "found forbidden token {forbidden:?} in {t:?}",
            );
        }
    }

    #[test]
    fn tokens_strip_matrix_expression_standalone() {
        let t = significant_tokens(
            "cargo build --release --target ${{ matrix.target }} --manifest-path crates/axiomregent/Cargo.toml",
        );
        for forbidden in ["${{", "matrix.target", "}}"] {
            assert!(!t.iter().any(|tok| tok == forbidden));
        }
        assert!(t.contains(&"crates/axiomregent/Cargo.toml".into()));
    }

    #[test]
    fn tokens_tool_binary_invocation() {
        let t = significant_tokens("spec-spine compile");
        assert!(t.contains(&"spec-spine".into()));
        assert!(t.contains(&"compile".into()));
    }

    #[test]
    fn normalise_strips_trailing_inline_comment() {
        assert_eq!(normalise("cargo test # a comment"), "cargo test");
    }

    #[test]
    fn normalise_strips_or_true_suffix() {
        assert_eq!(normalise("./tools/spec-spine/spec-lint/target/release/spec-lint || true"),
                   "./tools/spec-spine/spec-lint/target/release/spec-lint");
    }

    #[test]
    fn allow_list_matches_substring() {
        assert!(allow_list_suppresses(
            "touch apps/opc/src-tauri/binaries/axiomregent-aarch64-apple-darwin"
        ));
        assert!(!allow_list_suppresses("cargo test --manifest-path crates/agent/Cargo.toml"));
    }

    #[test]
    fn cifast_strip_removes_bracketed_region() {
        let mk = "ci-rust:\n\tcargo test --manifest-path crates/foo/Cargo.toml\n# BEGIN ci-fast (spec 134)\nci-fast-rust:\n\tcargo nextest run --workspace\n# END ci-fast\nci-tools:\n\tcargo build\n";
        let stripped = strip_cifast_region(mk);
        // Outside the region, content is preserved verbatim.
        assert!(stripped.contains("cargo test --manifest-path crates/foo/Cargo.toml"));
        assert!(stripped.contains("ci-tools:"));
        assert!(stripped.contains("cargo build"));
        // Inside the region, nothing leaks through — neither the recipe lines
        // nor the sentinel markers themselves.
        assert!(!stripped.contains("ci-fast-rust:"));
        assert!(!stripped.contains("cargo nextest run --workspace"));
        assert!(!stripped.contains("BEGIN ci-fast"));
        assert!(!stripped.contains("END ci-fast"));
    }

    #[test]
    fn cifast_strip_no_region_is_identity_modulo_trailing_newline() {
        // Real Makefiles always end with newline. strip_cifast_region
        // normalises to one trailing newline per line; for an unbracketed
        // input the only difference is at most a final newline.
        let mk = "ci-rust:\n\tcargo test\nci-tools:\n\tcargo build\n";
        let stripped = strip_cifast_region(mk);
        assert!(stripped.contains("ci-rust:"));
        assert!(stripped.contains("\tcargo test"));
        assert!(stripped.contains("ci-tools:"));
        assert!(stripped.contains("\tcargo build"));
    }

    #[test]
    fn cifast_strip_tolerates_unclosed_begin() {
        // Spec 134 §FR-03 forgiving behaviour: an unclosed BEGIN runs to EOF.
        let mk = "ci-rust:\n\tcargo test\n# BEGIN ci-fast (spec 134)\nci-fast-rust:\n\tcargo nextest run\n";
        let stripped = strip_cifast_region(mk);
        assert!(stripped.contains("cargo test"));
        assert!(!stripped.contains("ci-fast-rust:"));
        assert!(!stripped.contains("cargo nextest run"));
    }

    #[test]
    fn cifast_strip_ignores_indented_marker_text() {
        // Markers must be at line start (after leading whitespace) and exact.
        // A line that merely *mentions* the marker text doesn't open a region.
        let mk = "ci-rust:\n\tcargo test\n# Note: avoid # BEGIN ci-fast (spec 134) inside echo blocks\n\tcargo build\n";
        let stripped = strip_cifast_region(mk);
        // Both recipe lines survive — the marker-mentioning comment doesn't
        // open a region because `# BEGIN ci-fast (spec 134)` is not at the
        // start of the line (after whitespace).
        assert!(stripped.contains("\tcargo test"));
        assert!(stripped.contains("\tcargo build"));
    }

    #[test]
    fn consumer_rules_cover_governed_reads() {
        // Every governed-read consumer we care about MUST resolve to some
        // artifact under build/. If a new consumer is added without a rule,
        // this is the test that should fail.
        let lines = [
            // Spec 217: the rewired governed-read commands (spec-spine CLI).
            "spec-spine index check --slice claude-config",
            "spec-spine index render",
            "spec-spine registry list",
            "spec-spine registry status-report --json",
        ];
        for line in lines {
            assert!(
                CONSUMERS.iter().any(|c| line.contains(c.pattern)),
                "no consumer rule matched line: {line}"
            );
        }
    }

    #[test]
    fn producer_rules_cover_governed_writes() {
        let lines = [
            "spec-spine compile",
            "spec-spine index",
            "./tools/oap/adapter-scopes-compiler/target/release/adapter-scopes-compiler",
        ];
        for line in lines {
            assert!(
                PRODUCERS.iter().any(|p| line.contains(p.pattern)),
                "no producer rule matched line: {line}"
            );
        }
    }
}
