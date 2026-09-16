import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_PRESERVE_RECENT_TURNS,
  MAX_COMPACTION_THRESHOLD,
  MIN_COMPACTION_THRESHOLD,
  ProgrammaticCompactor,
  TokenBudgetMonitor,
  elevateSessionContextForInit,
  getContextWindowTokensForModel,
  readCompactionThresholdFromEnv,
  rewriteSessionHistoryForCompaction,
  resolveContextCompactionConfig,
  stableSerializeHistory,
  type CompactionHistory,
  type CompactionMessage,
  type GitSnapshot,
} from "./contextCompaction";

describe("context compaction config", () => {
  it("uses defaults when env and config are unset", () => {
    const config = resolveContextCompactionConfig(undefined, {});
    expect(config).toEqual({
      threshold: DEFAULT_COMPACTION_THRESHOLD,
      preserveRecentTurns: DEFAULT_PRESERVE_RECENT_TURNS,
    });
  });

  it("prefers environment threshold over config threshold", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { threshold: 0.6 } },
      { OAP_COMPACTION_THRESHOLD: "0.9" },
    );
    expect(config.threshold).toBe(0.9);
  });

  it("uses config threshold when environment threshold is missing", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { threshold: 0.65, preserve_recent_turns: 8 } },
      {},
    );
    expect(config.threshold).toBe(0.65);
    expect(config.preserveRecentTurns).toBe(8);
  });

  it("falls back to default when env threshold is invalid", () => {
    const config = resolveContextCompactionConfig(
      undefined,
      { OAP_COMPACTION_THRESHOLD: "not-a-number" },
    );
    expect(config.threshold).toBe(DEFAULT_COMPACTION_THRESHOLD);
  });

  it("accepts threshold boundaries", () => {
    const min = resolveContextCompactionConfig(
      { compaction: { threshold: MIN_COMPACTION_THRESHOLD } },
      {},
    );
    const max = resolveContextCompactionConfig(
      { compaction: { threshold: MAX_COMPACTION_THRESHOLD } },
      {},
    );
    expect(min.threshold).toBe(MIN_COMPACTION_THRESHOLD);
    expect(max.threshold).toBe(MAX_COMPACTION_THRESHOLD);
  });

  it("rejects threshold values outside accepted range", () => {
    const tooLow = resolveContextCompactionConfig(
      { compaction: { threshold: MIN_COMPACTION_THRESHOLD - 0.01 } },
      {},
    );
    const tooHigh = resolveContextCompactionConfig(
      { compaction: { threshold: MAX_COMPACTION_THRESHOLD + 0.01 } },
      {},
    );
    expect(tooLow.threshold).toBe(DEFAULT_COMPACTION_THRESHOLD);
    expect(tooHigh.threshold).toBe(DEFAULT_COMPACTION_THRESHOLD);
  });

  it("normalizes preserve_recent_turns when invalid", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 0 } },
      {},
    );
    expect(config.preserveRecentTurns).toBe(DEFAULT_PRESERVE_RECENT_TURNS);
  });
});

describe("readCompactionThresholdFromEnv", () => {
  it("returns undefined for missing or invalid values", () => {
    expect(readCompactionThresholdFromEnv({})).toBeUndefined();
    expect(
      readCompactionThresholdFromEnv({ OAP_COMPACTION_THRESHOLD: "" }),
    ).toBeUndefined();
    expect(
      readCompactionThresholdFromEnv({ OAP_COMPACTION_THRESHOLD: "abc" }),
    ).toBeUndefined();
    expect(
      readCompactionThresholdFromEnv({ OAP_COMPACTION_THRESHOLD: "0.3" }),
    ).toBeUndefined();
  });

  it("returns parsed threshold when value is valid", () => {
    expect(
      readCompactionThresholdFromEnv({ OAP_COMPACTION_THRESHOLD: "0.95" }),
    ).toBe(0.95);
  });
});

