/**
 * Tenants service configuration: the GitHub App identity and its secrets.
 *
 * The App itself is fixed (spec 004 §1): "statecraft.ing GitHub App", App ID
 * 3319911, slug `statecraft-ing-github-app`. Its three secrets live in the
 * central infra config and are wired into Encore secrets (infra.config.json).
 * In a deployed/self-host environment `secret()` returns the bound value; in
 * local dev it returns "" and we fall back to `process.env` so an operator can
 * source `~/.config/oap/infra/hetzner/.env` before `npm run dev` and exercise
 * the real flow. Values are never logged or committed.
 */
import { secret } from "encore.dev/config";

const appIdSecret = secret("GITHUB_APP_ID");
const privateKeyB64Secret = secret("GITHUB_APP_PRIVATE_KEY_B64");
const webhookSecret = secret("GITHUB_WEBHOOK_SECRET");

/** The App's public slug: used to build the installation URL (spec 004 §1). */
export const GITHUB_APP_SLUG = "statecraft-ing-github-app";

/** REST base and pinned API version (spec 004 §3: plain fetch, auditable). */
export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";

/** How long a signed install `state` token stays valid (short-lived binding). */
export const STATE_TTL_SECONDS = 10 * 60;

/**
 * Where /github/setup redirects the browser after persisting the installation.
 * Relative by default so it lands on this app's own SPA origin; overridable via
 * env for split-origin deployments.
 */
export function webappBaseUrl(): string {
  return (process.env.WEBAPP_BASE_URL ?? "").replace(/\/+$/, "");
}

function fromSecretOrEnv(value: string, envName: string): string {
  const v = value.trim();
  if (v.length > 0) return v;
  return (process.env[envName] ?? "").trim();
}

/** The App ID (public), used as the `iss` of App JWTs. */
export function githubAppId(): string {
  return fromSecretOrEnv(appIdSecret(), "GITHUB_APP_ID");
}

/** The App's RSA private key PEM, base64-decoded before use (spec 004 §1). */
export function githubPrivateKeyPem(): string {
  const b64 = fromSecretOrEnv(privateKeyB64Secret(), "GITHUB_APP_PRIVATE_KEY_B64");
  if (!b64) return "";
  return Buffer.from(b64, "base64").toString("utf8");
}

/** The webhook signing secret; also signs the install `state` token (v1). */
export function githubWebhookSecret(): string {
  return fromSecretOrEnv(webhookSecret(), "GITHUB_WEBHOOK_SECRET");
}
