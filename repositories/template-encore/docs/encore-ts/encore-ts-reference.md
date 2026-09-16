# Encore.ts API Reference

> Extracted from the Encore-generated AGENTS.md knowledge base. On-demand reference — not auto-loaded into Claude Code sessions.

## Node.js / TypeScript Style

- Always use ES6+ syntax
- Use built-in `fetch` for HTTP requests (not `node-fetch`)
- Always use `import`, never `require`
- Use `interface` or `type` for complex objects
- Prefer TypeScript built-in utility types (`Record`, `Partial`, `Pick`) over `any`

## API Definitions

Encore.ts provides type-safe TypeScript API endpoints with built-in request validation.

```ts
import { api } from "encore.dev/api";

interface PingParams {
  name: string;
}
interface PingResponse {
  message: string;
}

export const ping = api(
  { method: "POST" },
  async (p: PingParams): Promise<PingResponse> => {
    return { message: `Hello ${p.name}!` };
  }
);
```

**Options:** `method` (HTTP method), `expose` (boolean, default false), `auth` (boolean), `path` (URL pattern)

**Schema patterns:**
- Full: `api({ ... }, async (params: Params): Promise<Response> => {})`
- Response only: `api({ ... }, async (): Promise<Response> => {})`
- Request only: `api({ ... }, async (params: Params): Promise<void> => {})`
- No data: `api({ ... }, async (): Promise<void> => {})`

**Parameter types:**
- `Header<"Header-Name">` — maps field to HTTP header
- `Query<type>` — maps field to URL query parameter
- Path params via `:param` or `*wildcard` syntax

## Service-to-Service Calls

```ts
import { hello } from "~encore/clients";

export const myOtherAPI = api({}, async (): Promise<void> => {
  const resp = await hello.ping({ name: "World" });
  console.log(resp.message); // "Hello World!"
});
```

## Application Structure

**Service definition:**
```ts
import { Service } from "encore.dev/service";
export default new Service("my-service");
```

**Single service:**
```
/my-app
├── package.json
├── encore.app
├── encore.service.ts
├── api.ts
└── db.ts
```

**Multi service:**
```
/my-app
├── encore.app
├── hello/
│   ├── migrations/
│   ├── encore.service.ts
│   └── hello.ts
└── world/
    ├── encore.service.ts
    └── world.ts
```

## Raw Endpoints

Lower-level HTTP request access (useful for webhooks):

```ts
export const myRawEndpoint = api.raw(
  { expose: true, path: "/raw", method: "GET" },
  async (req, resp) => {
    resp.writeHead(200, { "Content-Type": "text/plain" });
    resp.end("Hello, raw world!");
  }
);
```

## API Errors

```ts
import { APIError, ErrCode } from "encore.dev/api";
throw new APIError(ErrCode.NotFound, "sprocket not found");
// or shorthand:
throw APIError.notFound("sprocket not found");
```

**Error codes:** OK (200), Canceled (499), Unknown (500), InvalidArgument (400), DeadlineExceeded (504), NotFound (404), AlreadyExists (409), PermissionDenied (403), ResourceExhausted (429), FailedPrecondition (400), Aborted (409), OutOfRange (400), Unimplemented (501), Internal (500), Unavailable (503), DataLoss (500), Unauthenticated (401)

Use `withDetails` on APIError to attach structured details for external clients.

## SQL Databases

```ts
import { SQLDatabase } from "encore.dev/storage/sqldb";

const db = new SQLDatabase("todo", {
  migrations: "./migrations",
});
```

**Migration naming:** Start with number + underscore, sequential, end with `.up.sql` (e.g., `001_first_migration.up.sql`)

**Operations:**
```ts
// Query multiple rows
const rows = await db.query<{ email: string }>`SELECT email FROM users`;
for await (const row of rows) { /* ... */ }

// Single row
const row = await db.queryRow`SELECT title FROM items WHERE id = ${id}`;

// Insert / no return
await db.exec`INSERT INTO items (title) VALUES (${title})`;
```

**CLI:** `db shell` (psql), `db conn-uri` (connection string), `db proxy` (local proxy), `db reset` (reset databases)

**Advanced:** Share databases via `SQLDatabase.named("name")`. Extensions: pgvector, PostGIS. ORM support: Prisma, Drizzle.

## Rate Limiting (Postgres-native, no Redis)

This template rate-limits with Postgres only: it reuses `SQLDatabase("app")`
instead of adding Redis or an Encore cache cluster (which is itself Redis-backed).
Encore Cache (`encore.dev/storage/cache`) is the documented Redis-backed option;
this project deliberately avoids it (spec 002 INV-6).