describe("stableSerializeHistory", () => {
  it("serializes equivalent history deterministically", () => {
    const historyA: CompactionHistory = {
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "Implement context compaction",
          meta: { z: "last", a: "first" },
        },
      ],
    };
    const historyB: CompactionHistory = {
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "Implement context compaction",
          meta: { a: "first", z: "last" },
        },
      ],
    };

    expect(stableSerializeHistory(historyA)).toBe(stableSerializeHistory(historyB));
  });
});

describe("TokenBudgetMonitor", () => {
  it("does not trigger compaction below threshold", () => {
    const config = resolveContextCompactionConfig(undefined, {});
    const monitor = new TokenBudgetMonitor(config);
    monitor.reportUsage(200, 100);
    const decision = monitor.shouldCompact(1000);

    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("< threshold");
    expect(decision.usedTokens).toBe(300);
  });

  it("triggers compaction at threshold boundary", () => {
    const config = resolveContextCompactionConfig(undefined, {});
    const monitor = new TokenBudgetMonitor(config);
    monitor.reportUsage(500, 250);
    const decision = monitor.shouldCompact(1000);

    expect(decision.shouldCompact).toBe(true);
    expect(decision.reason).toContain(">= threshold");
    expect(decision.usageRatio).toBe(0.75);
  });

  it("triggers compaction above threshold", () => {
    const config = resolveContextCompactionConfig(undefined, {});
    const monitor = new TokenBudgetMonitor(config);
    monitor.reportUsage(600, 200);
    const decision = monitor.shouldCompact(1000);

    expect(decision.shouldCompact).toBe(true);
    expect(decision.reason).toContain("800/1000");
  });

  it("respects 0.5 threshold override for earlier compaction", () => {
    const config = resolveContextCompactionConfig(undefined, {
      OAP_COMPACTION_THRESHOLD: "0.5",
    });
    const monitor = new TokenBudgetMonitor(config);
    monitor.reportUsage(300, 220);
    const decision = monitor.shouldCompact(1000);

    expect(config.threshold).toBe(0.5);
    expect(decision.shouldCompact).toBe(true);
  });

  it("respects 0.95 threshold override for later compaction", () => {
    const config = resolveContextCompactionConfig(undefined, {
      OAP_COMPACTION_THRESHOLD: "0.95",
    });
    const monitor = new TokenBudgetMonitor(config);
    monitor.reportUsage(500, 400);
    const decision = monitor.shouldCompact(1000);

    expect(config.threshold).toBe(0.95);
    expect(decision.shouldCompact).toBe(false);
    monitor.reportUsage(40, 20);
    expect(monitor.shouldCompact(1000).shouldCompact).toBe(true);
  });

  it("resets token baseline after compaction rewrite", () => {
    const monitor = new TokenBudgetMonitor(resolveContextCompactionConfig(undefined, {}));
    monitor.reportUsage(700, 100);
    expect(monitor.shouldCompact(1000).shouldCompact).toBe(true);
    monitor.resetTo(150, 0);
    expect(monitor.shouldCompact(1000).shouldCompact).toBe(false);
  });
});

