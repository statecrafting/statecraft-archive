# Introduction

Open Agentic Platform (OAP) is a governed operating system for AI-native software delivery. It provides a control plane where human developers and autonomous agents collaborate safely, bound by verifiable specifications.

OAP is built on a central thesis: **make the spec the law, bind every action to the spec that authorized it, and keep a record an auditor can verify independently**. 

The platform is explicitly **pre-alpha, stealth, single-developer**, and carries no public releases yet.

## The Three-Layer Model

OAP is constructed from three concrete layers that enforce governance across the software lifecycle:

1. **The Spec Spine**: The authoritative foundation. Every feature begins as a Markdown specification that compiles deterministically into a sharded JSON registry. The spine enforces "spec-first" development: code justifies the spec, never the reverse.
2. **The Platform (Control Plane)**: A Kubernetes-hosted service plane providing OIDC identity (Rauthy), scope-gated deployment orchestration (`deployd-api-rs`), and a SaaS backend (statecraft) for governance UX, audit logging, and webhooks.
3. **The OPC Desktop**: The Off-Platform Compute (OPC) cockpit. A local Tauri v2 plus React application where humans and agents share a governed execution surface. It hosts the `axiomregent` MCP server, which applies safety tiers and distributed locks to agent actions.

## The Governing Thesis

In traditional development, specifications and code drift apart. In AI-native delivery, that drift is catastrophic because agents operate at high velocity across large surfaces. OAP solves this through strict invariants:

- **Two truths, two formats**: Human-authored durable truth is Markdown only. Machine truth is JSON produced exclusively by the spec compiler.
- **The Coupling Gate**: Drift between a spec and the code it claims fails CI before merge. The codebase is collapse-proof under agentic editing because every change must be justified by an updated spec.
- **Auditor-Verifiable Records**: Every factory run emits a self-authenticating `governance-certificate.json` binding the requirements hash, frozen Build Spec hash, and per-stage artifact hashes. The verifier explicitly does not trust the producer.

## Pre-Alpha Status

OAP is under active development. While core components like spec compilation, the coupling gate, and the codebase index work today, other areas like tenant environment access gates remain on the roadmap. The documentation distinguishes clearly between shipped features and planned capabilities.
