# Placeholder Pattern Reference

## Overview

This template uses a **consistent placeholder pattern** to indicate values that must be replaced with actual configuration. This helps avoid false positives from GitHub secret detection while making it clear what needs to be customized.

## Pattern

All placeholders follow this format:

```
{{VARIABLE_NAME}}
```

**Example**:
```bash
# Before (placeholder)
RAUTHY_ISSUER={{YOUR_OIDC_ISSUER_URL}}

# After (actual value)
RAUTHY_ISSUER=https://rauthy.example.com
```

## Common Placeholders

### Authentication - rauthy OIDC

| Placeholder | Description | Format |
|-------------|-------------|--------|
| `{{YOUR_OIDC_ISSUER_URL}}` | rauthy OIDC issuer base URL | `https://rauthy.example.com` |
| `{{YOUR_OIDC_CLIENT_ID}}` | OIDC client ID registered in rauthy | e.g. `my-app` |
| `{{YOUR_OIDC_CLIENT_SECRET}}` | OIDC client secret | opaque string from rauthy |
| `{{YOUR_OIDC_REDIRECT_URI}}` | OIDC callback URL | `https://app.example.com/api/v1/auth/rauthy/callback` |

> Scopes default to `openid profile email groups`; override with `RAUTHY_SCOPES` if needed.
> `RAUTHY_DEFAULT_ROLE` sets the fallback role when no role claim is present (default: `user`).

### API Gateway (S2S OAuth)

| Placeholder | Description | Where to Find |
|-------------|-------------|---------------|
| `{{S2S_CLIENT_ID}}` | S2S OAuth client ID | Your OIDC provider's client registration |
| `{{S2S_CLIENT_SECRET}}` | S2S OAuth client secret | Your OIDC provider's client credentials |
| `{{S2S_OAUTH_SCOPE}}` | OAuth scope for private API | e.g. `private-api/.default` |
| `{{PRIVATE_BACKEND_URL}}` | Private backend API URL | e.g. `http://private-api:3001/api/v1` |

### Session & Security

| Placeholder | Description | How to Generate |
|-------------|-------------|-----------------|
| `{{GENERATE_WITH_OPENSSL_RAND_BASE64_32}}` | Session secret (32+ characters) | `openssl rand -base64 32` |
| `{{REDIS_CONNECTION_STRING}}` | Redis connection URL | `redis://hostname:6379` |

## Files Using Placeholders

### Environment Configuration

- [apps/api/.env.example](apps/api/.env.example) - Backend env template (mock auth by default; rauthy OIDC vars included)

### Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment examples
- [docs/AUTH-SETUP.md](docs/AUTH-SETUP.md) - Authentication setup
- [docs/SECURITY.md](docs/SECURITY.md) - Security configuration
- [TEMPLATE-GUIDE.md](TEMPLATE-GUIDE.md) - Customization guide

## Usage Instructions

### 1. Identify Placeholders

Look for values wrapped in `{{...}}`:

```bash
# apps/api/.env.example
RAUTHY_ISSUER={{YOUR_OIDC_ISSUER_URL}}
RAUTHY_CLIENT_SECRET={{YOUR_OIDC_CLIENT_SECRET}}
REDIS_URL={{REDIS_CONNECTION_STRING}}
```

### 2. Replace with Actual Values

Remove the `{{` and `}}` brackets and insert your real values:

```bash
# apps/api/.env (your actual config)
RAUTHY_ISSUER=https://rauthy.example.com
RAUTHY_CLIENT_SECRET=s3cr3t-from-rauthy
REDIS_URL=redis://my-redis:6379
```

### 3. Verify No Placeholders Remain

Before deploying, ensure no `{{...}}` patterns remain:

```bash
# Search for unreplaced placeholders
grep -r "{{" apps/api/.env

# Should return nothing if all placeholders are replaced
```

## Why This Pattern?

### Problem

GitHub's secret detection can flag example values as potential secrets:

- `your-client-secret-here` - Flagged as potential secret
- `<CLIENT_SECRET>` - Flagged as potential secret
- `CHANGE_THIS` - Flagged as potential secret

### Solution

Using `{{VARIABLE_NAME}}` avoids false positives:

- `{{YOUR_OIDC_ISSUER_URL}}` - Recognized as placeholder
- Clear indication that value must be replaced
- Consistent pattern across all files
- Easy to search and validate

## Best Practices

### For Template Users

1. **Never commit actual secrets** - Only use placeholders in example files
2. **Use .gitignore** - Ensure `.env` is ignored (not `.env.example`)
3. **Search before deploy** - Run `grep "{{" .env` to find unreplaced placeholders
4. **Use secret managers** - Store production secrets in your cloud provider's secret manager, not files

### For Template Maintainers

1. **Always use `{{VARIABLE_NAME}}` format** - Never use `<VAR>`, `$VAR`, or descriptive text
2. **Document all placeholders** - Add to this file when introducing new ones
3. **Include examples** - Show format in comments above placeholder
4. **Test detection** - Verify GitHub doesn't flag placeholders as secrets

## Related Documentation

- [AUTH-SETUP.md](docs/AUTH-SETUP.md) - Detailed authentication configuration
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment-specific configuration
- [SECURITY.md](docs/SECURITY.md) - Security best practices
- [TEMPLATE-GUIDE.md](TEMPLATE-GUIDE.md) - Complete customization guide
