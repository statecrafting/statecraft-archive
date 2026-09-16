import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanFileTree,
  filesToCandidates,
  parseGitignorePatterns,
  loadGitignore,
} from "./scanner.js";

describe("parseGitignorePatterns", () => {
  it("matches simple filename patterns", () => {
    const matchers = parseGitignorePatterns("*.log\n");
    expect(matchers[0]!("debug.log")).toBe(true);
    expect(matchers[0]!("src/debug.log")).toBe(true);
    expect(matchers[0]!("debug.txt")).toBe(false);
  });

  it("matches directory patterns", () => {
    const matchers = parseGitignorePatterns("tmp/\n");
    expect(matchers[0]!("tmp")).toBe(true);
    expect(matchers[0]!("tmp/foo.txt")).toBe(true);
    expect(matchers[0]!("src/tmp")).toBe(true);
  });

  it("matches rooted patterns", () => {
    const matchers = parseGitignorePatterns("/build\n");
    expect(matchers[0]!("build")).toBe(true);
    expect(matchers[0]!("build/out.js")).toBe(true);
    expect(matchers[0]!("src/build")).toBe(false);
  });

  it("matches doublestar patterns", () => {
    const matchers = parseGitignorePatterns("**/test/**\n");
    expect(matchers[0]!("test/foo.ts")).toBe(true);
    expect(matchers[0]!("src/test/bar.ts")).toBe(true);
    expect(matchers[0]!("src/testing/bar.ts")).toBe(false);
  });

  it("skips comments and empty lines", () => {
    const matchers = parseGitignorePatterns("# comment\n\n*.log\n");
    expect(matchers).toHaveLength(1);
  });

  it("skips negation patterns", () => {
    const matchers = parseGitignorePatterns("!important.log\n");
    expect(matchers).toHaveLength(0);
  });
});

describe("scanFileTree", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "opc-scan-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns all files in a flat project", async () => {
    await writeFile(join(root, "a.ts"), "");
    await writeFile(join(root, "b.ts"), "");

    const files = await scanFileTree({ projectRoot: root });
    expect(files.sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("returns files in nested directories", async () => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "");

    const files = await scanFileTree({ projectRoot: root });
    expect(files).toContain("src/app.ts");
  });

  it("excludes node_modules", async () => {
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "");
    await writeFile(join(root, "app.ts"), "");

    const files = await scanFileTree({ projectRoot: root });
    expect(files).toEqual(["app.ts"]);
  });

  it("excludes .git directory", async () => {
    await mkdir(join(root, ".git", "objects"), { recursive: true });
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main");
    await writeFile(join(root, "app.ts"), "");

    const files = await scanFileTree({ projectRoot: root });
    expect(files).toEqual(["app.ts"]);
  });

  it("respects .gitignore patterns", async () => {
    await writeFile(join(root, ".gitignore"), "*.log\nsecret/\n");
    await mkdir(join(root, "secret"), { recursive: true });
    await writeFile(join(root, "secret", "key.pem"), "");
    await writeFile(join(root, "debug.log"), "");
    await writeFile(join(root, "app.ts"), "");

    const files = await scanFileTree({ projectRoot: root });
    expect(files.sort()).toEqual([".gitignore", "app.ts"]);
  });

  it("respects extraIgnore patterns", async () => {
    await writeFile(join(root, "temp.bak"), "");
    await writeFile(join(root, "app.ts"), "");

    const files = await scanFileTree({
      projectRoot: root,
      extraIgnore: ["*.bak"],
    });
    expect(files).toEqual(["app.ts"]);
  });

  it("caps at maxFiles", async () => {
    for (let i = 0; i < 10; i++) {
      await writeFile(join(root, `file${i}.ts`), "");
    }

    const files = await scanFileTree({ projectRoot: root, maxFiles: 5 });
    expect(files.length).toBeLessThanOrEqual(5);
  });

  it("handles missing .gitignore gracefully", async () => {
    await writeFile(join(root, "app.ts"), "");
    const files = await scanFileTree({ projectRoot: root });
    expect(files).toEqual(["app.ts"]);
  });

  it("handles empty project", async () => {
    const files = await scanFileTree({ projectRoot: root });
    expect(files).toEqual([]);
  });
});

describe("loadGitignore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "opc-gitignore-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads patterns from .gitignore", async () => {
    await writeFile(join(root, ".gitignore"), "*.log\n");
    const matchers = await loadGitignore(root);
    expect(matchers).toHaveLength(1);
    expect(matchers[0]!("test.log")).toBe(true);
  });

  it("returns empty array when no .gitignore", async () => {
    const matchers = await loadGitignore(root);
    expect(matchers).toEqual([]);
  });
});

describe("filesToCandidates", () => {
  it("converts paths to FileCandidate objects", () => {
    const candidates = filesToCandidates(["src/app.ts", "README.md"]);
    expect(candidates).toEqual([
      { type: "file", relativePath: "src/app.ts", basename: "app.ts", icon: "📄" },
      { type: "file", relativePath: "README.md", basename: "README.md", icon: "📝" },
    ]);
  });

  it("assigns correct icons by extension", () => {
    const candidates = filesToCandidates([
      "a.tsx",
      "b.rs",
      "c.py",
      "d.json",
      "e.css",
      "f.unknown",
    ]);
    expect(candidates.map((c) => c.icon)).toEqual(["⚛️", "🦀", "🐍", "📋", "🎨", "📄"]);
  });

  it("handles files with no extension", () => {
    const candidates = filesToCandidates(["Makefile"]);
    expect(candidates[0]!.icon).toBe("📄");
    expect(candidates[0]!.basename).toBe("Makefile");
  });
});
