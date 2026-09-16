/**
 * Published factory signing keys (spec 198 FR-014).
 *
 * Public, unauthenticated JWKS endpoint. Verifiers — the OPC engine
 * (admission seal, run-grant) and `verify-certificate --jwks-url`
 * (emission countersign) — resolve the `kid` in any platform-issued
 * compact JWS against this keyset. Serving only public keys, no auth:
 * the seal's trust anchor is possession of the private key, which never
 * leaves the platform (ASI10 m6).
 */

import { api, APIError } from "encore.dev/api";
import { factoryJwks, signingConfigured, type PublicJwk } from "./signing";

export const getFactoryJwks = api(
  {
    expose: true,
    auth: false,
    method: "GET",
    path: "/api/factory/.well-known/jwks.json",
  },
  async (): Promise<{ keys: PublicJwk[] }> => {
    if (!signingConfigured()) {
      throw APIError.unavailable(
        "factory signing authority is not configured on this deployment",
      );
    }
    return factoryJwks();
  },
);
