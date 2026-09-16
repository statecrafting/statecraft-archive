# OWASP Agentic Top 10 (2026)

The Open Agentic Platform is designed from the ground up to address the unique security challenges of AI-native software delivery. OAP maps its architecture directly against the OWASP Agentic Top 10 (2026) framework.

## A Spec-and-Registry Attestation

It is crucial to understand that OWASP ASI 2026 compliance in OAP is a **spec-and-registry attestation**, not merely a set of runtime features. 

The ten controls map to declaring specs via the `oap-registry-enrich compliance-report` tool. The Governance Certificate provides the per-run attestation that these controls were enforced. The runtime mechanisms (like tiered tools, locks, and policy-kernel scopes) are the implementation details that satisfy the attestation.

## The Ten Controls

The following table summarizes the OWASP Agentic Top 10 and how OAP mitigates each risk:

| ID | Name | OAP Mitigation Strategy |
|---|---|---|
| **ASI01** | Agent Goal Hijack | Inputs are strictly typed and validated before reaching the planner. Natural-language inputs are treated as untrusted data, not instructions. |
| **ASI02** | Tool Misuse & Exploitation | The `axiomregent` MCP server enforces Safety Tiers (Tier 1/2/3). The Policy Kernel evaluates tool usage against scope-gated permissions. |
| **ASI03** | Identity & Privilege Abuse | Identity is federated through Rauthy OIDC. Permissions are project-scoped and evaluated dynamically by the Policy Kernel. |
| **ASI04** | Agentic Supply Chain Vulnerabilities | Supply chain gates (`cargo-deny`, `pnpm audit`) block vulnerable dependencies. Factory templates are content-addressed in the substrate. |
| **ASI05** | Unexpected Code Execution (RCE) | Execution isolation separates code generation from execution. The orchestrator uses verify-and-retry loops in sandboxed environments. |
| **ASI06** | Memory & Context Poisoning | Project knowledge is extracted and classified immutably. Agents rely on the frozen Build Spec rather than persistent, mutable memory. |
| **ASI07** | Insecure Inter-Agent Communication | Agents communicate via file-based artifact passing managed by the Orchestrator, rather than raw, spoofable message streams. |
| **ASI08** | Cascading Failures | Zero-trust, fail-closed composition. The orchestrator halts on failure and requires human-in-the-loop checkpoints for recovery. |
| **ASI09** | Human-Agent Trust Exploitation | High-impact actions require explicit confirmation (GateDialog) with plain-language risk summaries, not model-generated rationales. |
| **ASI10** | Rogue Agents | Continuous observability via the `statecraft` audit log. The Coupling Gate ensures behavior cannot diverge from the specification. |

For a complete mapping of which OAP specs satisfy which controls, run the compliance report CLI tool in the repository.