describe("ProgrammaticCompactor", () => {
  const gitSnapshot: GitSnapshot = {
    branch: "main",
    stagedChanges: 1,
    unstagedChanges: 2,
    lastCommitHash: "abc1234",
    lastCommitMessage: "feat: baseline compaction",
    diffStats: {
      insertions: 42,
      deletions: 7,
      filesChanged: 3,
    },
  };

  it("builds deterministic session_context xml with required sections", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 2 } },
      {},
    );
    const compactor = new ProgrammaticCompactor(config);
    const history: CompactionHistory = {
      messages: [
        {
          id: "m-1",
          role: "system",
          content: "You are a coding assistant.",
          usage: { input_tokens: 100, output_tokens: 0 },
        },
        {
          id: "m-2",
          role: "user",
          content: "Implement context compaction for session resumption.",
          usage: { input_tokens: 20, output_tokens: 5 },
        },
        {
          id: "m-3",
          role: "assistant",
          content:
            "- [x] Added TokenBudgetMonitor\n- [ ] Build ProgrammaticCompactor\nDecision: Use deterministic XML output.",
          usage: { input_tokens: 30, output_tokens: 40 },
        },
        {
          id: "m-4",
          role: "assistant",
          content:
            "Created apps/desktop/src/lib/contextCompaction.ts and modified apps/desktop/src/lib/contextCompaction.test.ts",
        },
        {
          id: "m-5",
          role: "assistant",
          content: "Next step: implement interruption detection?",
        },
      ],
    };

    const fixedCompactedAt = new Date(0);
    const outputA = compactor.compact(history, gitSnapshot, fixedCompactedAt);
    const outputB = compactor.compact(history, gitSnapshot, fixedCompactedAt);

    expect(outputA.sessionContextBlock).toBe(outputB.sessionContextBlock);
    expect(outputA.sessionContextBlock).toContain("<session_context");
    expect(outputA.sessionContextBlock).toContain("<task_summary>");
    expect(outputA.sessionContextBlock).toContain("<completed_steps>");
    expect(outputA.sessionContextBlock).toContain("<pending_steps>");
    expect(outputA.sessionContextBlock).toContain("<file_modifications>");
    expect(outputA.sessionContextBlock).toContain("<git_state>");
    expect(outputA.sessionContextBlock).toContain("<key_decisions>");
    expect(outputA.sessionContextBlock).toContain("<interruption detected=\"true\">");
  });

  it("omits interruption section when no interruption signal exists", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 1 } },
      {},
    );
    const compactor = new ProgrammaticCompactor(config);
    const cleanGit: GitSnapshot = {
      ...gitSnapshot,
      stagedChanges: 0,
      unstagedChanges: 0,
    };
    const history: CompactionHistory = {
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "Add docs improvements",
        },
        {
          id: "m-2",
          role: "assistant",
          content: "All requested docs updates are complete.",
        },
      ],
    };

    const output = compactor.compact(history, cleanGit);
    expect(output.sessionContextBlock).not.toContain("<interruption");
    expect(output.interruption).toBeNull();
  });

  it("preserves pinned messages and recent turns byte-identically", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 2 } },
      {},
    );
    const compactor = new ProgrammaticCompactor(config);
    const history: CompactionHistory = {
      messages: [
        {
          id: "m-1",
          role: "system",
          content: "System prompt",
        },
        {
          id: "m-2",
          role: "user",
          content: "Older context",
        },
        {
          id: "m-3",
          role: "assistant",
          content: "Pinned and important",
          pinned: true,
        },
        {
          id: "m-4",
          role: "user",
          content: "Recent user turn A",
        },
        {
          id: "m-5",
          role: "assistant",
          content: "Recent assistant turn A",
        },
        {
          id: "m-6",
          role: "assistant",
          content: "Tool prelude within same turn",
        },
        {
          id: "m-7",
          role: "user",
          content: "Recent user turn B",
        },
        {
          id: "m-8",
          role: "assistant",
          content: "Recent assistant turn B",
        },
      ],
    };

    const output = compactor.compact(history, { ...gitSnapshot, stagedChanges: 0, unstagedChanges: 0 });
    const preservedIds = output.preservedMessages.map((message) => message.id);

    expect(preservedIds).toEqual(["m-1", "m-3", "m-4", "m-5", "m-6", "m-7", "m-8"]);
    expect(output.preservedMessages[1]?.content).toBe("Pinned and important");
    expect(output.preservedMessages[5]?.content).toBe("Recent user turn B");
  });

  it("preserves only active-operation tool messages", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 1 } },
      {},
    );
    const compactor = new ProgrammaticCompactor(config);
    const history: CompactionHistory = {
      messages: [
        {
          id: "m-1",
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-old", name: "read_file" }],
        },
        {
          id: "m-2",
          role: "tool",
          content: "old result",
          tool_call_id: "tool-old",
        },
        {
          id: "m-3",
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-active", name: "edit_file" }],
        },
        {
          id: "m-4",
          role: "user",
          content: "continue",
        },
      ],
    };

    const output = compactor.compact(history, { ...gitSnapshot, stagedChanges: 0, unstagedChanges: 0 });
    const preservedIds = output.preservedMessages.map((message) => message.id);
    expect(preservedIds).toContain("m-3");
    expect(preservedIds).not.toContain("m-2");
  });

  it("emits interruption for true-positive multi-signal case", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 1 } },
      {},
    );
    const compactor = new ProgrammaticCompactor(config);
    const history: CompactionHistory = {
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "Ship this change",
        },
        {
          id: "m-2",
          role: "assistant",
          content: "Do the next step now?",
        },
      ],
    };

    const output = compactor.compact(history, { ...gitSnapshot, stagedChanges: 1, unstagedChanges: 0 });
    expect(output.interruption).not.toBeNull();
    expect(output.sessionContextBlock).toContain("<interruption detected=\"true\">");
  });

  it("does not emit interruption for false-positive single-signal case", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 1 } },
      {},
    );
    const compactor = new ProgrammaticCompactor(config);
    const history: CompactionHistory = {
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "Implement docs improvements",
        },
        {
          id: "m-2",
          role: "assistant",
          content: "- [ ] update README",
        },
      ],
    };

    const output = compactor.compact(history, { ...gitSnapshot, stagedChanges: 0, unstagedChanges: 0 });
    expect(output.interruption).toBeNull();
    expect(output.sessionContextBlock).not.toContain("<interruption");
  });
});

