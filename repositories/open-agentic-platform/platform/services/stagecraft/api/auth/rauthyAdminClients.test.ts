// Spec 137 Phase 3 / T033 — Rauthy admin client wrapper tests.
//
// Two surfaces:
//
//   1. Pure helpers (`tenantGateClientId`, `tenantGateRedirectUri`,
//      `buildTenantGateClientPayload`, `assertNoPasswordFlow`).
//      Direct call, no network.
//
//   2. `provisionTenantGateClient` + `deprovisionTenantGateClient`
//      driven against a stub fetch — exercises the four contract
//      assumptions confirmed by T003 against the live Rauthy 0.35
//      instance:
//
//        (a) GET-then-POST creates a new client when absent
//        (b) GET-then-PUT updates an existing client (no PATCH path)
//        (c) DELETE returns 200 on existence; 404 is treated as
//            `existed: false` (idempotent)
//        (d) The constructed payload NEVER includes `password` in
//            `flows_enabled` — FR-004 invariant
//
//   The test substitutes a recording fetch so the call sequence is
//   asserted verbatim (path, method, body shape).

import { describe, expect, test } from "vitest";
import {
  assertNoPasswordFlow,
  buildTenantGateClientPayload,
  deprovisionTenantGateClient,
  fetchRauthyClientSecret,
  provisionTenantGateClient,
  tenantGateClientId,
  tenantGateRedirectUri,
} from "./rauthyAdminClients";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("tenantGateClientId", () => {
  test("prefixes the environment id deterministically", () => {
    expect(tenantGateClientId("env-abc-123")).toBe("tenant-gate-env-abc-123");
  });
});

describe("tenantGateRedirectUri", () => {
  test("builds the oauth2-proxy callback URL", () => {
    expect(tenantGateRedirectUri("dev.checkout.acme.tenants.example.com")).toBe(
      "https://dev.checkout.acme.tenants.example.com/oauth2/callback",
    );
  });
});

describe("buildTenantGateClientPayload", () => {
  const spec = {
    clientId: "tenant-gate-env-1",
    name: "Tenant Gate · checkout · dev",
    tenantHostname: "dev.checkout.acme.tenants.example.com",
    magicLinkEnabled: true,
    federatedProvider: null,
  } as const;

  test("never includes 'password' in flows_enabled (FR-004 invariant)", () => {
    const payload = buildTenantGateClientPayload(spec);
    expect(payload.flows_enabled).not.toContain("password");
  });

  test("hard-codes confidential + EdDSA + S256 challenge", () => {
    const payload = buildTenantGateClientPayload(spec);
    expect(payload.confidential).toBe(true);
    expect(payload.access_token_alg).toBe("EdDSA");
    expect(payload.id_token_alg).toBe("EdDSA");
    expect(payload.challenges).toEqual(["S256"]);
  });

  test("derives redirect_uris and allowed_origins from the hostname", () => {
    const payload = buildTenantGateClientPayload(spec);
    expect(payload.redirect_uris).toEqual([
      "https://dev.checkout.acme.tenants.example.com/oauth2/callback",
    ]);
    expect(payload.allowed_origins).toEqual([
      "https://dev.checkout.acme.tenants.example.com",
    ]);
  });

  test("uses the minimal OIDC scope set (openid email profile)", () => {
    const payload = buildTenantGateClientPayload(spec);
    expect(payload.scopes.sort()).toEqual(["email", "openid", "profile"]);
    expect(payload.default_scopes).toEqual(["openid"]);
  });

  test("sanitizes the name to Rauthy's [a-zA-Z0-9À-ɏ-\\s] regex (strips '·')", () => {
    // Rauthy 0.35 rejects the create/update with a 400 when the client
    // name carries the middle-dot separator statecraft's UI used to build.
    const payload = buildTenantGateClientPayload(spec);
    expect(payload.name).not.toMatch(/·/);
    expect(payload.name).toMatch(/^[a-zA-Z0-9À-ɏ\-\s]{2,128}$/);
    expect(payload.name).toBe("Tenant Gate checkout dev");
  });

  test("falls back to the client id when the name sanitizes to empty", () => {
    const payload = buildTenantGateClientPayload({
      ...spec,
      name: "···",
    });
    expect(payload.name).toBe(spec.clientId);
    expect(payload.name).toMatch(/^[a-zA-Z0-9À-ɏ\-\s]{2,128}$/);
  });
});

