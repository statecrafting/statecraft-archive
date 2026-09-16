# Frequently Asked Questions

This section covers common questions regarding the architecture and operation of the Open Agentic Platform.

## Why is the Spec Compiler not vendored in the repository?

The generic spec engine (`spec-spine`) was removed from the OAP repository in Spec 217. It is now a published, Apache-2.0 licensed project maintained externally. OAP pins a specific version and uses overlay tools (`tools/oap/`) to add platform-specific logic. This separation keeps the core compilation logic portable while allowing OAP to focus on its specific governance rules.

## Why are `.derived/` JSON files not meant to be edited?

Human-authored truth is Markdown only (Constitution Principle I). The JSON files in `.derived/` are machine truth generated deterministically by the compiler (Principle II). Hand-editing these files breaks the chain of custody and causes the staleness gate to fail in CI.

## What is the difference between the GitHub App and the GitHub OAuth App?

OAP uses two distinct GitHub registrations for different purposes (Spec 106):
1. **GitHub App**: An organization-level, server-to-server integration used by the `statecraft` service for handling webhooks, PR previews, and reading membership data.
2. **GitHub OAuth App**: Registered against Rauthy's callback URL, this acts as an upstream Identity Provider (IdP). A developer's GitHub login is federated through Rauthy to issue OIDC tokens.

## How do I resolve a Spec/Code Coupling Gate failure?

If the Coupling Gate fails, it means you modified a code path without updating the spec that claims authority over it. You must either:
1. Update the authoritative `spec.md` file in the same pull request.
2. If the change is purely mechanical (e.g., a dependency bump), provide a waiver token in the commit message or PR description with a written justification.

## Why does `deployd-api` use `hiqlite` instead of PostgreSQL?

`deployd-api` was rewritten in Rust (Spec 073) and uses `hiqlite` (an embedded Raft SQLite database) to provide highly available, persistent deployment state without the operational overhead of managing an external database connection. This aligns with the platform's goal of resilient, self-contained orchestration.
