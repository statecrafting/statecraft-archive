// Spec 143 FR-009 + FR-009b — dual-endpoint storage client routing.
//
// The production failure mode this test pins is "presigning helper goes
// through the wrong S3 client during a refactor", which on Hetzner means
// the browser receives a presigned URL pointing at a host it cannot reach
// and the upload silently fails. The test stands up two ephemeral HTTP
// listeners (one designated "internal", one "public"), wires
// S3_ENDPOINT / S3_PUBLIC_ENDPOINT at each, and asserts:
//
//   - getPresignedUploadUrl produces a URL whose host is the public
//     listener (FR-002)
//   - PUT against that URL lands on the public listener, NOT the internal
//     one (FR-009)
//   - When S3_PUBLIC_ENDPOINT is unset, the URL targets the internal
//     listener (FR-007 fallback)
//   - headObject() always hits the internal listener even when both
//     endpoints are configured (FR-009b asymmetric routing — pins the
//     server-side ops against accidental drift to the public client)
//   - URL shape is path-style (FR-001 forcePathStyle invariant)
//   - Signatures change with the endpoint, proving the signature is
//     endpoint-bound and not a constant
//
// The test uses bare vitest (no Encore runtime) so it runs under
// `npm test` and CI; secrets resolve via the env-var mock at
// `test/__mocks__/encore-config.ts`.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Env must be set BEFORE the storage module's lazy-init reads it. Region
// and credentials are required for SigV4 to compute a signature at all;
// endpoints are pinned per test below via beforeEach.
process.env.S3_REGION = "us-east-1";
process.env.S3_ACCESS_KEY = "AKTESTKEYAKTESTKEY12";
process.env.S3_SECRET_KEY = "test-secret-key-test-secret-key-test1";

import {
  _resetClientsForTesting,
  _resolveEndpoints,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  headObject,
} from "./storage";

// ---------------------------------------------------------------------------
// Recording HTTP listener fixture
// ---------------------------------------------------------------------------

type RecordedRequest = {
  method: string;
  url: string;
  hostHeader: string | undefined;
  headers: Record<string, string | string[] | undefined>;
};

function createListener() {
  const recorded: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    recorded.push({
      method: req.method ?? "",
      url: req.url ?? "",
      hostHeader: req.headers.host,
      headers: req.headers,
    });
    // Drain the body so the SDK doesn't stall waiting on the upload to
    // be acknowledged.
    req.resume();
    req.on("end", () => {
      // 200 with empty body satisfies HEAD, GET, PUT, and the
      // ensureBucket → HeadBucket pre-flight.
      res.writeHead(200, { "Content-Length": "0", ETag: '"test-etag"' });
      res.end();
    });
  });

  let port = 0;
  return {
    async start(): Promise<void> {
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          port = (server.address() as AddressInfo).port;
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    get port(): number {
      return port;
    },
    get host(): string {
      return `127.0.0.1:${port}`;
    },
    get endpoint(): string {
      return `http://127.0.0.1:${port}`;
    },
    get recorded(): RecordedRequest[] {
      return recorded;
    },
    reset(): void {
      recorded.length = 0;
    },
  };
}

const internal = createListener();
const publicSrv = createListener();

beforeAll(async () => {
  await internal.start();
  await publicSrv.start();
});

afterAll(async () => {
  await internal.stop();
  await publicSrv.stop();
});

