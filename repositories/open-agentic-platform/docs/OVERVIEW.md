# Open Agentic Platform: Overview

A plain-language, citation-backed description of what OAP is and how its
pieces fit together. Every structural claim links to the spec that governs
it. Where a capability is partly built, this document says so explicitly
rather than describing the intended end state as if it shipped.

> **Reading order.** This is the orientation document. For repository
> conventions read [`CLAUDE.md`](../CLAUDE.md); for the compiler and
> registry contract read [`ARCHITECTURE.md`](ARCHITECTURE.md); for setup
> and platform-service development read [`DEVELOPERS.md`](DEVELOPERS.md).

## What OAP is

OAP is a governed control plane for AI-native software delivery. It is
built from three planes plus a portable spec engine:

1. a **service plane** (the platform) that owns identity, projects,
   knowledge, audit, and deployment;
2. an **off-platform compute plane** (OPC), a local desktop cockpit where
   agents do the work under governance;
3. a **shared spec spine** that keeps both planes honest by binding every
   change to a frozen, hash-verifiable spec.

The unifying idea: make the spec the law, bind every action to the spec
that authorized it, and keep a record an auditor can verify independently.

## Service plane (the platform)

A Terraformed Kubernetes service plane runs two services:

- **statecraft** (Encore.ts): auth, projects, knowledge, audit, and
  Slack / GitHub webhook handling.
- **deployd-api-rs** (Rust + hiqlite): scope-gated deployment
  orchestration.

It is tied to a GitHub org through **two distinct GitHub registrations**,
which are easy to conflate but serve different roles:

- a **GitHub App** (org-level, server-to-server) for webhooks, PR
  previews, and membership reads
  ([spec 073](../specs/073-axiomregent-unification/spec.md);
  [spec 106](../specs/106-rauthy-native-oidc-and-membership/spec.md),
  Principle 5);
- a **GitHub OAuth App** registered against Rauthy's callback as an
  upstream OIDC provider
  ([spec 106](../specs/106-rauthy-native-oidc-and-membership/spec.md),
  §12.1).

Identity uses **Rauthy** as the sole OIDC session signer, with **GitHub as
an upstream IdP for Rauthy** rather than an OAuth client of statecraft.
A developer's GitHub login is therefore federated *through* Rauthy
([spec 106](../specs/106-rauthy-native-oidc-and-membership/spec.md)).
Upstream-provider configuration is applied at runtime via Rauthy's admin
API, not through the Helm chart
([`platform/charts/rauthy/values.yaml`](../platform/charts/rauthy/values.yaml)).

## Project model

Once authenticated, a developer **creates or imports a project**. A
project accrues:

- **Knowledge sources and requirements**, processed through an extraction
  state machine (imported, extracting, extracted, classified, available)
  ([spec 115](../specs/115-knowledge-extraction-pipeline/spec.md)).
- A server-side **audit log and event history** (`audit_log` plus
  `factory_audit_log` in statecraft).
- Project-scoped governance, including per-user OPC tool grants
  ([spec 119](../specs/119-project-as-unit-of-governance/spec.md)).

The build machinery has two conceptual layers:

- a **factory**: the built-in two-phase process engine that turns business
  documents and requirements into a frozen Build Spec and then executes it
  ([spec 112](../specs/112-factory-project-lifecycle/spec.md));
- a **template / adapter**: the scaffold source a selected GitHub repo is
  cloned and shaped with. A project selects an adapter (today
  `acme-vue-encore`) that points at one template, and project creation
  gates on an admitted adapter being present
  ([spec 138](../specs/138-statecraft-create-realised-scaffold/spec.md),
  [spec 139](../specs/139-factory-artifact-substrate/spec.md),
  [spec 199](../specs/199-factory-thin-consumer-sync/spec.md)).

**Accuracy note.** The factory / template split is real at the
architecture level, but today the platform ships **one built-in factory
engine plus one admitted adapter / template per org**. There is not yet a
user-facing "define your own factory" step; you choose an adapter, and the
factory is the platform's orchestration engine.

## Off-platform compute plane (OPC)

**OPC** is the local **Tauri v2 + React desktop cockpit**
([`product/apps/opc/`](../product/apps/opc/)). It is where humans and
agents share a single execution surface: local workspaces, git context,
inspection, governance, snapshots, and Factory pipeline visualization.

OPC hosts a governed **MCP server, axiomregent**, which sits at the centre
of every agent session. axiomregent dispatches tools under **safety
tiers** (Tier 1 / 2 / 3) and acquires distributed worktree locks on
mutating tools
([spec 073](../specs/073-axiomregent-unification/spec.md);
[spec 036](../specs/036-safety-tier-governance/spec.md)). A **duplex bus**
links OPC to the platform with frame-integrity guarantees
([spec 206](../specs/206-duplex-frame-integrity/spec.md)).

When requirements are ready they flow down to OPC, where the factory
engine executes against the chosen adapter / template to build the app.
Agent actions run through **scoped, tiered tools** registered in the tool
registry ([spec 067](../specs/067-tool-definition-registry/spec.md)) and
enforced by the **policy-kernel**, and every action remains traceable to
the spec that authorized it.

