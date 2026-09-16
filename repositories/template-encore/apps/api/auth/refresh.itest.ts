/**
 * Integration tests for refresh-token rotation against a live Postgres
 * (spec 003 FR-004, AC-2; INV-7). Run under `encore test` (npm run
 * test:integration), which provisions an ephemeral database and applies the
 * migrations. Excluded from the fast `npm test` by the `.itest.ts` naming.
 */
import { describe, it, expect } from "vitest";
import { upsertUserFromProfile } from "./user-model";
import {
  storeRefreshToken,
  findActiveRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from "./refresh-token-model";
import type { SSOProfile } from "./types";

let userSeq = 0;
async function makeUser(): Promise<string> {
  userSeq += 1;
  const profile: SSOProfile = {
    ssoProvider: "mock",
    ssoProviderId: `itest-${process.pid}-${userSeq}`,
    email: `itest-${process.pid}-${userSeq}@example.com`,
    name: "Integration Test",
    roles: ["user"],
  };
  const user = await upsertUserFromProfile(profile);
  return user.id;
}

const future = (): Date => new Date(Date.now() + 60_000);
const past = (): Date => new Date(Date.now() - 60_000);
let tokenSeq = 0;
const uniqueToken = (): string => `itest-token-${process.pid}-${(tokenSeq += 1)}`;

describe("refresh-token rotation against a live DB (INV-7, spec 003 FR-004)", () => {
  it("stores only the hash and finds the active token by its raw value", async () => {
    const userID = await makeUser();
    const token = uniqueToken();
    const id = await storeRefreshToken({ userID, token, expiresAt: future() });
    expect(id).toMatch(/[0-9a-f-]{36}/);
    const found = await findActiveRefreshToken(token);
    expect(found?.id).toBe(id);
    expect(found?.user_id).toBe(userID);
  });

  it("returns null for an unknown token", async () => {
    expect(await findActiveRefreshToken(uniqueToken())).toBeNull();
  });

  it("returns null after the token is revoked", async () => {
    const userID = await makeUser();
    const token = uniqueToken();
    const id = await storeRefreshToken({ userID, token, expiresAt: future() });
    await revokeRefreshToken(id);
    expect(await findActiveRefreshToken(token)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const userID = await makeUser();
    const token = uniqueToken();
    await storeRefreshToken({ userID, token, expiresAt: past() });
    expect(await findActiveRefreshToken(token)).toBeNull();
  });

  it("rotation: revoking the presented token and linking its replacement removes only the old one", async () => {
    const userID = await makeUser();
    const oldToken = uniqueToken();
    const newToken = uniqueToken();
    const oldId = await storeRefreshToken({ userID, token: oldToken, expiresAt: future() });
    const newId = await storeRefreshToken({ userID, token: newToken, expiresAt: future() });
    await revokeRefreshToken(oldId, newId);
    expect(await findActiveRefreshToken(oldToken)).toBeNull();
    expect((await findActiveRefreshToken(newToken))?.id).toBe(newId);
  });

  it("revokeAllUserTokens revokes every active token for the user (cascade logout)", async () => {
    const userID = await makeUser();
    const a = uniqueToken();
    const b = uniqueToken();
    await storeRefreshToken({ userID, token: a, expiresAt: future() });
    await storeRefreshToken({ userID, token: b, expiresAt: future() });
    await revokeAllUserTokens(userID);
    expect(await findActiveRefreshToken(a)).toBeNull();
    expect(await findActiveRefreshToken(b)).toBeNull();
  });

  it("revokeRefreshToken is idempotent (a second call is a no-op)", async () => {
    const userID = await makeUser();
    const token = uniqueToken();
    const id = await storeRefreshToken({ userID, token, expiresAt: future() });
    await revokeRefreshToken(id);
    await revokeRefreshToken(id);
    expect(await findActiveRefreshToken(token)).toBeNull();
  });
});