beforeEach(() => {
  internal.reset();
  publicSrv.reset();
  _resetClientsForTesting();
  // Re-pin endpoints. Tests that exercise the FR-007 fallback override
  // S3_PUBLIC_ENDPOINT inside the test body before calling
  // _resetClientsForTesting() again.
  process.env.S3_ENDPOINT = internal.endpoint;
  process.env.S3_PUBLIC_ENDPOINT = publicSrv.endpoint;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSignedUrl(url: string) {
  const u = new URL(url);
  const params = u.searchParams;
  return {
    host: u.host,
    pathname: u.pathname,
    algorithm: params.get("X-Amz-Algorithm"),
    credential: params.get("X-Amz-Credential"),
    expires: params.get("X-Amz-Expires"),
    signature: params.get("X-Amz-Signature"),
  };
}

// ---------------------------------------------------------------------------
// FR-009 — public client signs against the public endpoint
// ---------------------------------------------------------------------------

describe("dual-client routing — getPresignedUploadUrl (FR-002, FR-009)", () => {
  test("URL host matches S3_PUBLIC_ENDPOINT, not S3_ENDPOINT", async () => {
    const url = await getPresignedUploadUrl(
      "test-bucket",
      "knowledge/abc/file.bin",
      "application/octet-stream",
    );
    const parsed = parseSignedUrl(url);
    expect(parsed.host).toBe(publicSrv.host);
    expect(parsed.host).not.toBe(internal.host);
  });

  test("URL is path-style, not virtual-hosted (FR-001 forcePathStyle)", async () => {
    const url = await getPresignedUploadUrl(
      "test-bucket",
      "knowledge/abc/file.bin",
      "application/octet-stream",
    );
    const parsed = parseSignedUrl(url);
    // Path-style: host = endpoint host, path = /<bucket>/<key>
    // Virtual-hosted (rejected for MinIO): host = <bucket>.<endpoint-host>
    expect(parsed.host).not.toMatch(/^test-bucket\./);
    expect(parsed.pathname).toBe("/test-bucket/knowledge/abc/file.bin");
  });

  test("URL carries the SigV4 query parameter set", async () => {
    const url = await getPresignedUploadUrl(
      "test-bucket",
      "knowledge/abc/file.bin",
      "application/octet-stream",
    );
    const parsed = parseSignedUrl(url);
    expect(parsed.algorithm).toBe("AWS4-HMAC-SHA256");
    expect(parsed.credential).toBeTruthy();
    expect(parsed.signature).toBeTruthy();
    expect(parsed.expires).toBeTruthy();
  });

  test("PUT against the URL lands on the public listener, NOT the internal one", async () => {
    const url = await getPresignedUploadUrl(
      "test-bucket",
      "knowledge/abc/file.bin",
      "application/octet-stream",
    );
    // ensureBucket runs a HeadBucket against the internal listener as a
    // side effect; reset and clear so the subsequent PUT assertion is
    // unambiguous.
    internal.reset();
    publicSrv.reset();

    const res = await fetch(url, {
      method: "PUT",
      body: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    });
    expect(res.status).toBe(200);

    expect(publicSrv.recorded.length).toBe(1);
    expect(publicSrv.recorded[0].method).toBe("PUT");
    expect(publicSrv.recorded[0].hostHeader).toBe(publicSrv.host);
    expect(internal.recorded.length).toBe(0);
  });

  test("signature is endpoint-bound (changes when S3_PUBLIC_ENDPOINT changes)", async () => {
    const url1 = await getPresignedUploadUrl(
      "test-bucket",
      "knowledge/abc/file.bin",
      "application/octet-stream",
    );

    // Same fixed inputs except for the public endpoint host. Different
    // endpoint → different canonical request → different signature.
    process.env.S3_PUBLIC_ENDPOINT = "http://127.0.0.1:65535";
    _resetClientsForTesting();

    const url2 = await getPresignedUploadUrl(
      "test-bucket",
      "knowledge/abc/file.bin",
      "application/octet-stream",
    );

    const sig1 = parseSignedUrl(url1).signature;
    const sig2 = parseSignedUrl(url2).signature;
    expect(sig1).toBeTruthy();
    expect(sig2).toBeTruthy();
    expect(sig1).not.toBe(sig2);
  });
});

// ---------------------------------------------------------------------------
// FR-007 — fallback when S3_PUBLIC_ENDPOINT is unset
// ---------------------------------------------------------------------------

describe("dual-client routing — fallback semantics (FR-007)", () => {
  test("unset S3_PUBLIC_ENDPOINT → public client targets S3_ENDPOINT", async () => {
    process.env.S3_PUBLIC_ENDPOINT = "";
    _resetClientsForTesting();

    const resolved = _resolveEndpoints();
    expect(resolved.internal).toBe(internal.endpoint);
    expect(resolved.public).toBe(internal.endpoint);

    const url = await getPresignedUploadUrl(
      "test-bucket",
      "knowledge/abc/file.bin",
      "application/octet-stream",
    );
    const parsed = parseSignedUrl(url);
    expect(parsed.host).toBe(internal.host);
  });

  test("undefined S3_PUBLIC_ENDPOINT (env unset) → same fallback", async () => {
    delete process.env.S3_PUBLIC_ENDPOINT;
    _resetClientsForTesting();

    const url = await getPresignedDownloadUrl("test-bucket", "knowledge/abc/file.bin");
    const parsed = parseSignedUrl(url);
    expect(parsed.host).toBe(internal.host);
  });
});

// ---------------------------------------------------------------------------
// FR-009b — asymmetric routing: server-side ops always use the internal client
// ---------------------------------------------------------------------------

describe("dual-client routing — asymmetric server-side ops (FR-009b)", () => {
  test("headObject() hits the internal listener, NOT the public one", async () => {
    // Both endpoints set; the test asserts that headObject does not
    // accidentally route through the public client.
    await headObject("test-bucket", "knowledge/abc/file.bin");

    expect(internal.recorded.length).toBeGreaterThan(0);
    expect(internal.recorded.some((r) => r.method === "HEAD")).toBe(true);
    expect(publicSrv.recorded.length).toBe(0);
  });

  test("getPresignedDownloadUrl uses the public client", async () => {
    const url = await getPresignedDownloadUrl(
      "test-bucket",
      "knowledge/abc/file.bin",
      300, // FR-012 knowledge-UI download TTL
    );
    const parsed = parseSignedUrl(url);
    expect(parsed.host).toBe(publicSrv.host);
    expect(parsed.expires).toBe("300");
  });
});
