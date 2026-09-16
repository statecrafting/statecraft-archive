import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: the SPA runs on :5173 and proxies API + IdP traffic to `encore run`
    // on :4000. Cookies are host-scoped, not port-scoped, so the auth cookies
    // minted on :4000 during the OIDC callback are visible here too. The bare
    // /auth/* prefix is the rauthy reverse-proxy (idp service); /api/v1/auth/*
    // is this app's own auth service. Both live under :4000.
    proxy: {
      "/api": "http://localhost:4000",
      "/auth": "http://localhost:4000",
      "/health": "http://localhost:4000",
      "/hiq": "http://localhost:4000",
    },
  },
  build: {
    // Prod: the bundle lands inside the backend's web service; `encore build`
    // docker carries it into the single image. Same output path the chassis
    // web static service serves (spec 002); that service is untouched.
    outDir: fileURLToPath(new URL("../backend/web/dist", import.meta.url)),
    emptyOutDir: true,
  },
});
