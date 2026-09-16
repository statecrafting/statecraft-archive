# Encore.ts Reference

This document provides a brief reference for the Encore.ts primitives used extensively in **acme-vue-encore**. For comprehensive documentation, see the [official Encore.ts documentation](https://encore.dev/docs/ts).

## `api()`

Defines a strongly-typed API endpoint.

```typescript
import { api } from "encore.dev/api";

export const getResource = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/resource/:id" },
  async (params: { id: string }): Promise<ResourceResponse> => {
    // Implementation
  }
);
```

- `expose: true`: Makes the endpoint accessible over HTTP.
- `auth: true`: Routes the request through the application's `authHandler`.

## `api.raw()`

Defines an endpoint that accesses the raw Node.js `IncomingMessage` and `ServerResponse` objects. Used for endpoints that don't fit the standard JSON request/response model, such as the BFF gateway or webhooks.

```typescript
import { api } from "encore.dev/api";

export const proxy = api.raw(
  { expose: true, auth: true, method: "ALL", path: "/api/v1/data/*path" },
  async (req, res) => {
    // Implementation
  }
);
```

## `api.static()`

Serves static files from a directory. Used by the `web` service to serve the built Vue SPA.

```typescript
import { api } from "encore.dev/api";

export const spa = api.static({
  expose: true,
  path: "/!path",
  dir: "./build",
  notFound: "./build/index.html", // Enables Vue Router history mode
});
```

## `SQLDatabase`

Declares a Postgres database instance.

```typescript
import { SQLDatabase } from "encore.dev/storage/sqldb";

export const db = new SQLDatabase("app", {
  migrations: "./migrations",
});
```

All queries must use the tagged-template syntax:

```typescript
await db.queryRow`SELECT * FROM users WHERE id = ${id}`;
```

## `secret()`

Declares a configuration value that must be provided via the Encore secret store.

```typescript
import { secret } from "encore.dev/config";

export const jwtPrivateKey = secret("JWT_PRIVATE_KEY");
```
