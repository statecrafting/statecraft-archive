import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

// When running `react-router dev`, the vite server sits in front of the Encore
// backend. Browser-initiated hits to Encore-owned paths are forwarded via
// `server.proxy`; SSR loaders reach Encore directly through
// `ENCORE_API_BASE_URL` (see `app/lib/encore.server.ts`).
//
// Only proxy paths Encore owns that don't collide with React Router pages.
// RR-owned paths like `/admin/users` intentionally stay unproxied so vite
// renders the page; its loader fetches data server-to-server.
const ENCORE_TARGET =
  process.env.ENCORE_PROXY_TARGET ?? "http://localhost:4000";

const encoreProxyPaths = [
  "/api",
  "/v1",
  "/site",
  "/healthz",
  "/ping",
  "/check",
  "/check-all",
  "/status",
  "/internal",
  "/auth/oidc",
  "/auth/rauthy",
  "/auth/desktop",
  "/auth/pending-orgs",
  "/auth/user-orgs",
  "/auth/org-switch",
  "/auth/signout",
];

export default defineConfig(({ command }) => ({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  resolve: {
    alias: {
      "~encore": path.resolve(__dirname, "../encore.gen"),
    },
  },
  server:
    command === "serve"
      ? {
          host: "127.0.0.1",
          port: 3000,
          strictPort: true,
          proxy: Object.fromEntries(
            encoreProxyPaths.map((p) => [
              p,
              {
                target: ENCORE_TARGET,
                changeOrigin: true,
                // Tag every proxied request so mirrord's http_filter in
                // infra/hetzner/mirrord/statecraft.yaml knows to steal it.
                // Untagged traffic (k8s probes, ingress hits) stays on the
                // pod, which keeps k8s from killing our mirrord target.
                headers: { "x-statecraft-dev": "1" },
              },
            ]),
          ),
        }
      : undefined,
}));
