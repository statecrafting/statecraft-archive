# Deployd API

The `deployd-api-rs` service is the deployment orchestrator for the Open Agentic Platform. It bridges the gap between the generated artifacts and the Kubernetes infrastructure.

## Architecture

Originally a Node.js POC, `deployd-api` was rewritten in Rust (Spec 073) to leverage the platform's shared types and the `hiqlite` embedded Raft SQLite database for highly available, persistent state.

It exposes a REST API using the `axum` web framework.

## Scope-Gated Orchestration

The primary security mechanism of `deployd-api` is scope-gated orchestration. 

When a deployment request is received, the API inspects the Rauthy-issued JWT. It enforces the presence of the `DEPLOYD_REQUIRED_SCOPE` before taking any action. This ensures that only authorized CI/CD pipelines or users with explicit deployment grants can trigger changes to the cluster.

## Chart Selector Wire Contract

`deployd-api` does not hardcode deployment logic. Instead, it relies on a Chart Selector wire contract. 

When a deployment is triggered, the API selects the appropriate Helm chart based on the project's environment configuration and adapter type. It then orchestrates the Helm deployment, monitoring the rollout status and reporting back to the `statecraft` service.

## Running Locally

To run `deployd-api` locally:

```bash
cargo build --release --manifest-path platform/services/deployd-api-rs/Cargo.toml
./platform/services/deployd-api-rs/target/release/deployd-api-rs
```

The service listens on `http://localhost:8080`.
