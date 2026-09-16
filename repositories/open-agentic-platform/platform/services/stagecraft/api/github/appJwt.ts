/**
 * Shared GitHub App JWT signer.
 *
 * Signs RS256 JWTs as the GitHub App identity for use in installation token
 * exchange. Extracted from token.ts so both the token broker and repo
 * initialization (spec 080 FR-008) share a single signing implementation.
 */

import { secret } from "encore.dev/config";

const githubAppId = secret("GITHUB_APP_ID");
const githubPrivateKey = secret("GITHUB_APP_PRIVATE_KEY");

/**
 * Sign a JWT as the GitHub App (RS256, 10-minute TTL).
 * Used to authenticate with the GitHub API to obtain installation tokens.
 */
export async function signAppJwt(): Promise<string> {
  const appId = githubAppId();
  const privateKey = githubPrivateKey();

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60, // 60 seconds in the past for clock skew
      exp: now + 600, // 10-minute TTL
      iss: appId,
    })
  ).toString("base64url");

  const { createSign } = await import("crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey, "base64url");

  return `${header}.${payload}.${signature}`;
}
