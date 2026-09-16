import { api } from "encore.dev/api";

/**
 * Serves the built Vue SPA (spec 005). The /!path catch-all is the lowest
 * priority route in Encore's router, so it yields to /api/*, /health, and
 * /api/v1/data/*. notFound enables Vue Router history-mode fallback.
 */
export const spa = api.static({
  expose: true,
  path: "/!path",
  dir: "./build",
  notFound: "./build/index.html",
});
