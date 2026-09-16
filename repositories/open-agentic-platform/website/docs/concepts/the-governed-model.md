# The Governed Model

The Open Agentic Platform (OAP) is built on a radical premise for AI-native software delivery: **make the spec the law, bind every action to the spec that authorized it, and keep a record an auditor can verify independently**.

This model addresses the core risk of autonomous agents: high-velocity drift between what a system is supposed to do and what the code actually does.

## Spec-as-Law

In OAP, specifications are not documentation written after the fact; they are the authoritative design record. Features must be specified before implementation. The code justifies the spec, never the reverse.

This principle is enshrined in the project's Constitution (Principle III): "Features are specified before implementation; implementation is justified by specs under `specs/`."

## Bind Action to Spec

Every code path in the repository is claimed by a spec. This relationship is strictly enforced by the **Coupling Gate** (Spec 127). If an agent or human developer modifies code without also updating the spec that governs that code, the CI pipeline will fail before the pull request can be merged.

This ensures that the codebase remains collapse-proof under agentic editing. An agent cannot silently drift the implementation away from the agreed-upon design.

## Auditor-Verifiable Record

Governance is only meaningful if it can be proven. OAP produces a **Governance Certificate** (Spec 102) at the end of every factory run.

This certificate is a self-authenticating JSON artifact that binds together:
- The hash of the initial business requirements.
- The hash of the frozen Build Spec.
- The hashes of every artifact produced at each stage of the pipeline.

Crucially, the verifier for this certificate (`make verify-certificate`) does not trust the system that produced it. An independent auditor can take the certificate and the output directory, run the verifier, and cryptographically prove that the artifacts match the approved process and have not been tampered with.

## The Trust Fabric Path

The governed model creates an unbroken chain of trust:
1. A user authenticates via OIDC (Rauthy) and receives scope-gated permissions.
2. The user initiates a session in the OPC desktop, where the `axiomregent` MCP server enforces safety tiers and policy rules.
3. The Factory engine translates requirements into a frozen Build Spec through agent-driven stages.
4. The scaffolding phase generates code bound to the Spec Spine.
5. The final output is sealed with a Governance Certificate.
6. The resulting artifacts are deployed via the scope-gated `deployd-api`.

At every step, the action is bound to a spec, and the result is recorded for independent verification.
