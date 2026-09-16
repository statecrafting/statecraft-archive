import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Boring static build. The apex is served at the domain root, so base is "/".
// No dev proxy, no server middleware: there is no backend to talk to.
export default defineConfig({
  base: "/",
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
