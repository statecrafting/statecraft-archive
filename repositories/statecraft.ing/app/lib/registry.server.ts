// Build-time disk read of the baked registry payload. This module is imported
// only by route loaders, which run in Node during prerendering (ssr: false).
// The `.server.ts` suffix keeps `node:fs` out of the client bundle.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { RegistryPayload } from "./registry";

let cached: RegistryPayload | null = null;

export function loadRegistry(): RegistryPayload {
  if (cached) return cached;
  const file = path.join(process.cwd(), "public", "data", "registry.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(
      `registry payload missing at ${file}: run \`npm run bake:registry\` before building. (${
        (err as Error).message
      })`
    );
  }
  cached = JSON.parse(raw) as RegistryPayload;
  return cached;
}
