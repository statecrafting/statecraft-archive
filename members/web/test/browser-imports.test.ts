// Spec 128 D-16: the web UI loads in a browser only if nothing its bundle
// reaches imports a Node or Bun built-in. The component tests cannot see that,
// because they run under Bun with every built-in present; this happened twice
// (a load-time `path.join`, then Vite's dev server refusing `fs`, `path` and
// `crypto` reached through the client's policy import) and neither was caught
// until a real browser loaded the page.
//
// So this walks the run-time import graph from the page's entry point, the way
// a bundler would, and fails on the first built-in it reaches. An `import type`
// or `export type` is erased and is not an edge; every other import is, even
// one whose named bindings are all types, because `verbatimModuleSyntax` keeps
// such an import in place.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { builtinModules } from "module";
import { dirname, join, relative, resolve } from "path";

const WEB = join(import.meta.dir, "..");
const MEMBERS = join(WEB, "..");
const ENTRY = join(WEB, "src", "main.tsx");
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const IMPORT_PATTERN = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;

function isBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun") return true;
  return builtinModules.includes(specifier.split("/")[0]!);
}

function resolveSource(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

interface Reach {
  readonly visited: readonly string[];
  readonly builtins: readonly string[];
}

// Every module reachable at run time from `entry`, and each built-in reached,
// with the import chain that reaches it.
function walk(entry: string): Reach {
  const visited = new Set<string>();
  const builtins: string[] = [];
  const queue: { file: string; chain: readonly string[] }[] = [{ file: entry, chain: [] }];
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const here = [...chain, relative(MEMBERS, file)];
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
      if (match[2] !== undefined) continue;
      const specifier = match[3]!;
      if (isBuiltin(specifier)) builtins.push(`${here.join(" -> ")} -> ${specifier}`);
      else if (specifier.startsWith(".")) {
        const next = resolveSource(file, specifier);
        if (next !== null) queue.push({ file: next, chain: here });
      }
    }
  }
  return { visited: [...visited].map((file) => relative(MEMBERS, file)), builtins };
}

test("128 D-16: nothing the web UI's bundle reaches imports a Node or Bun built-in", () => {
  const reach = walk(ENTRY);
  // The walk crossed into the engine's source, through the client and its
  // policy payload, so an empty list below is a finding and not a short walk.
  expect(reach.visited).toContain("src/orchestrator/api/api-client.ts");
  expect(reach.visited).toContain("src/orchestrator/policy-payload.ts");
  expect(reach.builtins).toEqual([]);
});

test("128 D-16: the walk reports a built-in it reaches, with the chain that reaches it", () => {
  // The control: the module the client used to import its payload builder from.
  const reach = walk(join(MEMBERS, "src", "orchestrator", "lifecycle-policy.ts"));
  expect(reach.builtins).toContain("src/orchestrator/lifecycle-policy.ts -> fs");
  expect(reach.builtins.some((line) => line.endsWith("src/orchestrator/journal.ts -> crypto"))).toBe(true);
});
