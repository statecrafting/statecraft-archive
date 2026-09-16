/**
 * Secret declarations (INV-7, INV-9, INV-10). Values are provided by Encore's
 * secret store in deployed environments. In local development secret() returns
 * an empty string when unset, so the JWT keys fall back to the PEM files written
 * by `npm run generate-keys` (keys/ is gitignored and absent from deployments).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { secret } from "encore.dev/config";

const jwtPrivateKey = secret("JWT_PRIVATE_KEY");
const jwtPublicKey = secret("JWT_PUBLIC_KEY");
const jwtRefreshPrivateKey = secret("JWT_REFRESH_PRIVATE_KEY");
const jwtRefreshPublicKey = secret("JWT_REFRESH_PUBLIC_KEY");

// Driver and gateway secrets (read directly where needed).
export const rauthyClientSecret = secret("RAUTHY_CLIENT_SECRET");
export const gatewayOAuthClientSecret = secret("GATEWAY_OAUTH_CLIENT_SECRET");

const keysDir = join(dirname(fileURLToPath(import.meta.url)), "..", "keys");

function withDevFileFallback(value: string, pemFile: string): string {
  if (value && value.trim().length > 0) return value;
  try {
    return readFileSync(join(keysDir, pemFile), "utf8");
  } catch {
    return "";
  }
}

export function accessPrivateKey(): string {
  return withDevFileFallback(jwtPrivateKey(), "access-private.pem");
}
export function accessPublicKey(): string {
  return withDevFileFallback(jwtPublicKey(), "access-public.pem");
}
export function refreshPrivateKey(): string {
  return withDevFileFallback(jwtRefreshPrivateKey(), "refresh-private.pem");
}
export function refreshPublicKey(): string {
  return withDevFileFallback(jwtRefreshPublicKey(), "refresh-public.pem");
}
