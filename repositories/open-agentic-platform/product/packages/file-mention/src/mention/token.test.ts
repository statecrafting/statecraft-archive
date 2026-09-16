import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createToken,
  tokenToText,
  parseTokensFromText,
  readFileAttachment,
  resolveMessage,
} from "./token.js";
import type { MentionToken, FileCandidate, AgentCandidate } from "../types.js";

describe("createToken", () => {
  it("creates file token (FR-006)", () => {
    const candidate: FileCandidate = {
      type: "file",
      relativePath: "src/app.ts",
      basename: "app.ts",
      icon: "📄",
    };
    const token = createToken(candidate);
    expect(token).toEqual({
      type: "file",
      displayText: "app.ts",
      resolvedValue: "src/app.ts",
    });
  });

  it("creates agent token (FR-007)", () => {
    const candidate: AgentCandidate = {
      type: "agent",
      agentId: "builder",
      displayName: "Builder Agent",
      avatar: "🤖",
    };
    const token = createToken(candidate);
    expect(token).toEqual({
      type: "agent",
      displayText: "Builder Agent",
      resolvedValue: "builder",
    });
  });
});

describe("tokenToText", () => {
  it("serializes token to [@displayText]", () => {
    const token: MentionToken = {
      type: "file",
      displayText: "app.ts",
      resolvedValue: "src/app.ts",
    };
    expect(tokenToText(token)).toBe("[@app.ts]");
  });
});

describe("parseTokensFromText", () => {
  it("finds known tokens in text", () => {
    const known: MentionToken[] = [
      { type: "file", displayText: "app.ts", resolvedValue: "src/app.ts" },
      { type: "agent", displayText: "Builder", resolvedValue: "builder" },
    ];
    const found = parseTokensFromText("Check [@app.ts] and ask [@Builder]", known);
    expect(found).toHaveLength(2);
    expect(found[0]!.displayText).toBe("app.ts");
    expect(found[1]!.displayText).toBe("Builder");
  });

  it("ignores unknown tokens", () => {
    const found = parseTokensFromText("[@unknown]", []);
    expect(found).toEqual([]);
  });

  it("returns empty for no tokens", () => {
    const found = parseTokensFromText("plain text", []);
    expect(found).toEqual([]);
  });
});

describe("readFileAttachment", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "opc-token-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads file content (FR-008)", async () => {
    await writeFile(join(root, "hello.txt"), "Hello World");
    const att = await readFileAttachment("hello.txt", root);
    expect(att.content).toBe("Hello World");
    expect(att.truncated).toBe(false);
    expect(att.relativePath).toBe("hello.txt");
  });

  it("truncates large files (R-003)", async () => {
    const big = "x".repeat(200 * 1024);
    await writeFile(join(root, "big.txt"), big);
    const att = await readFileAttachment("big.txt", root);
    expect(att.truncated).toBe(true);
    expect(att.content).toContain("truncated");
    expect(att.content.length).toBeLessThan(big.length);
  });

  it("handles missing file gracefully", async () => {
    const att = await readFileAttachment("nope.txt", root);
    expect(att.content).toContain("Error reading file");
    expect(att.truncated).toBe(false);
  });
});

describe("resolveMessage", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "opc-resolve-"));
    await writeFile(join(root, "app.ts"), "const x = 1;");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("attaches file content (SC-004)", async () => {
    const tokens: MentionToken[] = [
      { type: "file", displayText: "app.ts", resolvedValue: "app.ts" },
    ];
    const msg = await resolveMessage("Check [@app.ts]", tokens, root);
    expect(msg.fileAttachments).toHaveLength(1);
    expect(msg.fileAttachments[0]!.content).toBe("const x = 1;");
    expect(msg.targetAgentId).toBeUndefined();
  });

  it("routes to agent (SC-005)", async () => {
    const tokens: MentionToken[] = [
      { type: "agent", displayText: "Builder", resolvedValue: "builder" },
    ];
    const msg = await resolveMessage("[@Builder] help", tokens, root);
    expect(msg.targetAgentId).toBe("builder");
    expect(msg.fileAttachments).toEqual([]);
  });

  it("handles mixed tokens", async () => {
    const tokens: MentionToken[] = [
      { type: "file", displayText: "app.ts", resolvedValue: "app.ts" },
      { type: "agent", displayText: "Builder", resolvedValue: "builder" },
    ];
    const msg = await resolveMessage("[@app.ts] [@Builder]", tokens, root);
    expect(msg.fileAttachments).toHaveLength(1);
    expect(msg.targetAgentId).toBe("builder");
  });

  it("last agent wins when multiple", async () => {
    const tokens: MentionToken[] = [
      { type: "agent", displayText: "A", resolvedValue: "agent-a" },
      { type: "agent", displayText: "B", resolvedValue: "agent-b" },
    ];
    const msg = await resolveMessage("[@A] then [@B]", tokens, root);
    expect(msg.targetAgentId).toBe("agent-b");
  });
});