**Counter table** (UNLOGGED: skips the write-ahead log because rate-limit state is
ephemeral and the limiter fails open). One row per `tier:client` bucket:

```sql
CREATE UNLOGGED TABLE rate_limit_counter (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limit_counter_expires_at_idx ON rate_limit_counter (expires_at);
```

**Fixed-window increment** is one lock-free upsert (no `SELECT ... FOR UPDATE`, so
no serialization bottleneck): `ON CONFLICT DO UPDATE` serialises concurrent
increments on the single bucket row, and a window-expiry `CASE` resets the count
rather than letting it grow:

```ts
const row = await db.queryRow<{ count: number }>`
  INSERT INTO rate_limit_counter (bucket, count, window_start, expires_at)
  VALUES (${bucket}, 1, now(), now() + ${windowSeconds} * interval '1 second')
  ON CONFLICT (bucket) DO UPDATE SET
    count = CASE WHEN rate_limit_counter.expires_at < now()
                 THEN 1 ELSE rate_limit_counter.count + 1 END,
    window_start = CASE WHEN rate_limit_counter.expires_at < now()
                        THEN now() ELSE rate_limit_counter.window_start END,
    expires_at = CASE WHEN rate_limit_counter.expires_at < now()
                      THEN now() + ${windowSeconds} * interval '1 second'
                      ELSE rate_limit_counter.expires_at END
  RETURNING count
`;
```

**Two consumption shapes** (`apps/api/lib/rate-limit.ts`):
- A general API tier as Encore service middleware (`apiRateLimit`), mounted on the
  `auth` and `gateway` services; it throws `APIError.resourceExhausted` past the limit.
- A tighter auth tier consumed inline in the login/callback raw handlers
  (`withinAuthRateLimit(clientIp)`), which answer 429 directly. This mirrors
  Encore's own rate-limit example shape (an inline check inside the endpoint).

**Fail open:** any database error returns "allowed" and logs `ratelimit.backend_error`,
so a storage outage never blocks legitimate traffic; only a real breach is rejected.

**Cleanup (optional):** the row is reused per bucket, so the table is bounded by
distinct active clients and a prune is not required for correctness. For long-lived
deployments, prune silent buckets periodically (a `CronJob` is a good fit):

```sql
DELETE FROM rate_limit_counter WHERE expires_at < now();
```

**Why Postgres over Redis here:** one fewer service to run and secure, and the
counter shares the connection the app already has. A single Postgres op is
marginally slower than Redis (both sub-millisecond), which is irrelevant at this
template's scale and removes a dependency we were not otherwise using.

## Cron Jobs

```ts
import { CronJob } from "encore.dev/cron";

const _ = new CronJob("welcome-email", {
  title: "Send welcome emails",
  every: "2h",
  endpoint: sendWelcomeEmail,
});
```

**Scheduling:** `every` (periodic, must divide 24h evenly) or `schedule` (cron expression)

## Pub/Sub

```ts
import { Topic, Subscription } from "encore.dev/pubsub";

export interface SignupEvent { userID: string; }

export const signups = new Topic<SignupEvent>("signups", {
  deliveryGuarantee: "at-least-once",
});

// Publish
const messageID = await signups.publish({ userID: id });

// Subscribe
const _ = new Subscription(signups, "send-welcome-email", {
  handler: async (event) => { /* ... */ },
});
```

Topics must be package-level variables. Delivery guarantees: `at-least-once` (default, handlers must be idempotent) or `exactly-once`.

**Message attributes:** `Attribute<string>` for filtering/ordering. **Ordered delivery:** set `orderingAttribute`.

## Object Storage

```ts
import { Bucket } from "encore.dev/storage/objects";

export const profilePictures = new Bucket("profile-pictures", { versioned: false });

await profilePictures.upload("image.jpeg", data, { contentType: "image/jpeg" });
const data = await profilePictures.download("image.jpeg");
await profilePictures.remove("image.jpeg");

// Public access
export const publicBucket = new Bucket("public", { public: true, versioned: false });
const url = publicBucket.publicUrl("image.jpeg");
```

**Bucket references** for controlled permissions: `Downloader`, `Uploader`, `Lister`, `Attrser`, `Remover`, `ReadWriter`

## Secrets Management

```ts
import { secret } from "encore.dev/config";
const githubToken = secret("GitHubAPIToken");

// Usage
const resp = await fetch("https://api.github.com/user", {
  headers: { Authorization: `token ${githubToken()}` },
});
```

**Storage:** Cloud dashboard, CLI (`encore secret set --type <type> <name>`), or `.secrets.local.cue` for local overrides.

## Streaming APIs

WebSocket-based streaming endpoints:

