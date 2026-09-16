import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createPermissionStore } from "./store";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("permission store", () => {
  test("resolves project and global scope paths correctly", async () => {
    const projectRoot = await makeTempDir("perm-store-project-");
    const homeDir = await makeTempDir("perm-store-home-");
    const store = createPermissionStore({ projectRoot, homeDir });

    await store.upsert({
      tool: "Read",
      pattern: "Read(/tmp/**)",
      decision: "allow",
      scope: "project",
    });
    await store.upsert({
      tool: "Bash",
      pattern: "Bash(git:status)",
      decision: "allow",
      scope: "global",
    });

    const projectPath = path.join(projectRoot, ".claude", "permissions.json");
    const globalPath = path.join(homeDir, ".claude", "permissions.json");
    expect(await fs.stat(projectPath)).toBeTruthy();
    expect(await fs.stat(globalPath)).toBeTruthy();
  });

  test("create-on-first-write creates schema v1 pretty JSON", async () => {
    const projectRoot = await makeTempDir("perm-store-first-write-project-");
    const homeDir = await makeTempDir("perm-store-first-write-home-");
    const store = createPermissionStore({ projectRoot, homeDir });

    await store.upsert({
      tool: "Read",
      pattern: "Read(/repo/**)",
      decision: "allow",
      scope: "project",
    });

    const projectPath = path.join(projectRoot, ".claude", "permissions.json");
    const content = await fs.readFile(projectPath, "utf8");
    expect(content).toContain('\n  "version": 1,');
    expect(content.endsWith("\n")).toBe(true);
    expect(JSON.parse(content)).toMatchObject({
      version: 1,
      entries: [
        {
          tool: "Read",
          pattern: "Read(/repo/**)",
          decision: "allow",
          scope: "project",
        },
      ],
    });
  });

  test("revoke removes entries by exact pattern across scopes", async () => {
    const projectRoot = await makeTempDir("perm-store-revoke-project-");
    const homeDir = await makeTempDir("perm-store-revoke-home-");
    const store = createPermissionStore({ projectRoot, homeDir });

    await store.upsert({
      tool: "Bash",
      pattern: "Bash(git:commit:*)",
      decision: "allow",
      scope: "project",
    });
    await store.upsert({
      tool: "Bash",
      pattern: "Bash(git:commit:*)",
      decision: "allow",
      scope: "global",
    });
    await store.upsert({
      tool: "Bash",
      pattern: "Bash(git:status)",
      decision: "allow",
      scope: "project",
    });

    const removed = await store.revoke("Bash(git:commit:*)");
    expect(removed).toBe(2);

    const remaining = await store.list();
    expect(remaining.map((entry) => entry.pattern)).toEqual(["Bash(git:status)"]);
  });

  test("clearExpired removes expired entries while retaining active", async () => {
    const projectRoot = await makeTempDir("perm-store-expired-project-");
    const homeDir = await makeTempDir("perm-store-expired-home-");
    const store = createPermissionStore({ projectRoot, homeDir });

    await store.upsert({
      tool: "Read",
      pattern: "Read(/expired/**)",
      decision: "allow",
      scope: "project",
      expiresAt: "2026-03-01T00:00:00.000Z",
    });
    await store.upsert({
      tool: "Read",
      pattern: "Read(/active/**)",
      decision: "allow",
      scope: "project",
      expiresAt: "2026-12-01T00:00:00.000Z",
    });

    const removed = await store.clearExpired("2026-06-01T00:00:00.000Z", "project");
    expect(removed).toBe(1);

    const remaining = await store.list("project");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].pattern).toBe("Read(/active/**)");
  });

  test("round-trips hand-edited JSON documents", async () => {
    const projectRoot = await makeTempDir("perm-store-roundtrip-project-");
    const homeDir = await makeTempDir("perm-store-roundtrip-home-");
    const projectPath = path.join(projectRoot, ".claude", "permissions.json");
    await fs.mkdir(path.dirname(projectPath), { recursive: true });

    await fs.writeFile(
      projectPath,
      `{
  "version": 1,
  "entries": [
    {
      "id": "manual-1",
      "tool": "Read",
      "pattern": "Read(/Users/me/**)",
      "decision": "allow",
      "scope": "project",
      "createdAt": "2026-03-31T12:00:00.000Z",
      "expiresAt": null
    }
  ]
}
`,
      "utf8",
    );

    const store = createPermissionStore({ projectRoot, homeDir });
    const listed = await store.list("project");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: "manual-1",
      pattern: "Read(/Users/me/**)",
    });

    await store.upsert({
      tool: "Bash",
      pattern: "Bash(git:status)",
      decision: "allow",
      scope: "project",
    });

    const persisted = JSON.parse(await fs.readFile(projectPath, "utf8"));
    expect(persisted.version).toBe(1);
    expect(Array.isArray(persisted.entries)).toBe(true);
    expect(persisted.entries).toHaveLength(2);
  });
});