**Accuracy note.** axiomregent is the governed MCP server (tool dispatch,
safety tiers, distributed locks). It is *not* itself "the OWASP compliance
layer," and there is no mechanism that derives a fresh per-task security
scope from a requirement's profile: a tool's scope is fixed at
registration time. Runtime governance is tiered tools plus policy-kernel
scopes; compliance attestation is a separate, spec-level concern (below).

## Governance and compliance posture

**OWASP ASI 2026 alignment is a spec-and-registry attestation, not a
runtime axiomregent feature.** The ten ASI controls are formalized in
[spec 102](../specs/102-governed-excellence/spec.md) and emitted as a
deterministic control-to-spec mapping via
`oap-registry-enrich compliance-report --framework owasp-asi-2026`.

There are two halves to the governance story, and it helps to keep them
separate:

- the **runtime** half: tiered tools, distributed locks, and policy-kernel
  scopes that constrain what an agent can do as it does it;
- the **attestation** half: the compliance report plus the per-run,
  self-authenticating `governance-certificate.json` that binds
  requirements hash, frozen Build Spec hash, and per-stage artifact hashes
  into one auditable artifact
  ([spec 102](../specs/102-governed-excellence/spec.md)). The companion
  verifier does not trust the system that produced the certificate, and
  rejects a tampered artifact with a specific hash-mismatch diagnostic.

## Deploy and stakeholder access

The finished app can be deployed internally through the build, image,
chart, and trigger chain
([spec 213](../specs/213-tenant-repo-image-build/spec.md),
[spec 214](../specs/214-tenant-app-chart-supersession/spec.md),
[spec 215](../specs/215-statecraft-deploy-trigger-ux/spec.md)).

Stakeholder access to a deployed app is **gated**:
[spec 137](../specs/137-tenant-environment-access-gates/spec.md) provides
passwordless OIDC (magic link plus a federated upstream IdP, including the
planned Google provider) over an admin-managed email allowlist.

**Accuracy note.** This is partly roadmap. Phases 4 and 5 of spec 137
landed (2026-05-17); Phase 6 (evidence plus lifecycle flip) is pending,
and self-service stakeholder *invitation* flows are explicitly out of
scope of that spec. The current access path is an admin-managed allowlist,
not an invite flow, and Google federation is registered manually as a
precursor rather than wired into a stakeholder onboarding UX.

## Scale and portability

The codebase is roughly **358k lines** of tracked Rust and
TypeScript / TSX (excluding generated output under `.derived/` and build
artifacts). It is kept **collapse-proof under agentic editing by the spec
spine**: drift between a spec and the code it claims fails CI before merge
([spec 127](../specs/127-spec-code-coupling-gate/spec.md)).

**spec-spine is its own published library**, not a vendored in-tree
engine. It ships as `spec-spine-cli` on crates.io (pinned to 0.10.0) from
its own repository. Because each produced project is its own GitHub
repository that uses a public spec engine, a project can **graduate off
OAP with no lock-in**. This is the same rationale as the AGPL-3.0 license:
the audit chain is meant to be a public good, not a captured feature.

## Capability status at a glance

| Area | Status | Source |
|---|---|---|
| Rauthy OIDC, GitHub federated through Rauthy | Wired | [spec 106](../specs/106-rauthy-native-oidc-and-membership/spec.md) |
| GitHub App + GitHub OAuth App (two registrations) | Wired | [spec 073](../specs/073-axiomregent-unification/spec.md), [spec 106](../specs/106-rauthy-native-oidc-and-membership/spec.md) |
| Knowledge extraction, audit log, project governance | Wired | [spec 115](../specs/115-knowledge-extraction-pipeline/spec.md), [spec 119](../specs/119-project-as-unit-of-governance/spec.md) |
| Factory engine + one admitted adapter/template per org | Wired (single-adapter) | [spec 112](../specs/112-factory-project-lifecycle/spec.md), [spec 138](../specs/138-statecraft-create-realised-scaffold/spec.md) |
| axiomregent MCP server, safety tiers, duplex bus | Wired | [spec 073](../specs/073-axiomregent-unification/spec.md), [spec 036](../specs/036-safety-tier-governance/spec.md), [spec 206](../specs/206-duplex-frame-integrity/spec.md) |
| OWASP ASI 2026 control-to-spec mapping | Wired (attestation) | [spec 102](../specs/102-governed-excellence/spec.md) |
| Governance certificate emission + independent verify | Wired | [spec 102](../specs/102-governed-excellence/spec.md) |
| Internal deploy chain (image, chart, trigger) | Wired | [spec 213](../specs/213-tenant-repo-image-build/spec.md), [spec 214](../specs/214-tenant-app-chart-supersession/spec.md), [spec 215](../specs/215-statecraft-deploy-trigger-ux/spec.md) |
| Gated stakeholder access to deployed app | Partial / roadmap | [spec 137](../specs/137-tenant-environment-access-gates/spec.md) (Phase 6 pending) |
| User-facing "define your own factory" | Not built | architecture only |
| Per-task security scope from requirement profile | Not built | scope fixed at tool registration |

Status reflects the spec corpus as of the latest registry compile. When a
spec advances, update the row and its citation rather than letting this
table drift from the spine it describes.
