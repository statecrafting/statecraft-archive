/**
 * Auth API helpers using the Encore client.
 *
 * Phase 5 (spec 087): password-based auth removed. All authentication
 * flows through GitHub OAuth → Rauthy OIDC JWT.
 */

import { createEncoreClient } from "./encore.server";

export async function authSignout(request: Request) {
  const client = createEncoreClient(request);
  return client.auth.signout();
}