describe("Phase 5 integration", () => {
  const gitSnapshot: GitSnapshot = {
    branch: "main",
    stagedChanges: 0,
    unstagedChanges: 0,
    lastCommitHash: "abc1234",
    lastCommitMessage: "feat: baseline compaction",
    diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
  };

  it("compacts runtime history above 75% and keeps output under 40%", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 1 } },
      {},
    );
    const rawMessages = [
      {
        type: "system",
        message: { content: [{ type: "text", text: "System policy" }] },
      },
      {
        type: "user",
        message: { content: [{ type: "text", text: "Implement feature 046 <!-- pin -->" }] },
        usage: { input_tokens: 400, output_tokens: 120 },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "- [x] Added monitor\n- [ ] Wire message rewrite" },
          ],
          usage: { input_tokens: 200, output_tokens: 130 },
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "Modified apps/desktop/src/lib/contextCompaction.ts and apps/desktop/src/components/ClaudeCodeSession.tsx",
            },
          ],
          usage: { input_tokens: 180, output_tokens: 120 },
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "text", text: "continue" }],
          usage: { input_tokens: 80, output_tokens: 0 },
        },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Next step: integrate session init?" }],
          usage: { input_tokens: 100, output_tokens: 110 },
        },
      },
    ];

    const result = rewriteSessionHistoryForCompaction({
      rawMessages,
      config,
      contextWindowTokens: 1400,
      gitSnapshot,
      compactedAt: new Date(0),
    });

    expect(result.compacted).toBe(true);
    const rewrittenText = JSON.stringify(result.rewrittenMessages)
      .replace(/"usage":\{[^}]+\}/g, "")
      .replace(/"timestamp":"[^"]+"/g, "");
    const approxTokens = Math.ceil(rewrittenText.length / 4);
    expect(approxTokens).toBeLessThanOrEqual(560);
    expect(rewrittenText).toContain("<session_context");
  });

  it("elevates session context and interruption hint on restart hydration", () => {
    const hydrated = elevateSessionContextForInit([
      { type: "system", message: { content: [{ type: "text", text: "System policy" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "Recent assistant" }] } },
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: '<session_context version="1"><completed_steps><step index="1">Done</step></completed_steps><pending_steps><step index="1">Next</step></pending_steps><file_modifications><file path="apps/desktop/src/lib/contextCompaction.ts" action="modified">updated</file></file_modifications><interruption detected="true"><operation>X</operation></interruption></session_context>',
            },
          ],
        },
      },
    ]) as Array<{ message?: { content?: Array<{ text?: string }> } }>;

    const systemText = hydrated[0]?.message?.content?.[0]?.text ?? "";
    const hintText = hydrated[1]?.message?.content?.[0]?.text ?? "";
    const contextText = hydrated[2]?.message?.content?.[0]?.text ?? "";
    expect(systemText).toContain("System policy");
    expect(hintText).toContain("Prioritize interruption resumption first");
    expect(contextText).toContain("<session_context");
    expect(contextText).toContain("completed_steps");
    expect(contextText).toContain("pending_steps");
    expect(contextText).toContain("file_modifications");
  });
});

