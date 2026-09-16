# Routing and Protection

## Overview

React Router v7 route layout with loader-based session enforcement. Public, user, and admin areas are separated by layout routes.

## Route Layout

```
/                 - Landing (public)
/pricing          - Pricing (public)
/signin           - User sign in (public)
/signup           - User sign up (public)
/admin/signin     - Admin sign in (public)
/app              - User app layout (protected by requireUser)
  /app            - Dashboard (uptime monitoring)
  /app/settings   - Settings, sign out
/admin            - Admin layout (protected by requireAdmin)
  /admin          - Admin home
  /admin/users    - User management
  /admin/audit    - Audit log
```

## Protection

### requireUser

- **Location**: `web/app/lib/auth.server.ts`
- **Behavior**: Parses `__session` cookie, calls `api.auth.session({ token })`, returns claims or throws `redirect("/signin")`
- **Used in**: `app.tsx` layout loader

### requireAdmin

- **Location**: `web/app/lib/auth.server.ts`
- **Behavior**: Parses `__admin_session` cookie, calls `api.auth.adminSession({ token })`, checks `role === "admin"`, returns claims or throws `redirect("/admin/signin")`
- **Used in**: `admin.tsx` layout loader

## Cookie Forwarding

Server-side loaders and actions receive the request object. Cookies are read from `request.headers.get("Cookie")` and passed to the Encore client when calling session endpoints. For form actions that set cookies, the auth API returns `setCookie`; the action returns `redirect(url, { headers: { "Set-Cookie": res.setCookie } })`.

## Encore Request Forwarding

When Encore forwards requests to the React Router frontend service, headers may be modified or stripped. The following mitigations are in place:

### fixRequestHeaders (web/api.gateway.ts)

- Normalizes Origin and Host headers before passing to React Router
- Builds a clean headers array; filters malformed headers (e.g. URLs as header names)
- When Host is missing, "origin", or localhost/127.0.0.1 without port: uses `localhost:4000` (or `ENCORE_PUBLIC_HOST`)

### Form Data (web/app/lib/form-data.server.ts)

- Handles missing/unexpected Content-Type: falls back to parsing body as URLSearchParams
- Supports application/json, application/x-www-form-urlencoded, multipart/form-data

### React Router CSRF (web/react-router.config.ts)

- `allowedActionOrigins` uses host format (e.g. `localhost:4000`) per React Router 7.12+ requirements

### createEncoreClient (web/app/lib/encore.server.ts)

- When request URL hostname is "origin", falls back to `localhost:4000` or `ENCORE_API_BASE_URL`
