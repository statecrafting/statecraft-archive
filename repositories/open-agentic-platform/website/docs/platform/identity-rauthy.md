# Identity (Rauthy)

Authentication in the Open Agentic Platform is handled by **Rauthy**, a production-grade, Rust-based OpenID Connect (OIDC) provider.

## Why Rauthy?

Rauthy was chosen (Spec 106) because it provides a self-hosted, highly available identity solution without the need for an external database. It uses `hiqlite` (embedded Raft SQLite) for state replication.

By acting as the sole OIDC session signer, Rauthy centralizes authentication and scope issuance for all OAP services.

## GitHub Federation

A core requirement for OAP is integrating with a developer's existing GitHub identity. 

In OAP, GitHub is configured as an **upstream Identity Provider (IdP)** for Rauthy, rather than acting as a direct OAuth client for the `statecraft` service. A developer's GitHub login is federated *through* Rauthy.

This requires a specific GitHub registration: a **GitHub OAuth App** registered against Rauthy's callback URL. 

*(Note: This is distinct from the GitHub App used by `statecraft` for webhooks and server-to-server API access).*

## Scope Issuance

When a user authenticates, Rauthy issues a JWT containing specific scopes based on their group membership and project roles. 

These scopes are the foundation of the Trust Fabric. They are consumed by:
- `deployd-api` to authorize Kubernetes deployments.
- `statecraft` to authorize API access.
- `axiomregent` to validate the user's session before requesting project grants.
