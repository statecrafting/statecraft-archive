#!/usr/bin/env node
import path from "node:path";
import { formatLintSummary, lintDefinitionsInDir } from "./linter.js";

type CliKind = "agent" | "skill" | "auto";

function parseArgs(argv: string[]): { rootDir: string; kind: CliKind } {
  let rootDir = ".";
  let kind: CliKind = "auto";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--kind") {
      const value = argv[i + 1];
      if (value === "agent" || value === "skill" || value === "auto") {
        kind = value;
        i += 1;
        continue;
      }
      throw new Error(`Invalid --kind value '${value}'. Expected agent|skill|auto.`);
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    rootDir = arg;
  }

  return { rootDir: path.resolve(rootDir), kind };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log("Usage: agent-frontmatter-lint [rootDir] [--kind agent|skill|auto]");
}

function main(): number {
  try {
    const { rootDir, kind } = parseArgs(process.argv.slice(2));
    const summary = lintDefinitionsInDir(rootDir, { kind });
    // eslint-disable-next-line no-console
    console.log(formatLintSummary(summary));
    return summary.ok ? 0 : 1;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      error instanceof Error ? error.message : "Unknown error while running linter.",
    );
    return 2;
  }
}

process.exit(main());
