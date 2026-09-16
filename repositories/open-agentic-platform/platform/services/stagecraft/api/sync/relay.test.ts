import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock the downstream collaborators before importing the module under test.
// `dispatchServerEvent` writes to the outbox + registry; we want to assert the
// envelope shape without hitting the real stores. `resolveKnowledgeBundlesForFactory`
// hits the database and object store; stub it with a deterministic return.
// The db modules pull in `encore.dev/storage/sqldb`, which requires the Encore
// native runtime — stub them out so importing `relay.ts` does not detonate.
vi.mock("../db/drizzle", () => ({ db: {} }));
vi.mock("../db/schema", () => ({ projects: {} }));

vi.mock("./service", () => ({
  dispatchServerEvent: vi.fn(async () => ({
    eventId: "evt-stub",
    cursor: "00001",
    delivered: 1,
  })),
}));

vi.mock("../knowledge/knowledge", () => ({
  resolveKnowledgeBundlesForFactory: vi.fn(async () => []),
}));

import { publishFactoryRunRequest } from "./relay";
import { dispatchServerEvent } from "./service";
import { resolveKnowledgeBundlesForFactory } from "../knowledge/knowledge";

const dispatchMock = dispatchServerEvent as unknown as ReturnType<typeof vi.fn>;
const resolveMock = resolveKnowledgeBundlesForFactory as unknown as ReturnType<
  typeof vi.fn
>;

describe("publishFactoryRunRequest", () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    resolveMock.mockClear();
    resolveMock.mockResolvedValue([]);
    dispatchMock.mockResolvedValue({
      eventId: "evt-1",
      cursor: "00001",
      delivered: 1,
    });
  });

  test("dispatches a factory.run.request envelope with the expected payload", async () => {
    resolveMock.mockResolvedValueOnce([
      {
        objectId: "ko-1",
        filename: "prd.pdf",
        contentHash: "abc123",
        downloadUrl: "https://example.test/signed",
      },
    ]);

    const result = await publishFactoryRunRequest({
      orgId: "org-1",
      projectId: "p-1",
      pipelineId: "pl-1",
      adapter: "encore-react",
      actorUserId: "u-1",
      knowledgeObjectIds: ["ko-1"],
      businessDocs: [{ name: "extra.md", storageRef: "s3://x/y" }],
      policyBundleId: "pb-1",
    });

    expect(result).toEqual({
      eventId: "evt-1",
      cursor: "00001",
      delivered: 1,
    });

    expect(resolveMock).toHaveBeenCalledWith("p-1", ["ko-1"]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    const [orgId, envelope] = dispatchMock.mock.calls[0];
    expect(orgId).toBe("org-1");

    expect(envelope.kind).toBe("factory.run.request");
    expect(envelope.projectId).toBe("p-1");
    expect(envelope.pipelineId).toBe("pl-1");
    expect(envelope.adapter).toBe("encore-react");
    expect(envelope.actorUserId).toBe("u-1");
    expect(envelope.policyBundleId).toBe("pb-1");
    expect(envelope.businessDocs).toEqual([
      { name: "extra.md", storageRef: "s3://x/y" },
    ]);
    expect(envelope.knowledge).toEqual([
      {
        objectId: "ko-1",
        filename: "prd.pdf",
        contentHash: "abc123",
        downloadUrl: "https://example.test/signed",
      },
    ]);

    // Timestamps are ISO-8601 and `deadlineAt > requestedAt`.
    expect(typeof envelope.requestedAt).toBe("string");
    expect(typeof envelope.deadlineAt).toBe("string");
    expect(new Date(envelope.deadlineAt).getTime()).toBeGreaterThan(
      new Date(envelope.requestedAt).getTime(),
    );
  });

  test("dispatches with an empty knowledge array when no objects attached", async () => {
    await publishFactoryRunRequest({
      orgId: "org-2",
      projectId: "p-2",
      pipelineId: "pl-2",
      adapter: "rust-axum",
      actorUserId: "u-2",
      knowledgeObjectIds: [],
      businessDocs: [],
      policyBundleId: "pb-2",
    });

    expect(resolveMock).toHaveBeenCalledWith("p-2", []);
    const [, envelope] = dispatchMock.mock.calls[0];
    expect(envelope.knowledge).toEqual([]);
    expect(envelope.businessDocs).toEqual([]);
  });

  test("propagates errors from knowledge resolution without dispatching", async () => {
    resolveMock.mockRejectedValueOnce(new Error("knowledge object missing"));

    await expect(
      publishFactoryRunRequest({
        orgId: "org-3",
        projectId: "p-3",
        pipelineId: "pl-3",
        adapter: "next-prisma",
        actorUserId: "u-3",
        knowledgeObjectIds: ["bad-id"],
        businessDocs: [],
        policyBundleId: "pb-3",
      }),
    ).rejects.toThrow("knowledge object missing");

    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
