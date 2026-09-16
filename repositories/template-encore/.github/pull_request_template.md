<!-- Spec: 009-repo-ci-orchestrator -->

## Summary

<!-- 1-3 bullet points describing what this PR does and why -->

## Spec alignment

<!-- Which spec(s) does this PR implement or relate to? -->
- Spec: `specs/NNN-slug/spec.md` or "none (infra/chore/docs)"

## Change classification

Select one:

- [ ] Feature — new capability backed by a spec
- [ ] Enhancement — improvement to existing feature
- [ ] Bug fix — corrects incorrect behavior
- [ ] Refactor — internal restructure, no behavior change
- [ ] Docs — documentation only
- [ ] Chore — build, deps, tooling, CI

## Checklist

- [ ] Changes align with the referenced spec (or no spec applies)
- [ ] `npx spec-spine compile` output unchanged (or spec frontmatter was intentionally modified)
- [ ] `make pr-prep` exits clean locally (index fresh, coupling gate green)
- [ ] No secrets, credentials, or API keys committed
- [ ] Tests pass locally

<!-- If the coupling gate must be waived, add a visible line here:
Spec-Drift-Waiver: <reason>
-->
