# Tasks: featuregraph registry scanner fix

**Input**: `/specs/034-featuregraph-registry-scanner-fix/`  
**Prerequisites**: Features **000–004**, **032**, **033**

## Phase 1: Registry adapter

- [x] T001 Define how `registry.json` `features[]` maps into scanner’s feature graph inputs (types + unit tests)
- [x] T002 Implement registry-first resolution in `scanner.rs` with explicit fallback / error when neither registry nor yaml exists

## Phase 2: Integration

- [x] T003 Ensure `featuregraph_overview` / governance path uses the new resolution on desktop (no silent yaml-only assumption)
- [x] T004 `cargo test -p featuregraph` and desktop `pnpm run check` green

## Phase 3: Closure

- [x] T005 Update `execution/changeset.md` and `execution/verification.md`
- [x] T006 Set spec `status: active` when verification proves delivery
