import Client from "./client";

const DEFAULT_API_BASE = "http://localhost:4000";

export function createEncoreClient(_request: Request): Client {
  // SSR runs in the same pod as the Encore API in production, and on
  // localhost:4000 in dev. Calling back out via the public hostname drops
  // the Cookie header when Cloudflare upgrades HTTP → HTTPS. Always loop
  // back via localhost:4000 (or an explicit ENCORE_API_BASE_URL override).
  return new Client(process.env.ENCORE_API_BASE_URL ?? DEFAULT_API_BASE);
}
