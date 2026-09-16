# Authentication Setup

**acme-vue-encore** supports multiple Single Sign-On (SSO) drivers, configured via environment variables and Encore secrets.

## The Mock Driver (Development)

The `mock` driver is enabled by default in local development (`AUTH_DRIVER=mock` in `apps/api/.env`). It provides instant login as predefined personas without requiring an external Identity Provider.

When visiting the login page locally, you can select:
- Developer (`?user=0`)
- Administrator (`?user=1`)
- Standard User (`?user=2`)

## The Rauthy Driver (Production OIDC)

For production, the application integrates with a self-hosted [rauthy](https://github.com/sebadob/rauthy) OpenID Connect provider.

### 1. Register the Application in Rauthy

Create a new client in your rauthy instance and add the callback URL as a Redirect URI.
- Development: `http://localhost:4000/api/v1/auth/rauthy/callback`
- Production: `https://your-app.example.com/api/v1/auth/rauthy/callback`

### 2. Configure Environment Variables

Set the non-secret configuration in your environment (or `apps/api/.env` for local testing):

```bash
AUTH_DRIVER=rauthy
RAUTHY_ISSUER={{YOUR_OIDC_ISSUER_URL}}
RAUTHY_REDIRECT_URI=https://your-app.example.com/api/v1/auth/rauthy/callback
RAUTHY_SCOPES="openid profile email groups"
RAUTHY_DEFAULT_ROLE=user
```

The provider metadata (authorization, token, and JWKS endpoints) is discovered automatically from the `RAUTHY_ISSUER` via `.well-known/openid-configuration`.

### 3. Set Secrets

The client ID and secret must be set as Encore secrets, as they should never be committed to version control.

```bash
# Local development
encore secret set --type local RAUTHY_CLIENT_ID
encore secret set --type local RAUTHY_CLIENT_SECRET

# Production
encore secret set --type prod RAUTHY_CLIENT_ID
encore secret set --type prod RAUTHY_CLIENT_SECRET
```

## Role Resolution

The application resolves user roles from the claims provided by the OIDC token. It checks `roles`, then `role`, then `groups` by priority. If no role claim is present, it falls back to the value specified by `RAUTHY_DEFAULT_ROLE`.
