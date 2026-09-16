# Configuration

Configuration in **acme-vue-encore** is split between environment variables (for non-sensitive settings) and Encore secrets (for sensitive credentials).

## Environment Variables

These are typically set in `apps/api/.env` for local development or injected by the deployment environment.

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode (`development` or `production`). | `development` |
| `AUTH_DRIVER` | The SSO driver to use (`mock` or `rauthy`). | `mock` |
| `LOG_PII` | Whether to log PII. Must be `false` in production. | `false` |
| `PRIVATE_API_BASE_URL` | Upstream URL for the BFF gateway proxy. | - |
| `GATEWAY_OAUTH_TOKEN_URL` | Token endpoint for the S2S gateway token. | - |
| `REDIS_URL` | Redis connection string for rate limiting. | - |
| `RAUTHY_ISSUER` | OIDC Issuer URL (if `AUTH_DRIVER=rauthy`). | - |
| `RAUTHY_REDIRECT_URI` | OIDC Callback URL. | - |
| `RAUTHY_SCOPES` | OIDC scopes to request. | `openid profile email groups` |
| `RAUTHY_DEFAULT_ROLE` | Fallback role if none provided by IdP. | `user` |

## Encore Secrets

Secrets are managed via the Encore CLI and are never committed to the repository.

```bash
# Set a secret for local development
encore secret set --type local SECRET_NAME

# Set a secret for production
encore secret set --type prod SECRET_NAME
```

| Secret | Description |
|--------|-------------|
| `CSRF_SECRET` | Used to sign CSRF tokens. |
| `JWT_PRIVATE_KEY` | RS256 private key for signing access tokens. |
| `JWT_PUBLIC_KEY` | RS256 public key for verifying access tokens. |
| `JWT_REFRESH_PRIVATE_KEY` | RS256 private key for signing refresh tokens. |
| `JWT_REFRESH_PUBLIC_KEY` | RS256 public key for verifying refresh tokens. |
| `GATEWAY_OAUTH_CLIENT_ID` | Client ID for the S2S gateway token. |
| `GATEWAY_OAUTH_CLIENT_SECRET` | Client Secret for the S2S gateway token. |
| `RAUTHY_CLIENT_ID` | OIDC Client ID (if `AUTH_DRIVER=rauthy`). |
| `RAUTHY_CLIENT_SECRET` | OIDC Client Secret. |