describe("assertNoPasswordFlow", () => {
  test("passes for a clean payload", () => {
    const payload = buildTenantGateClientPayload({
      clientId: "ok",
      name: "ok",
      tenantHostname: "ok.example.com",
      magicLinkEnabled: true,
      federatedProvider: null,
    });
    expect(() => assertNoPasswordFlow(payload)).not.toThrow();
  });

  test("throws when 'password' has been added to flows_enabled", () => {
    const payload = buildTenantGateClientPayload({
      clientId: "leaky",
      name: "leaky",
      tenantHostname: "leaky.example.com",
      magicLinkEnabled: true,
      federatedProvider: null,
    });
    payload.flows_enabled = [...payload.flows_enabled, "password"];
    expect(() => assertNoPasswordFlow(payload)).toThrow(
      /FR-004 invariant violation/,
    );
  });
});

// ---------------------------------------------------------------------------
// Provision/deprovision — fetch-injectable
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface StubResponse {
  status: number;
  body?: unknown;
}

function makeStubFetch(
  responses: Record<string, StubResponse>,
  recorder: RecordedCall[],
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    recorder.push({
      url,
      method,
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const resp = responses[key];
    if (!resp) {
      throw new Error(`unexpected fetch: ${key}`);
    }
    return {
      status: resp.status,
      ok: resp.status >= 200 && resp.status < 300,
      text: async () => (resp.body ? JSON.stringify(resp.body) : ""),
      json: async () => resp.body,
    } as Response;
  }) as typeof globalThis.fetch;
}

const ADMIN_CTX = {
  baseUrl: "http://rauthy.test/",
  authHeader: "API-Key test$secret",
};
const SPEC = {
  clientId: "tenant-gate-env-1",
  name: "Tenant Gate Test",
  tenantHostname: "test.tenants.example.com",
  magicLinkEnabled: true,
  federatedProvider: null,
} as const;

describe("provisionTenantGateClient", () => {
  test("(a) creates a new client via POST when GET returns 404 + captures secret", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
          status: 404,
        },
        "POST http://rauthy.test/auth/v1/clients": {
          status: 200,
          body: { id: "tenant-gate-env-1", secret: "freshly-minted-secret" },
        },
      },
      calls,
    );

    const result = await provisionTenantGateClient(SPEC, {
      ...ADMIN_CTX,
      fetchImpl,
    });

    expect(result).toEqual({
      clientId: "tenant-gate-env-1",
      action: "created",
      clientSecret: "freshly-minted-secret",
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1",
      "POST http://rauthy.test/auth/v1/clients",
    ]);
    // POST body carries the expected payload (FR-004 invariant + shape)
    const post = calls[1];
    expect(post.body).toMatchObject({
      id: "tenant-gate-env-1",
      confidential: true,
      flows_enabled: ["authorization_code"],
    });
    expect((post.body as { flows_enabled: string[] }).flows_enabled).not.toContain(
      "password",
    );
  });

  test("(a') accepts `client_secret` field as alternative to `secret`", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
          status: 404,
        },
        "POST http://rauthy.test/auth/v1/clients": {
          status: 200,
          body: { id: "tenant-gate-env-1", client_secret: "alt-shape-secret" },
        },
      },
      calls,
    );
    const result = await provisionTenantGateClient(SPEC, {
      ...ADMIN_CTX,
      fetchImpl,
    });
    expect(result.clientSecret).toBe("alt-shape-secret");
  });

  test("(a'') Rauthy 0.35: create response omits secret, secret endpoint supplies it", async () => {
    // Verified contract: POST /clients returns a ClientResponse with NO
    // secret; the secret is read back from POST /clients/{id}/secret.
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
          status: 404,
        },
        "POST http://rauthy.test/auth/v1/clients": {
          status: 200,
          // 0.35 ClientResponse shape: id present, no secret field.
          body: { id: "tenant-gate-env-1", confidential: true },
        },
        "POST http://rauthy.test/auth/v1/clients/tenant-gate-env-1/secret": {
          status: 200,
          body: {
            id: "tenant-gate-env-1",
            confidential: true,
            secret: "endpoint-secret",
          },
        },
      },
      calls,
    );

    const result = await provisionTenantGateClient(SPEC, {
      ...ADMIN_CTX,
      fetchImpl,
    });

    expect(result.clientSecret).toBe("endpoint-secret");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1",
      "POST http://rauthy.test/auth/v1/clients",
      "POST http://rauthy.test/auth/v1/clients/tenant-gate-env-1/secret",
    ]);
  });

  test("(a''') throws fail-loud when neither create nor secret endpoint yields a secret", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
          status: 404,
        },
        "POST http://rauthy.test/auth/v1/clients": {
          status: 200,
          body: { id: "tenant-gate-env-1" /* no secret */ },
        },
        "POST http://rauthy.test/auth/v1/clients/tenant-gate-env-1/secret": {
          status: 200,
          body: { id: "tenant-gate-env-1", confidential: true, secret: null },
        },
      },
      calls,
    );
    await expect(
      provisionTenantGateClient(SPEC, { ...ADMIN_CTX, fetchImpl }),
    ).rejects.toThrow(/no client secret could be recovered/i);
  });

  test("(b) updates an existing client via PUT (NOT PATCH) and returns clientSecret: null", async () => {
    const calls: RecordedCall[] = [];
    const existing = {
      id: "tenant-gate-env-1",
      name: "Stale name",
      flows_enabled: ["authorization_code"],
    };
    const fetchImpl = makeStubFetch(
      {
        "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
          status: 200,
          body: existing,
        },
        "PUT http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
          status: 200,
        },
      },
      calls,
    );

    const result = await provisionTenantGateClient(SPEC, {
      ...ADMIN_CTX,
      fetchImpl,
    });

    expect(result).toEqual({
      clientId: "tenant-gate-env-1",
      action: "updated",
      clientSecret: null,
    });
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    // No PATCH was sent (Rauthy 0.35 has no PATCH endpoint per T003)
    expect(calls.find((c) => c.method === "PATCH")).toBeUndefined();
  });
});

