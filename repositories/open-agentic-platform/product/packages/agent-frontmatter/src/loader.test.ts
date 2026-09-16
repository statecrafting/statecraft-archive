import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverMarkdownDefinitionFiles,
  listResourceRefsFromMetadata,
  loadResourceFile,
  loadTier1MetadataFromDir,
  loadTier2Instructions,
} from "./loader.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-frontmatter-"));
}

function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

describe("discoverMarkdownDefinitionFiles", () => {
  it("discovers markdown files recursively and sorts deterministically", () => {
    const dir = createTempDir();
    const a = path.join(dir, "a.md");
    const sub = path.join(dir, "sub");
    const b = path.join(sub, "b.md");
    writeFile(a, "# A");
    writeFile(b, "# B");

    const files = discoverMarkdownDefinitionFiles(dir);
    expect(files.length).toBe(2);
    expect(files[0] < files[1]).toBe(true);
  });
});

describe("Tier 1 & Tier 2 loaders", () => {
  it("loads Tier 1 metadata for files without holding bodies", () => {
    const dir = createTempDir();
    const agentPath = path.join(dir, "agent.md");
    writeFile(
      agentPath,
      `---
name: demo-agent
description: Demo.
tools:
  - Read
model: sonnet
---

# Instructions
`,
    );

    const entries = loadTier1MetadataFromDir(dir);
    expect(entries.length).toBe(1);
    const entry = entries[0];
    expect(entry.filePath).toBe(path.resolve(agentPath));
    expect(entry.metadata).not.toBeNull();
    expect(entry.metadata!.name).toBe("demo-agent");
    expect(entry.diagnostics).toHaveLength(0);
  });

  it("loads Tier 2 instructions body on demand for a single file", () => {
    const dir = createTempDir();
    const agentPath = path.join(dir, "agent.md");
    writeFile(
      agentPath,
      `---
name: demo-agent
description: Demo.
tools:
  - Read
model: sonnet
---

# Instructions
`,
    );

    const entry = loadTier2Instructions(agentPath);
    expect(entry.filePath).toBe(path.resolve(agentPath));
    expect(entry.metadata).not.toBeNull();
    expect(entry.body).not.toBeNull();
    expect(entry.body!.includes("# Instructions")).toBe(true);
  });
});

describe("Tier 3 resource hooks", () => {
  it("derives file resource refs from frontmatter resources field", () => {
    const dir = createTempDir();
    const defPath = path.join(dir, "agent.md");
    const resourcePath = "resources/example.txt";
    const resourceAbs = path.join(dir, resourcePath);
    writeFile(
      defPath,
      `---
name: demo-agent
description: Demo.
tools:
  - Read
model: sonnet
resources:
  - ${resourcePath}
---
`,
    );
    writeFile(resourceAbs, "hello");

    const tier2 = loadTier2Instructions(defPath);
    const refs = listResourceRefsFromMetadata(tier2.metadata, tier2.filePath);
    expect(refs.length).toBe(1);
    expect(refs[0].kind).toBe("file");
    expect(refs[0].path).toBe(path.resolve(resourceAbs));

    const contents = loadResourceFile(refs[0]);
    expect(contents).toBe("hello");
  });
});

