import { describe, expect, it } from "vitest";
import { evaluate } from "./engine.js";
import type { Rule } from "./types.js";

function makeBenchRules(n: number): Rule[] {
  const rules: Rule[] = [];
  for (let i = 0; i < n; i++) {
    rules.push({
      id: `bench-${i}`,
      event: "PreToolUse",
      matcher: { tool: "Bash" },
      conditions: { all: [{ field: "input.command", "==": "x" }] },
      action: { type: "warn" },
      priority: i,
      rationale: "bench",
      sourcePath: `/bench/${i}.md`,
    });
  }
  return rules;
}

describe("NF-001 evaluation latency", () => {
  it("stays under 10ms p99 for one event with 100 loaded rules (warn chain)", () => {
    const rules = makeBenchRules(100);
    const event = {
      type: "PreToolUse" as const,
      payload: {
        tool: "Bash",
        input: { command: "x" },
      },
    };

    for (let w = 0; w < 50; w++) {
      evaluate({ rules, event });
    }

    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      evaluate({ rules, event });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(0.99 * (samples.length - 1))];

    expect(p99).toBeLessThan(10);
  });
});
