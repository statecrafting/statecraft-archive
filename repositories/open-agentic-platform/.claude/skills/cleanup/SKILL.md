---
name: cleanup
allowed-tools: [Task, Read, Bash, Glob, Grep, Edit]
description: 'Run dead code and duplicate detection, get categorized cleanup recommendations'
---

# /cleanup - Cleanup Analysis

## Purpose

Spawn a cleanup-analyzer agent that runs dead code detection and duplicate code detection across the monorepo, investigates each finding in context, and returns a structured report with categorized recommendations.

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

You are a cleanup analyzer. Your job is to run static analysis, investigate each finding in the actual code, and return a structured report. You MUST NOT make any changes -- only analyze and report.

**Detectors to run:** [insert selected detectors here]

### A. Dead Code Detection

Run these commands to find unused exports, files, and dependencies:

**For TypeScript/JavaScript packages:**

```bash
# Find unused exports across the monorepo
# Check each package that has a tsconfig
for dir in apps/opc packages/ui tools/spec-spine/spec-lint; do
  if [ -f "$dir/package.json" ]; then
    echo "=== Checking $dir ==="
    cd "$dir" && npx --yes knip --no-exit-code 2>/dev/null || echo "(knip not configured for $dir)"
    cd -
  fi
done
```

```bash
# Find files with zero inbound imports (TypeScript/JavaScript only)
for f in $(find apps packages tools -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' 2>/dev/null | grep -v node_modules | grep -v '.d.ts' | grep -v '__tests__' | grep -v '.test.' | grep -v '.spec.'); do
  basename=$(basename "$f" | sed 's/\.[^.]*$//')
  if [ "$basename" != "index" ] && [ "$basename" != "main" ] && [ "$basename" != "vite-env" ]; then
    count=$(grep -r "$basename" apps/ packages/ tools/ --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' -l 2>/dev/null | grep -v "$f" | grep -v node_modules | wc -l)
    if [ "$count" -eq 0 ]; then
      echo "ORPHAN: $f"
    fi
  fi
done
```

**For Rust crates:**

```bash
# Check for dead code in Rust crates
cd crates && cargo check 2>&1 | grep -E "warning.*dead_code|warning.*unused" || echo "(no dead code warnings)"
cd -
```

```bash
# Find unused dependencies in Rust
for dir in crates/*/; do
  if [ -f "$dir/Cargo.toml" ]; then
    echo "=== $dir ==="
    cargo +nightly udeps --package $(basename "$dir") 2>/dev/null || echo "(udeps not available, skipping)"
  fi
done
```

If knip or udeps are not available, fall back to manual grep-based analysis: search for imports/uses of each exported symbol.

### B. Duplicate Code Detection

```bash
# Run jscpd for TypeScript/JavaScript
npx --yes jscpd apps/ packages/ tools/ \
  --min-lines 10 \
  --min-tokens 50 \
  --ignore "node_modules,dist,build,.git,*.d.ts,pnpm-lock.yaml" \
  --reporters console \
  2>/dev/null || echo "(jscpd failed or not available)"
```

```bash
# For Rust: find similar blocks using basic pattern matching
for crate_dir in crates/*/src; do
  echo "=== Checking $(dirname $crate_dir) ==="
  grep -n "pub fn\|fn " "$crate_dir"/*.rs "$crate_dir"/**/*.rs 2>/dev/null | sort -t: -k3 | uniq -d -f2
done
```

### C. Investigate Each Finding

For EVERY finding from the tools above, you MUST read the relevant source file(s) to understand context before categorizing. Do not blindly report tool output.

### D. Categorize Findings

**Dead Code -- KEEP (false-positive prevention):**

- UI component library files in `packages/ui/` (component library -- may be used by consumers)
- Radix/shadcn dependencies used by ANY UI component
- All barrel exports (`index.ts` files) and re-exports
- Tauri-related dependencies (`@tauri-apps/*`, tauri plugin crates)
- Platform-specific code gated by `cfg(target_os = ...)` in Rust
- Public API types that may be consumed externally
- MCP protocol handlers (may be invoked dynamically)
- Grammar files in `grammars/` (used at build time or runtime)
- Spec files in `specs/` (documentation/specification, not runtime code)
- Build/CI scripts in `scripts/`, `.github/`, `build/`
- Test utilities and fixtures

**Dead Code -- Safe to Remove (high confidence):**

- Unused non-library files with zero imports anywhere
- Dependencies with zero usage across the entire monorepo
- Unused devDependencies for tools not configured
- Dead Rust code flagged by the compiler with no `#[allow(dead_code)]` justification

**Dead Code -- Needs Review:**

- Files that might be planned features (check git log for recent additions)
- Ambiguous dependency usage (might be used in build scripts or config)
- Type exports that might be part of a public API
- Rust functions marked `pub` but unused within the crate (may be public API)

**Duplicate Code -- By Priority:**

- **High** (>15 lines of business logic, complex conditionals): recommend extraction
- **Medium** (10-15 lines of utilities/transformations): consider extraction
- **Low** (<10 lines, simple patterns, boilerplate): likely intentional

**Duplicate Code -- Keep as Intentional:**

- UI component patterns (consistency across component library)
- Test setup/fixture code (test isolation is more important than DRY)
- Type definitions across crate boundaries (decoupling > deduplication)
- Rust error handling idioms (`match` on Result/Option)
- Simple patterns under 10 lines
- MCP handler boilerplate (protocol compliance)

### E. Return Structured Report

Return EXACTLY this format:

```markdown
## Cleanup Analysis Report

### Dead Code Findings

#### Safe to Remove (high confidence)

| Item | Type | Location | Reason |
|------|------|----------|--------|
| ... | unused file / unused dep / dead fn | path | why it is safe |

#### Needs Review

| Item | Type | Location | Context |
|------|------|----------|---------|
| ... | ... | path | what investigation revealed |

#### Keeping (intentional / false positive)

| Item | Reason |
|------|--------|
| ... | UI library / barrel export / platform-specific / etc. |

### Duplicate Code Findings

#### High Priority (recommend extraction)

- **[description]** -- [N lines]
  - Locations: `file:lines`, `file:lines`
  - Recommendation: extract to [suggested location]

#### Medium Priority (consider extraction)

- **[description]** -- [N lines]
  - Locations: `file:lines`, `file:lines`

#### Keep As-Is (intentional)

- **[description]** -- [reason]

### Summary

- **N** items safe to auto-remove
- **N** items need human review
- **N** duplicate blocks worth addressing
- **N** items confirmed as intentional (false positives filtered)
```

**Guidelines for the sub-agent:**
- DO read code to understand context before categorizing
- DO be conservative -- better to flag "needs review" than to recommend removing something that breaks the build
- DO NOT make any changes to any files
- DO NOT explore the codebase for problems beyond what the detectors find
- DO NOT create any files

---

### Step 3: Present Results

Display the sub-agent's structured report to the user.

### Step 4: Offer Next Steps

After presenting the report, ask the user:

> Would you like me to:
> 1. Remove the "safe to remove" items automatically
> 2. Walk through the "needs review" items one by one
> 3. Just keep this report for reference
