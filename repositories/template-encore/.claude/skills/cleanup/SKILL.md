---
name: cleanup
description: Run dead-code and duplicate-code detection across the npm/TypeScript surface, get categorized cleanup recommendations
allowed-tools: Task, Read, Bash, Glob, Grep, Edit
---

# /cleanup — Cleanup Analysis

## Purpose

Spawn a cleanup-analyzer sub-agent that runs dead-code and duplicate-code detection across this repo's npm/TypeScript surface (`apps/web`, `apps/web-internal`, `apps/api`, `packages/`), investigates each finding in context, and returns a structured report with categorized recommendations.

Optional detectors (`knip`, `jscpd`) are used when available and skipped gracefully when they aren't — the substrate is a template, not a toolchain mandate.

## Usage

```
/cleanup              # run all detectors (dead code + duplicates)
/cleanup dead-code    # unused/dead code only
/cleanup duplicates   # duplicate code only
```

## Execution

### Step 1: Parse Arguments

Determine which detectors to run from `$ARGUMENTS`. Default is both. Valid tokens: `dead-code`, `duplicates`.

### Step 2: Spawn the Cleanup Analyzer

Use the `Task` tool to spawn a sub-agent with the following prompt. Pass the selected detectors as input.

---

**Sub-agent prompt (pass this entire block to Task):**

You are a cleanup analyzer for an npm/TypeScript spec-spine substrate. Your job is to run static analysis, investigate each finding in the actual code, and return a structured report. You MUST NOT make any changes — only analyze and report.

**Detectors to run:** [insert selected detectors here]

### A. Dead Code Detection

#### A.1: TypeScript/JavaScript surface (`apps/*`, `packages/*`)

```bash
# Optional: knip if installed and configured. Skip silently if not.
for dir in apps/web apps/web-internal apps/api packages/shared; do
  if [ -f "$dir/package.json" ]; then
    echo "=== knip: $dir ==="
    (cd "$dir" && npx --yes --no-install knip --no-exit-code 2>/dev/null) \
      || echo "(knip not available or not configured for $dir — skipping)"
  fi
done
```

```bash
# Fallback: orphan files in the app/package src trees (zero inbound imports).
# Skip common entry-point file names.
for f in $(find apps/*/src packages/*/src -type f \
            \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.vue' \) \
            2>/dev/null \
            | grep -v node_modules | grep -v '\.d\.ts$' \
            | grep -v '\.test\.' | grep -v '\.spec\.'); do
  base=$(basename "$f" | sed 's/\.[^.]*$//')
  case "$base" in
    index|main|env|vite-env|server|app|router|store) continue ;;
  esac
  count=$(grep -rE "from ['\"].*${base}['\"]|require\(['\"].*${base}['\"]\)" \
            apps packages \
            --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.vue' \
            -l 2>/dev/null | grep -v "$f" | grep -v node_modules | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "ORPHAN: $f"
  fi
done
```

```bash
# npm run lint as a secondary dead-code signal (unused vars, imports).
npm run lint 2>&1 | grep -E "no-unused|unused" || echo "(no unused lint findings)"
```

#### A.2: Unused npm dependencies

Check for declared dependencies with no actual usage in the package source:

```bash
for pkg in apps/web apps/web-internal apps/api packages/shared; do
  [ -f "$pkg/package.json" ] || continue
  echo "=== potential unused deps: $pkg ==="
  (cd "$pkg" && npx --yes --no-install depcheck --json 2>/dev/null \
    | npx --yes --no-install json -e 'this.unusedDependencies.forEach(d => console.log("UNUSED:", d))' 2>/dev/null) \
    || echo "(depcheck not available — skipping $pkg)"
done
```

If `depcheck` is not available, fall back to manual grep-based analysis.

### B. Duplicate Code Detection

```bash
# Optional: jscpd if installed. Skip silently if not available.
if npx --yes --no-install jscpd --version >/dev/null 2>&1; then
  npx --yes --no-install jscpd apps packages \
    --min-lines 10 \
    --min-tokens 50 \
    --ignore "node_modules,dist,build,.git,*.d.ts,encore.gen,package-lock.json" \
    --reporters console \
    2>/dev/null \
    || echo "(jscpd run did not complete cleanly)"
else
  echo "(jscpd not available — skipping duplicate detection)"
fi
```

```bash
# Manual: surface near-identical function signatures across packages as
# a low-fidelity duplicate-block hint. Treat results as starting points
# for human review, not definitive findings.
for pkg_dir in apps/*/src packages/*/src; do
  [ -d "$pkg_dir" ] || continue
  echo "=== $(dirname $pkg_dir) ==="
  grep -rn "export function \|export const \|function " "$pkg_dir" 2>/dev/null \
    | awk -F: '{print $3}' | sort | uniq -d
done
```

