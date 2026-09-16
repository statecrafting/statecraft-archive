# Rules and the Governed Loop

The behavior of agents within OAP is constrained by a set of explicit rules loaded automatically during orchestrated workflows. These rules reside in `.claude/rules/`.

## Orchestrator Rules

The `orchestrator-rules.md` file defines the fundamental behavioral constraints for multi-step workflows. It enforces step ordering, file-based artifact passing, checkpoint discipline, halt-on-failure behavior, and ensures that agents never enter plan mode autonomously.

## Governed Artifact Reads (Spec 103)

The `governed-artifact-reads.md` rule strictly forbids agents from parsing compiled JSON artifacts directly. Any data from the `.derived/` directory must be read through the designated consumer binaries (`spec-spine registry`, `spec-spine index`, etc.). This prevents agents from writing fragile, ad-hoc parsing scripts that break when internal schemas evolve.

## Adversarial Prompt Refusal (CONST-005)

One of the most critical safety rules is `adversarial-prompt-refusal.md`, which implements the `CONST-005` policy: Spec-Code Coherence.

This rule instructs the agent to explicitly refuse any instruction that attempts to engineer drift between a specification and the code. If a user asks the agent to modify code without updating the corresponding spec, the agent must halt and surface the violation. This ensures that the agent acts as an active defender of the Coupling Gate invariant, rather than a passive executor of non-compliant instructions.
