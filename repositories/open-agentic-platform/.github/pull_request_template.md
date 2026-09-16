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
- [ ] Spec-compiler output unchanged (or spec frontmatter was intentionally modified)
- [ ] No secrets, credentials, or API keys committed
- [ ] Tests pass locally

---

<details>
<summary>Registry-consumer contract checklist (expand if touching <code>tools/spec-spine/registry-consumer/</code>)</summary>

### Contract assessment

- [ ] I assessed whether observable output changes
- [ ] I assessed whether ordering changes
- [ ] I assessed whether stdout/stderr routing changes
- [ ] I assessed whether exit behavior changes
- [ ] I added/updated fixture(s) when observable behavior changed
- [ ] I added explicit versioning language if this is a breaking change candidate

### Extension check

- [ ] This change adds one clear guarantee with operator or automation value
- [ ] The surface area is minimal and does not overlap existing semantics
- [ ] Flag/mode interactions are explicit and documented
- [ ] Observable behavior is fixture-backed, including help output when applicable
- [ ] Settled guarantees are unchanged, or this is explicitly classified as a breaking change candidate

**Fixtures touched:** `<paths or "none">`
**Spec/doc touchpoints:** `<paths or "none">`

</details>