describe("getContextWindowTokensForModel", () => {
  it("defaults for empty and known UI models", () => {
    expect(getContextWindowTokensForModel(undefined)).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
    expect(getContextWindowTokensForModel("sonnet")).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
    expect(getContextWindowTokensForModel("opus")).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
  });

  it("detects 1M-window hints in model strings", () => {
    expect(getContextWindowTokensForModel("claude-3-5-sonnet-1m")).toBe(1_000_000);
  });
});

describe("Phase 6 — performance and round-trip (NF-001, SC-005)", () => {
  const gitSnapshot: GitSnapshot = {
    branch: "main",
    stagedChanges: 0,
    unstagedChanges: 0,
    lastCommitHash: "abc1234",
    lastCommitMessage: "feat: baseline compaction",
    diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
  };

  it("NF-001 compacts a 100k-token-equivalent history in under 2 seconds", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 2 } },
      {},
    );
    const compactor = new ProgrammaticCompactor(config);
    const chunk = "x".repeat(1000);
    const messages: CompactionMessage[] = [];
    for (let i = 0; i < 400; i += 1) {
      messages.push({
        id: `m-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: chunk,
      });
    }

    const t0 = performance.now();
    compactor.compact({ messages }, gitSnapshot, new Date(0));
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(2000);
  });

  it("SC-005 50-turn round-trip preserves completed work, pending work, and file paths in session_context", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 1 } },
      {},
    );
    const rawMessages: unknown[] = [];
    for (let turn = 0; turn < 25; turn += 1) {
      rawMessages.push({
        type: "user",
        message: {
          content: [{ type: "text", text: `User turn ${turn}` }],
          usage: { input_tokens: 400, output_tokens: 0 },
        },
        usage: { input_tokens: 400, output_tokens: 0 },
      });
      rawMessages.push({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text:
                turn === 0
                  ? "Plan:\n- [x] Ship feature A\n- [ ] Ship feature B\nEdited src/app/feature.ts and packages/api/handler.rs"
                  : `Progress note ${turn}`,
            },
          ],
          usage: { input_tokens: 400, output_tokens: 200 },
        },
        usage: { input_tokens: 400, output_tokens: 200 },
      });
    }

    const result = rewriteSessionHistoryForCompaction({
      rawMessages,
      config,
      contextWindowTokens: 20_000,
      gitSnapshot,
      compactedAt: new Date(0),
    });

    expect(result.compacted).toBe(true);
    const blob = JSON.stringify(result.rewrittenMessages);
    expect(blob).toContain("Ship feature A");
    expect(blob).toContain("Ship feature B");
    expect(blob).toContain("src/app/feature.ts");
    expect(blob).toContain("packages/api/handler.rs");
    expect(blob).toContain("<session_context");
  });

  it("P5-001 aligns synthetic runtime ids when raw history contains non-record entries", () => {
    const config = resolveContextCompactionConfig(
      { compaction: { preserve_recent_turns: 0 } },
      {},
    );
    const rawMessages: unknown[] = [
      {
        type: "user",
        message: { content: [{ type: "text", text: "hello" }] },
        usage: { input_tokens: 4000, output_tokens: 0 },
      },
      null,
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "world" }] },
        usage: { input_tokens: 4000, output_tokens: 0 },
      },
    ];

    const result = rewriteSessionHistoryForCompaction({
      rawMessages,
      config,
      contextWindowTokens: 10_000,
      gitSnapshot,
      compactedAt: new Date(0),
    });

    expect(result.compacted).toBe(true);
    const blob = JSON.stringify(result.rewrittenMessages);
    expect(blob).toContain("hello");
    expect(blob).toContain("world");
  });
});
