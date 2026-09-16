# Development Workflow

This guide covers the day-to-day development workflow for **acme-vue-encore**.

## Running the Development Servers

The primary command for local development is:

```bash
npm run dev
```

Run from the repository root, this command uses `concurrently` to start three processes:
1. The Encore API backend on port 4000 (`encore run`).
2. The public Vue SPA Vite server on port 5173.
3. The internal Vue SPA Vite server on port 5174.

The Vite development servers are configured to proxy `/api/*` requests to the Encore backend, avoiding CORS issues during local development. Both the frontend and backend support hot module replacement (HMR) / hot reloading, so changes are reflected immediately without restarting the servers.

## Adding Backend Endpoints

To add a new API endpoint, simply create a new `.ts` file within the appropriate service directory in `apps/api/` and export an `api()` or `api.raw()` definition.

```typescript
// apps/api/myservice/hello.ts
import { api } from "encore.dev/api";

export const hello = api(
  { expose: true, method: "GET", path: "/api/v1/hello" },
  async (): Promise<{ message: string }> => {
    return { message: "Hello, world!" };
  }
);
```

Encore automatically discovers the endpoint based on the `encore.service.ts` declaration in the directory. You do not need to register the route in a central file.

## Adding Frontend Views

To add a new page to one of the SPAs:
1. Create a new `.vue` component in `apps/web/src/views/` (or `apps/web-internal/`).
2. Add a route for it in `apps/web/src/router/index.ts`.
3. Add a navigation link in the `AppHeader.vue` component.

## The Encore Dev Dashboard

While `encore run` is active, Encore provides a local development dashboard at `http://localhost:9400`. This dashboard includes:
- An API explorer for testing endpoints.
- A request trace viewer for debugging performance and errors.
- A database shell for inspecting the local Postgres instance.
