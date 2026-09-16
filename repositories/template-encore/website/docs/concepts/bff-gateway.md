# BFF Gateway Proxy

A defining security characteristic of **acme-vue-encore** is that the public frontend never communicates directly with the private backend. This isolation is enforced by the Backend-for-Frontend (BFF) gateway proxy.

## The Proxy Contract

The `gateway` service exposes an `api.raw` catch-all route at `/api/v1/data/*`. This route acts as a reverse proxy, forwarding authenticated requests from the SPA to the private backend.

This implementation satisfies security invariant INV-10, ensuring that:
1. The browser never holds backend credentials.
2. The private backend is never directly reachable from the public internet.

## Service-to-Service Authentication

When proxying a request, the gateway strips the `/api/v1/data/` prefix and appends the remainder of the path to the `PRIVATE_API_BASE_URL`.

Crucially, the gateway injects a service-to-service (S2S) OAuth client-credentials Bearer token into the upstream request. The gateway maintains a token cache (`gateway/token-cache.ts`) that fetches and refreshes this token automatically, deduplicating concurrent requests to avoid overwhelming the OAuth provider.

## Security and Resilience Features

The gateway proxy implements several mechanisms to protect both the client and the private backend:

- **Authentication Gate**: The route requires `auth: true`, ensuring that unauthenticated requests are rejected by the Encore `authHandler` before they ever reach the proxy logic.
- **Path Traversal Sanitization**: The requested path is sanitized before forwarding to prevent directory traversal attacks against the private backend.
- **Error Masking**: To prevent leaking internal backend details, any 5xx error returned by the private backend is masked and returned to the client as a generic 502 Bad Gateway error. Stack traces in 4xx JSON responses are also stripped.
- **Timeout Mapping**: If the private backend fails to respond within `GATEWAY_TIMEOUT_MS` (default 30 seconds), the gateway aborts the request and returns a 504 Gateway Timeout error.
- **Audit Logging**: Every access through the gateway is logged to the `audit_log` table, recording the action, actor, and outcome.
