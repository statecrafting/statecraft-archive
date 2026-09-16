# Frontend Architecture

The **acme-vue-encore** frontend consists of two distinct Vue 3 Single-Page Applications (SPAs) built with Vite and PrimeVue.

## The Dual-SPA Layout

The repository contains two separate SPAs to cleanly isolate public-facing features from administrative tools:

1. **`apps/web`**: The public-facing application intended for external users.
2. **`apps/web-internal`**: The staff-facing application intended for internal administrators.

Both SPAs share common types, Zod schemas, and utilities provided by the `@template/shared` workspace package.

## Technology Stack

- **Vue 3**: Utilizing the `<script setup>` syntax and Composition API exclusively. The Options API is not used.
- **PrimeVue**: The UI component library, utilizing the Aura theme preset registered centrally in `main.ts`. Components are imported per-SFC (Single-File Component).
- **Vite**: The build tool and development server.
- **Pinia**: The state management library.
- **Vue Router**: For client-side routing.

## Encore Client Integration

A key feature of the frontend architecture is its tight integration with the Encore.ts backend, governed by **spec 006**.

Instead of manually maintaining `fetch` or `axios` calls, the SPAs consume a generated, strongly-typed Encore client. This client is committed to the repository at `apps/web/src/lib/encore-client.ts`.

This integration provides several benefits:
- **Type Safety**: Endpoints, request payloads, and response shapes are fully typed, catching drift between the frontend and backend at compile time.
- **Direct Consumption**: The Pinia auth stores consume Encore-native response payloads directly. The legacy `{ success, data }` envelope pattern has been fully retired.
- **CSRF Handling**: The stores automatically obtain the CSRF token from the endpoint body and include it in subsequent requests.

A CI staleness gate ensures that the committed typed client never drifts from the actual backend API surface. If the backend changes, the client must be regenerated using `npm --prefix apps/api run gen:client`.

## Authentication State

Authentication state is managed by a Pinia store (`auth.store.ts`). This store interfaces with the Encore client to handle login redirects, token refresh, and logout. Vue Router guards protect specific routes, ensuring that unauthenticated users are redirected to the login flow.
