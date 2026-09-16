import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listCandidates, promoteCandidate, rejectCandidate } from "./review.js";
import { parse } from "yaml";

/** Minimal valid candidate YAML. */
function candidateYaml(overrides: Record<string, unknown> = {}): string {
  const defaults: Record<string, unknown> = {
    id: "security-001",
    category: "security",
    priority: "high",
    status: "candidate",
    rules: [
      { verb: "NEVER", subject: "hardcode secrets", rationale: "security risk" },
    ],
    ...overrides,
  };
  // Simple YAML serialization
  const lines: string[] = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (key === "rules" || key === "anti_patterns" || key === "examples") {
      lines.push(`${key}:`);
      for (const item of value as Record<string, unknown>[]) {
        const entries = Object.entries(item);
        lines.push(`  - ${entries[0][0]}: ${JSON.stringify(entries[0][1])}`);
        for (const [k, v] of entries.slice(1)) {
          lines.push(`    ${k}: ${JSON.stringify(v)}`);
        }
      }
    } else if (key === "tags" && Array.isArray(value)) {
      lines.push(`tags:`);
      for (const t of value) lines.push(`  - ${JSON.stringify(t)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n") + "\n";
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "css-review-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("listCandidates", () => {
  it("returns empty when candidates directory does not exist", async () => {
    const result = await listCandidates(tmpDir);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("lists candidate standards from candidates directory", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "security-001.yaml"), candidateYaml());
    await writeFile(
      join(dir, "naming-001.yaml"),
      candidateYaml({ id: "naming-001", category: "naming", priority: "medium" }),
    );

    const result = await listCandidates(tmpDir);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.standard.id).sort()).toEqual([
      "naming-001",
      "security-001",
    ]);
  });

  it("skips files with non-candidate status", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "active-one.yaml"),
      candidateYaml({ id: "active-one", status: "active" }),
    );
    await writeFile(join(dir, "candidate-one.yaml"), candidateYaml({ id: "candidate-one" }));

    const result = await listCandidates(tmpDir);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].standard.id).toBe("candidate-one");
    expect(result.diagnostics.some((d) => d.code === "CS_NOT_CANDIDATE")).toBe(true);
  });

  it("reports diagnostics for invalid YAML files", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "bad.yaml"), "{ invalid yaml [[[");

    const result = await listCandidates(tmpDir);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("ignores non-yaml files", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "readme.md"), "# Not a standard");
    await writeFile(join(dir, "security-001.yaml"), candidateYaml());

    const result = await listCandidates(tmpDir);
    expect(result.candidates).toHaveLength(1);
  });

  it("returns candidates sorted by filename", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "z-last.yaml"), candidateYaml({ id: "z-last" }));
    await writeFile(join(dir, "a-first.yaml"), candidateYaml({ id: "a-first" }));

    const result = await listCandidates(tmpDir);
    expect(result.candidates[0].fileName).toBe("a-first.yaml");
    expect(result.candidates[1].fileName).toBe("z-last.yaml");
  });

  it("includes filePath and fileName on each entry", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "test-001.yaml"), candidateYaml({ id: "test-001" }));

    const result = await listCandidates(tmpDir);
    expect(result.candidates[0].filePath).toBe(join(dir, "test-001.yaml"));
    expect(result.candidates[0].fileName).toBe("test-001.yaml");
  });
});

describe("promoteCandidate", () => {
  it("promotes a candidate to active in target tier", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "security-001.yaml"), candidateYaml());

    const result = await promoteCandidate("security-001", "local", tmpDir);
    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(join(tmpDir, "standards", "local", "security-001.yaml"));

    // Verify promoted file exists with active status
    const content = await readFile(result.outputPath!, "utf-8");
    const parsed = parse(content);
    expect(parsed.status).toBe("active");
    expect(parsed.id).toBe("security-001");
  });

  it("removes the candidate file after promotion", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    const candidatePath = join(dir, "security-001.yaml");
    await writeFile(candidatePath, candidateYaml());

    await promoteCandidate("security-001", "local", tmpDir);

    // Candidate file should be removed
    await expect(readFile(candidatePath, "utf-8")).rejects.toThrow();
  });

  it("creates target tier directory if it does not exist", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "security-001.yaml"), candidateYaml());

    const result = await promoteCandidate("security-001", "community", tmpDir);
    expect(result.success).toBe(true);

    const content = await readFile(
      join(tmpDir, "standards", "community", "security-001.yaml"),
      "utf-8",
    );
    expect(parse(content).status).toBe("active");
  });

  it("applies edits during promotion", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "security-001.yaml"), candidateYaml());

    const result = await promoteCandidate("security-001", "local", tmpDir, {
      priority: "critical",
      context: "Updated context for production use",
      tags: ["typescript", "security"],
    });
    expect(result.success).toBe(true);

    const content = await readFile(result.outputPath!, "utf-8");
    const parsed = parse(content);
    expect(parsed.priority).toBe("critical");
    expect(parsed.context).toBe("Updated context for production use");
    expect(parsed.tags).toEqual(["typescript", "security"]);
    expect(parsed.status).toBe("active");
  });

  it("applies rule edits during promotion", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "security-001.yaml"), candidateYaml());

    const newRules = [
      { verb: "NEVER" as const, subject: "store plaintext passwords", rationale: "use bcrypt" },
      { verb: "ALWAYS" as const, subject: "hash credentials", rationale: "security baseline" },
    ];
    const result = await promoteCandidate("security-001", "local", tmpDir, {
      rules: newRules,
    });
    expect(result.success).toBe(true);

    const content = await readFile(result.outputPath!, "utf-8");
    const parsed = parse(content);
    expect(parsed.rules).toHaveLength(2);
    expect(parsed.rules[0].subject).toBe("store plaintext passwords");
  });

  it("fails when candidate id not found", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });

    const result = await promoteCandidate("nonexistent", "local", tmpDir);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "CS_CANDIDATE_NOT_FOUND")).toBe(true);
  });

  it("can promote to official tier", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "security-001.yaml"), candidateYaml());

    const result = await promoteCandidate("security-001", "official", tmpDir);
    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(
      join(tmpDir, "standards", "official", "security-001.yaml"),
    );
  });
});

describe("rejectCandidate", () => {
  it("marks a candidate as rejected", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "security-001.yaml");
    await writeFile(filePath, candidateYaml());

    const result = await rejectCandidate("security-001", tmpDir);
    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(filePath);

    // Verify file now has rejected status
    const content = await readFile(filePath, "utf-8");
    const parsed = parse(content);
    expect(parsed.status).toBe("rejected");
    expect(parsed.id).toBe("security-001");
  });

  it("preserves all other fields when rejecting", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "security-001.yaml"),
      candidateYaml({
        tags: ["typescript"],
        anti_patterns: [{ pattern: "eval(input)", correction: "parseExpression(input)" }],
      }),
    );

    const result = await rejectCandidate("security-001", tmpDir);
    expect(result.success).toBe(true);

    const content = await readFile(result.outputPath!, "utf-8");
    const parsed = parse(content);
    expect(parsed.status).toBe("rejected");
    expect(parsed.tags).toEqual(["typescript"]);
    expect(parsed.anti_patterns).toHaveLength(1);
    expect(parsed.rules).toHaveLength(1);
  });

  it("fails when candidate id not found", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });

    const result = await rejectCandidate("nonexistent", tmpDir);
    expect(result.success).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "CS_CANDIDATE_NOT_FOUND")).toBe(true);
  });

  it("rejected candidates are excluded from subsequent listCandidates", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "security-001.yaml"), candidateYaml());
    await writeFile(
      join(dir, "naming-001.yaml"),
      candidateYaml({ id: "naming-001", category: "naming" }),
    );

    // Reject one
    await rejectCandidate("security-001", tmpDir);

    // List should only return the non-rejected one
    const result = await listCandidates(tmpDir);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].standard.id).toBe("naming-001");
  });
});

describe("end-to-end workflow", () => {
  it("list → promote → verify in tier", async () => {
    const candidatesDir = join(tmpDir, "standards", "candidates");
    await mkdir(candidatesDir, { recursive: true });
    await writeFile(join(candidatesDir, "arch-001.yaml"), candidateYaml({
      id: "arch-001",
      category: "architecture",
      priority: "medium",
    }));
    await writeFile(join(candidatesDir, "sec-001.yaml"), candidateYaml({
      id: "sec-001",
      category: "security",
      priority: "high",
    }));

    // List
    const listed = await listCandidates(tmpDir);
    expect(listed.candidates).toHaveLength(2);

    // Promote one
    const promoted = await promoteCandidate("arch-001", "local", tmpDir, {
      priority: "high",
    });
    expect(promoted.success).toBe(true);

    // Reject one
    const rejected = await rejectCandidate("sec-001", tmpDir);
    expect(rejected.success).toBe(true);

    // List again — should be empty
    const afterReview = await listCandidates(tmpDir);
    expect(afterReview.candidates).toHaveLength(0);

    // Verify promoted file in local tier
    const content = await readFile(
      join(tmpDir, "standards", "local", "arch-001.yaml"),
      "utf-8",
    );
    const parsed = parse(content);
    expect(parsed.status).toBe("active");
    expect(parsed.priority).toBe("high");
  });

  it("yml extension is supported", async () => {
    const dir = join(tmpDir, "standards", "candidates");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "test-001.yml"), candidateYaml({ id: "test-001" }));

    const result = await listCandidates(tmpDir);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].fileName).toBe("test-001.yml");
  });
});