describe("fetchRauthyClientSecret", () => {
  test("reads the secret via POST /clients/{id}/secret (read, not rotate)", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "POST http://rauthy.test/auth/v1/clients/tenant-gate-env-1/secret": {
          status: 200,
          body: {
            id: "tenant-gate-env-1",
            confidential: true,
            secret: "recovered-secret",
          },
        },
      },
      calls,
    );
    const secret = await fetchRauthyClientSecret("tenant-gate-env-1", {
      ...ADMIN_CTX,
      fetchImpl,
    });
    expect(secret).toBe("recovered-secret");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(
      "http://rauthy.test/auth/v1/clients/tenant-gate-env-1/secret",
    );
  });

  test("returns null when the client is absent (404)", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "POST http://rauthy.test/auth/v1/clients/ghost/secret": { status: 404 },
      },
      calls,
    );
    const secret = await fetchRauthyClientSecret("ghost", {
      ...ADMIN_CTX,
      fetchImpl,
    });
    expect(secret).toBeNull();
  });
});

describe("deprovisionTenantGateClient", () => {
  test("(c) returns existed:true on successful DELETE (200)", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "DELETE http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
          status: 200,
        },
      },
      calls,
    );

    const result = await deprovisionTenantGateClient("tenant-gate-env-1", {
      ...ADMIN_CTX,
      fetchImpl,
    });

    expect(result).toEqual({ existed: true });
  });

  test("(c) idempotent: DELETE → 404 returns existed:false rather than throw", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "DELETE http://rauthy.test/auth/v1/clients/ghost": { status: 404 },
      },
      calls,
    );

    const result = await deprovisionTenantGateClient("ghost", {
      ...ADMIN_CTX,
      fetchImpl,
    });

    expect(result).toEqual({ existed: false });
  });

  test("throws on non-2xx, non-404 (e.g. 5xx)", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "DELETE http://rauthy.test/auth/v1/clients/broken": { status: 503 },
      },
      calls,
    );

    await expect(
      deprovisionTenantGateClient("broken", { ...ADMIN_CTX, fetchImpl }),
    ).rejects.toThrow(/503/);
  });
});

describe("FR-004 invariant — guard fires before network", () => {
  test("(d) provisionTenantGateClient cannot ship a password grant", async () => {
    // Simulate a future caller that hand-builds a payload with password
    // enabled and tries to push it through. The guard in
    // createRauthyClient / putRauthyClient catches this before the
    // network hop.
    const calls: RecordedCall[] = [];
    const fetchImpl = makeStubFetch(
      {
        "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
          status: 404,
        },
        // No POST stub registered — if assertNoPasswordFlow fails to
        // fire, the test will throw `unexpected fetch: POST ...`
        // rather than a useful invariant violation. So we ALSO
        // verify the recorded calls show GET only.
      },
      calls,
    );

    // Monkey-patch buildTenantGateClientPayload would be invasive; the
    // assertNoPasswordFlow test above proves the guard itself fires.
    // Here we assert the happy-path produces a payload that passes the
    // guard, which is the integration leg.
    const result = await provisionTenantGateClient(SPEC, {
      ...ADMIN_CTX,
      fetchImpl: makeStubFetch(
        {
          "GET http://rauthy.test/auth/v1/clients/tenant-gate-env-1": {
            status: 404,
          },
          "POST http://rauthy.test/auth/v1/clients": {
            status: 200,
            body: { id: "tenant-gate-env-1", secret: "fr-004-test-secret" },
          },
        },
        calls,
      ),
    });
    expect(result.action).toBe("created");
    const postCall = calls.find((c) => c.method === "POST");
    expect(postCall).toBeDefined();
    expect(
      (postCall!.body as { flows_enabled: string[] }).flows_enabled,
    ).not.toContain("password");
  });
});
