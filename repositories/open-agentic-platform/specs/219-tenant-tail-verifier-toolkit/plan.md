# Implementation Plan: Tenant-Tail Verifier Toolkit (spec 219)

> Refines the FR sketch into firm decisions per the spec's own "refine before
> implementation" instruction, and records the grounded reality that most of this
> spec already shipped cross-repo. The spec body's FR-006 / AC-8 are the only
> OAP-side leg; this plan pins that leg and the spec-edge correction it requires.

## Grounded state (what is already true, 2026-06-21)

The verify surface is built and vended. The `tenant-tail` repository
(`github.com/bartekus/tenant-tail`, npm `tenant-tail@0.1.0`, Apache-2.0) carries:

- both verify cores and verbs: `verify-certificate`, `verify-provenance` (PR #1);
- full spec-spine CI parity + determinism + ci-gate (PR #2);
- the npm wrapper (`npm/`, platform-package optionalDependencies, launcher);
- its own `specs/` corpus (spec-spine-dogfooded), including spec 218's
  corpus-binding verb (PR #3); spec-spine bumped to 0.8.0 (PRs #4-6).

That satisfies **FR-001 through FR-005** and **AC-1 through AC-7** in the
tenant-tail repo (the cross-repo posture the spec records in "Repository
topology"; not OAP registry edges, tracked in prose). It matches the
"tenant-tail now VENDED" project state.

**The only OAP-side obligation left is FR-006 / AC-8.**

## Decision 1: FR-006 footprint (the one spec-edge correction)

FR-006 retires the stale `cargo install --git ... --bin build-certificate --bin
verify-certificate` path in `crates/factory-engine/templates/kernel/toolchain.yaml.tmpl:26`
and homes the verifier on the `tenant-tail` npm pin. Grounding the edit shows the
footprint is **two OAP source files, not one**:

- `crates/factory-engine/templates/kernel/toolchain.yaml.tmpl` is the template.
  It is **already declared** in spec 219 `refines` (`retire-cargo-install-path`).
- `crates/factory-engine/src/kernel_emission/templates.rs` holds
  `render_tenant_toolchain`, whose tests (`toolchain_renders_for_pinned_mode`,
  `toolchain_renders_for_vendor_mode`, lines ~167-191) assert the rendered text:
  `--tag v1.4.2`, `invoke: "tools/spec-spine/verify-certificate"`,
  `invoke: "vendor/spine/build-certificate"`. A faithful rewrite breaks those
  assertions, so the test module must change. It is **not currently declared** by
  spec 219.

`templates.rs` carries `// Spec: specs/167-born-with-spec-spine-kernel/spec.md`
(spec 167 establishes it). The coupling gate (spec 127/133) requires an
authoritative spec's spec.md to change alongside the path. Editing only spec 167
would be wrong (the change is FR-006's, not 167's). The honest fix is a
**pre-implementation amendment to spec 219**: add a `refines` edge on
`templates.rs` capturing that FR-006's template rewrite drives the render-test
update. This refines the edge list to match the true footprint of the spec's own
stated requirement; it does not backfill spec to justify unrelated code (the
"amend first, then implement" discipline).

`crates/factory-engine/src/kernel_emission/version.rs` does **not** change: the
recorded verb name `verify-certificate` is preserved under the npm pin (the verb
is invoked as `tenant-tail verify-certificate`), and adding a `tenant_tail_version`
field is scope creep the spec disclaims ("the template pin + CI step is the
cross-repo closing leg; no in-OAP authority target").

## Decision 2: emit defers to spec 220, verify migrates to npm

The template currently installs **both** binaries via one cargo-install line:
`build-certificate` (the emitter) and `verify-certificate` (the verifier).

- **Verifier moves to the tenant-tail npm pin.** Invocation becomes
  `npx --no-install tenant-tail verify-certificate <cert> [--artifact-dir <run-dir>]`.
  This realizes FR-006 / AC-8.
- **Emitter defers to spec 220 (R-2), not prescribed here.** spec 220
  (`tenant-emit-governance-certificate`) owns the emitter, its firing, and the
  signer; its packaging is its own open question (220 OQ-1: dedicated emit repo
  vs kernel-shipped binary vs npm tool). spec 219 is verify-only by construction
  (FR-002), so the template's emitter section becomes a forward-reference to spec
  220 rather than a cargo-install or a fabricated npm path. The Rust toolchain the
  cargo-install presumed is gone (FR-006 premise), so the emitter is not left on
  `cargo install`.

This keeps spec 219 inside its verify-only boundary and does not poach spec 220's
emit-distribution decision. The toolchain template stays internally consistent:
verify is reachable via the npm pin; emit is named as pending spec 220.

Rejected alternatives: keep the emitter on cargo-install, verifier on npm
(contradicts the no-Rust-toolchain premise; inconsistent), and delete the emitter
section entirely (pre-empts spec 220 and drops the spec 168 toolchain-reference
role).

## Decision 3: status flip

After this PR the OAP-side leg (FR-006 / AC-8) is done and the cross-repo legs
(FR-001 through FR-005, AC-1 through AC-7) are satisfied in the tenant-tail repo.
Target: `status: draft -> approved`, `implementation: pending -> complete`, gated
on a read-only re-verification of the tenant-tail repo (both verbs present, the
build links no factory-engine, `build-certificate` absent from the verb set / dep
graph per AC-6) so "complete" is satisfied, not softened. AC-5's completion
criterion (every 209 FR-001 gate with an implemented core has a vended source) is
reached once spec-spine + tenant-tail are both vended, which they now are.

## Work items (in order)

1. **Amend spec 219** (this file + spec.md): add the `refines` edge on
   `crates/factory-engine/src/kernel_emission/templates.rs`; flip status; add an
   "Amendments / grounding" note recording the cross-repo done state and the
   footprint correction.
2. **Rewrite `toolchain.yaml.tmpl`**: retire the cargo-install line; verifier via
   the `tenant-tail` npm pin; emitter deferred to spec 220. Keep the `@@…@@`
   placeholder guard satisfied (no leftover placeholders).
3. **Update `templates.rs` tests** to assert the npm-pin verifier invocation and
   the spec-220 emit deferral instead of the cargo-install / `@@binaries_dir@@`
   binary paths.
4. **Regenerate** the featuregraph golden (`crates/featuregraph/tests/golden/features_graph.json`,
   already declared `extends`) and the codebase index (`make pr-prep`).

## Verification commands

```bash
cargo test --manifest-path crates/factory-engine/Cargo.toml kernel_emission
cargo test --manifest-path crates/featuregraph/Cargo.toml   # UPDATE_GOLDEN=1 to regen
make pr-prep   # codebase index + coupling gate vs origin/main
```

## Cross-repo legs NOT in this PR (tracked, not delivered here)

- The tenant-tail repo itself (its crate/CLI/npm/release/corpus), governed by
  tenant-tail's own `specs/`, already shipped.
- The produced-app `package.json` `tenant-tail` devDependency pin plus the CI
  verify-certificate step, which live in template-encore (cross-repo), spec 209's
  closing leg; FR-006 names them as the cross-repo leg with no in-OAP target.
- `verify-sbom`, staged until spec 203 is implemented.
- The emit leg (emitter + firing + signer), spec 220 (R-2).
