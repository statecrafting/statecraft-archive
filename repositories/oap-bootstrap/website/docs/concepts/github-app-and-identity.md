# GitHub App and Identity

`oap-bootstrap` automates the complex identity and access management setup required for a new OAP instance, eliminating the need for manual configuration through web consoles.

## A Single GitHub App

A key architectural decision in `oap-bootstrap` is the use of a single GitHub App to handle both webhook automation and OAuth login. 

During the `github` phase, the CLI uses the App Manifest flow to register a new GitHub App. This manifest requests the necessary webhook permissions and events to satisfy the upstream webhook handler contract. Crucially, it also requests `email_addresses: read` permissions and registers an OAuth callback URL pointing to the Rauthy authentication service. 

By combining these capabilities, the same App serves as Rauthy's upstream login provider. This eliminates the need to create and manage a separate OAuth App, streamlining the deployment process. The CLI captures the generated App ID, private key, webhook secret, and OAuth client credentials, persisting them immediately to `oap.env`.

## Rauthy OIDC Clients

The `identity` phase interacts directly with the live Rauthy admin API to provision the necessary OpenID Connect (OIDC) clients. The CLI creates four distinct clients, each tailored for a specific role:

1. **SPA Client**: A public client utilizing Proof Key for Code Exchange (PKCE) for the frontend application.
2. **Server Client**: A confidential client supporting authorization code and refresh token flows.
3. **Deployd M2M Client**: A confidential client using the `client_credentials` flow, assigned the custom `deployd:deploy` scope.
4. **Knowledge Sweeper M2M Client**: A confidential client using the `client_credentials` flow, assigned the custom `platform:knowledge:sweep` scope.

Because Rauthy only returns the secret for a confidential client once upon creation, the CLI immediately persists these credentials to `oap.env`. If a phase fails after client creation but before persistence, the client must be manually deleted in Rauthy before re-running the phase.

## The Rauthy 0.35 Degradation

In Rauthy version 0.35, the API endpoints for registering upstream authentication providers are session-gated and cannot be called using an API key. 

`oap-bootstrap` handles this gracefully. When it detects that the provider creation API is unavailable, it degrades to a guided manual process. The CLI pauses and prints explicit, step-by-step instructions, including the exact URLs and field values needed to register the GitHub provider through the Rauthy web interface. 

This degradation is an intentional, human-in-the-loop step designed to navigate the API limitation without silently skipping critical configuration. The CLI is designed to automatically probe the API and bypass this manual step when running against Rauthy 0.36 or later.