### C. Investigate Each Finding

For EVERY finding from the tools above, you MUST read the relevant source file(s) to understand context before categorizing. Do not blindly report tool output.

### D. Categorize Findings

**Dead Code — KEEP (false-positive prevention):**

- **Spec-spine CLI surface**: anything produced by `npx spec-spine` into `.derived/` — never hand-edited, always regenerated.- **Encore-generated files** under `apps/api/encore.gen/`: generated by the Encore CLI; editing by hand is a violation.
- **Express/Encore app wiring + route/middleware registries** under `apps/api/src/`: assembled at startup, so not always reachable by a static import-graph walk.
- **Vue component files** under `apps/web/src/` and `apps/web-internal/src/` referenced only by template `<...>` tags or route definitions: static `import`-graph analysis misses these.
- **Build/CI scripts** under `.github/workflows/`, `.githooks/`, `tools/lint/`.- **Test fixtures and utilities**.
- **`packages/shared` template shells**: the shared shape is a template feature, not a duplicate.

**Dead Code — Safe to Remove (high confidence):**

- Unused non-library files with zero imports anywhere in the surface.
- TypeScript private items the linter explicitly flags as unused with no suppression comment.
- Dependencies in `package.json` with zero usage across their owning package.

**Dead Code — Needs Review:**

- Files that look like planned work (check `git log` for recent additions).
- Ambiguous dependency usage (might be injected at runtime or in a build script).
- Exported items flagged unused inside their package — may be intentional public API for downstream consumers.

**Duplicate Code — By Priority:**

- **High** (>15 lines of business logic, complex conditionals): recommend extraction.
- **Medium** (10–15 lines of utilities/transformations): consider extraction.
- **Low** (<10 lines, simple patterns, boilerplate): likely intentional.

**Duplicate Code — Keep as Intentional:**

- The per-app scaffolding (`apps/web`, `apps/web-internal`): the parallel shape is a template feature, not a duplicate.- Test setup / fixture code (test isolation matters more than DRY).
- Simple TypeScript idioms under 10 lines (guard clauses, optional chaining patterns, builder boilerplate).

### E. Return Structured Report

Return EXACTLY this format:

```markdown
## Cleanup Analysis Report

### Dead Code Findings

#### Safe to Remove (high confidence)

| Item | Type | Location | Reason |
|------|------|----------|--------|
| ... | unused file / unused dep / dead export | path | why it is safe |

#### Needs Review

| Item | Type | Location | Context |
|------|------|----------|---------|
| ... | ... | path | what investigation revealed |

#### Keeping (intentional / false positive)

| Item | Reason |
|------|--------|
| ... | encore-generated / spec-derived / module-manifest / etc. |

### Duplicate Code Findings

#### High Priority (recommend extraction)

- **[description]** — [N lines]
  - Locations: `file:lines`, `file:lines`
  - Recommendation: extract to [suggested location]

#### Medium Priority (consider extraction)

- **[description]** — [N lines]
  - Locations: `file:lines`, `file:lines`

#### Keep As-Is (intentional)

- **[description]** — [reason]

### Detectors

- knip: {ran / skipped — reason}
- depcheck: {ran / skipped — reason}
- jscpd: {ran / skipped — reason}
- npm run lint unused findings: {N findings}

### Summary

- **N** items safe to auto-remove
- **N** items need human review
- **N** duplicate blocks worth addressing
- **N** items confirmed as intentional (false positives filtered)
```

**Guidelines for the sub-agent:**
- DO read code to understand context before categorizing.
- DO be conservative — better to flag "needs review" than to recommend removing something that breaks the build or violates spec/code coupling.
- DO surface when an optional detector was unavailable; don't silently produce a partial report.
- DO NOT make any changes to any files.
- DO NOT explore the codebase for problems beyond what the detectors find.
- DO NOT create any files.
- DO NOT recommend removing any path claimed by a spec without checking via `npx spec-spine registry show <id>`. Spec-claimed paths require their owning spec to change in the same diff (coupling gate, spec 000 FR-07).

---

### Step 3: Present Results

Display the sub-agent's structured report to the user.

### Step 4: Offer Next Steps

After presenting the report, ask the user:

> Would you like me to:
> 1. Remove the "safe to remove" items automatically
> 2. Walk through the "needs review" items one by one
> 3. Just keep this report for reference

If option 1 is chosen, remember: any path claimed by a spec (visible via `npx spec-spine registry show <id>`) cannot be touched without amending or superseding its owning spec. The coupling gate will refuse the diff otherwise.