```ts
// Server → Client
export const dataStream = api.streamOut<Message>(
  { path: "/stream", expose: true },
  async (stream) => {
    await stream.send({ data: "message" });
    await stream.close();
  }
);

// Client → Server
export const uploadStream = api.streamIn<Message>(
  { path: "/upload", expose: true },
  async (stream) => {
    for await (const data of stream) { /* ... */ }
  }
);

// Bidirectional
export const chatStream = api.streamInOut<InMessage, OutMessage>(
  { path: "/chat", expose: true },
  async (stream) => {
    for await (const msg of stream) {
      await stream.send(/* response */);
    }
  }
);
```

## Validation

```ts
import { Header, Query, api } from "encore.dev/api";
import { Min, Max, MinLen, MaxLen, IsEmail, IsURL } from "encore.dev/validate";

interface Request {
  limit?: Query<number>;
  myHeader: Header<"X-My-Header">;
  type: "sprocket" | "widget";
  count: number & (Min<3> & Max<1000>);
  username: string & (MinLen<5> & MaxLen<20>);
}
```

**Source types:** Body (default for POST/PUT), Query (default for GET/HEAD/DELETE, or explicit `Query<T>`), Headers (`Header<"Name">`), Path params (`:param` in path)

## Static Assets

```ts
export const assets = api.static(
  { expose: true, path: "/frontend/*path", dir: "./assets" },
);

// Root serving (uses !path to avoid conflicts)
export const assets = api.static(
  { expose: true, path: "/!path", dir: "./assets", notFound: "./not_found.html" },
);
```

## Authentication

```ts
import { Header, Gateway } from "encore.dev/api";
import { authHandler } from "encore.dev/auth";

interface AuthParams { authorization: Header<"Authorization">; }
interface AuthData { userID: string; }

export const auth = authHandler<AuthParams, AuthData>(
  async (params) => {
    return { userID: "my-user-id" };
  }
);

export const gateway = new Gateway({ authHandler: auth });
```

Rejection: `throw APIError.unauthenticated("bad credentials")`

Auth data access: `import { getAuthData } from "~encore/auth"`

## Metadata

```ts
import { appMeta, currentRequest } from "encore.dev";

appMeta()         // → appId, apiBaseUrl, environment, build, deploy
currentRequest()  // → APICallMeta | PubSubMessageMeta | undefined
```

## Middleware

```ts
import { middleware } from "encore.dev/api";

export default new Service("myService", {
  middlewares: [
    middleware({ target: { auth: true } }, async (req, next) => {
      const resp = await next(req);
      resp.header.set("X-Custom", "value");
      return resp;
    })
  ]
});
```

Middlewares execute in definition order. Use `target` option for selective application.

## Drizzle ORM Integration

```ts
import { SQLDatabase } from "encore.dev/storage/sqldb";
import { drizzle } from "drizzle-orm/node-postgres";

const db = new SQLDatabase("test", {
  migrations: { path: "migrations", source: "drizzle" },
});

const orm = drizzle(db.connectionString);
```

Generate migrations: `drizzle-kit generate` (in directory with `drizzle.config.ts`)

## CORS

Configure in `encore.app` under `global_cors`:
- `allow_headers`, `expose_headers` — additional headers (`"*"` for all)
- `allow_origins_without_credentials` — default `["*"]`
- `allow_origins_with_credentials` — supports wildcards (`https://*.example.com`)

## Logging

```ts
import log from "encore.dev/log";

log.info("message", { key: "value" });
log.error(err, "something went wrong");

const logger = log.with({ is_subscriber: true });
logger.info("user logged in", { login_method: "oauth" });
```

## Testing

Use **Vitest**. Run with `encore test` for automatic infrastructure setup.

```ts
import { describe, it, expect } from "vitest";
import { hello } from "./api";

describe("hello endpoint", () => {
  it("returns a greeting", async () => {
    const response = await hello();
    expect(response.message).toBe("Hello, World!");
  });
});
```

- Test API endpoints by calling them directly as functions
- Each test gets isolated database transaction (rolled back after)
- Don't mock Encore infrastructure — use the real thing
- Mock only external dependencies (third-party APIs, email services)

## Encore CLI Quick Reference

| Command | Purpose |
|---------|---------|
| `encore run` | Run application locally |
| `encore test` | Run tests with infra setup |
| `encore db shell <name>` | Connect via psql |
| `encore db conn-uri <name>` | Output connection string |
| `encore db reset [services...]` | Reset databases |
| `encore secret set --type <t> <name>` | Set secret |
| `encore secret list` | List secrets |
| `encore gen client [app-id]` | Generate API client |
| `encore build docker` | Build Docker image |
| `encore auth login` | Authenticate |
| `encore logs` | Stream logs |
