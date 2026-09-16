# Registry Consumer Contract Governance

Status: **Contract stabilization complete; controlled extension mode active**.

This document defines how changes to the `spec-spine registry` subcommand surface are classified and reviewed. (spec 217: the in-tree `tools/spec-spine/registry-consumer/` binary was replaced by the published `spec-spine` CLI; the contract governance process defined here applies to the `spec-spine registry` subcommands.)

## Stabilization boundary

The registry consumer interface is now a governed contract-bearing surface. The following surfaces are normative:

- JSON/content contracts (`010`, `018`, `021`)
- README examples contracts (`019`)
- Runtime failure contracts (`020`)
- Help/usage and version contracts (`022`, `024`)
- Argument-validation contracts (`023`)
- Default-path and policy-override contracts (`025`, `026`)
- Sorting-order contracts (`027`)
- stdout/stderr channel contracts (`028`)

Normative behavior is defined by fixture-backed tests in the `spec-spine` library crate and contract tests against the `spec-spine registry` subcommands.

## Change classification rubric (required)

Every change touching the `spec-spine registry` subcommand surface MUST declare one class:

1. **contract extension**
   - Adds new externally visible behavior and new contract fixtures/tests.
2. **internal refactor, no observable change**
   - Improves internals only; existing contract fixtures/tests remain unchanged.
3. **breaking change candidate**
   - Alters settled observable behavior; requires explicit versioning and migration language.

## Extension acceptance rubric (required for contract extensions)

A proposed `spec-spine registry` extension is acceptable only if it satisfies all of the following:

1. **Clear interface value**
   - Adds a new user-reliable guarantee with obvious operator or automation value.
   - Is not merely a convenience variation of an existing mode.
2. **Minimal surface area**
   - Introduces the smallest new surface needed for the guarantee.
   - Prefer one flag, one mode, or one narrowly scoped behavior over broad option families.
3. **No semantic overlap**
   - Must not blur or overload existing semantics.
   - If behavior can be confused with an existing output mode or contract, reject or explicitly redesign.
4. **Explicit interaction rules**
   - All interactions with existing flags and modes are defined up front.
   - Conflicts, precedence, and mutual exclusivity are intentional and documented.
5. **Fixture-first contract definition**
   - Observable behavior is captured in fixtures and contract tests as normative behavior before the change is complete.
   - Help output changes are treated as contract changes when user-visible.
6. **Preservation of settled guarantees**
   - Does not alter existing guarantees for output shape, ordering, exit behavior, stdout/stderr discipline, or invalid-input handling unless explicitly classified as a breaking change candidate.
7. **Spec and README linkage**
   - Reflect the new guarantee in the feature spec spine and user-facing documentation so behavior, governance, and discoverability stay aligned.
8. **Versioning trigger**
   - If the proposal cannot satisfy the above without redefining an existing contract, it is not an extension; it is a breaking change candidate and must enter explicit versioning discussion.

**Reviewer check:** Does this change add exactly one clear guarantee, with minimal surface, explicit mode interaction, fixture-backed behavior, and zero drift to settled contracts?

## Release gate checklist (required)

For every PR touching the `spec-spine registry` subcommand surface, answer:

- Does this change observable output?
- Does this change ordering?
- Does this change stdout/stderr routing?
- Does this change exit behavior?
- Does this require a new or updated fixture?
- Does this require explicit versioning language?

If any observable behavior changes, fixture updates and contract rationale are mandatory.

## Contract baseline corpus

The fixture set that governed the in-tree `registry-consumer` (under `tools/spec-spine/registry-consumer/tests/fixtures/`) was the baseline contract corpus before spec 217. Going forward the baseline is defined by the `spec-spine` library's own fixture-backed tests for the `registry` subcommands.

Future work is judged against this baseline. Do not update fixtures to match implementation drift without explicit contract justification.

## CI expectation

Main validation path must run both full `spec-spine registry` tests and explicit fixture-bearing contract subsets.
