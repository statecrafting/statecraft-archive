import { describe, expect, it } from "vitest";

import { AgentLifecycleBus } from "./lifecycle-events.js";

describe("AgentLifecycleBus", () => {
  it("emits all six lifecycle payload types in order", () => {
    const bus = new AgentLifecycleBus();
    const seen: string[] = [];

    bus.on("spawned", (event) => {
      seen.push(event.status);
      expect(event.branchName).toBe("agent/a-thing");
      expect(event.parentBranch).toBe("main");
    });
    bus.on("running", (event) => {
      seen.push(event.status);
      expect(event.agentId).toBe("a1");
    });
    bus.on("tool_use", (event) => {
      seen.push(event.status);
      expect(event.detail).toBe("rg src");
    });
    bus.on("completed", (event) => {
      seen.push(event.status);
      expect(event.exitCode).toBe(0);
    });
    bus.on("failed", (event) => {
      seen.push(event.status);
      expect(event.detail).toBe("non-zero exit");
    });
    bus.on("timed_out", (event) => {
      seen.push(event.status);
      expect(event.timeoutMs).toBe(300_000);
    });

    bus.emit("spawned", {
      agentId: "a1",
      timestamp: 1_000,
      branchName: "agent/a-thing",
      worktreePath: "/tmp/w1",
      parentBranch: "main",
    });
    bus.emit("running", { agentId: "a1", timestamp: 1_100 });
    bus.emit("tool_use", { agentId: "a1", timestamp: 1_200, detail: "rg src" });
    bus.emit("completed", {
      agentId: "a1",
      timestamp: 1_300,
      exitCode: 0,
      signal: null,
    });
    bus.emit("failed", {
      agentId: "a2",
      timestamp: 1_400,
      exitCode: 1,
      signal: null,
      detail: "non-zero exit",
    });
    bus.emit("timed_out", {
      agentId: "a3",
      timestamp: 1_500,
      timeoutMs: 300_000,
    });

    expect(seen).toEqual([
      "spawned",
      "running",
      "tool_use",
      "completed",
      "failed",
      "timed_out",
    ]);
  });

  it("projects listAgents with active first and recent terminal statuses", () => {
    const bus = new AgentLifecycleBus({ recentTerminalLimit: 2 });

    bus.emit("spawned", {
      agentId: "active",
      timestamp: 2_000,
      branchName: "agent/active-work",
      worktreePath: "/tmp/active",
      parentBranch: "main",
    });
    bus.emit("running", { agentId: "active", timestamp: 2_100 });

    bus.emit("spawned", {
      agentId: "done-old",
      timestamp: 1_000,
      branchName: "agent/done-old",
      worktreePath: "/tmp/old",
      parentBranch: "main",
    });
    bus.emit("completed", {
      agentId: "done-old",
      timestamp: 1_100,
      exitCode: 0,
      signal: null,
    });

    bus.emit("spawned", {
      agentId: "done-new",
      timestamp: 3_000,
      branchName: "agent/done-new",
      worktreePath: "/tmp/new",
      parentBranch: "main",
    });
    bus.emit("failed", {
      agentId: "done-new",
      timestamp: 3_100,
      exitCode: 2,
      signal: null,
      detail: "boom",
    });

    bus.emit("spawned", {
      agentId: "timed",
      timestamp: 4_000,
      branchName: "agent/timed",
      worktreePath: "/tmp/timed",
      parentBranch: "main",
    });
    bus.emit("timed_out", {
      agentId: "timed",
      timestamp: 4_100,
      timeoutMs: 60_000,
    });

    const listed = bus.listAgents(5_000);
    expect(listed.map((entry) => entry.agentId)).toEqual([
      "active",
      "timed",
      "done-new",
    ]);
    expect(listed[0]).toMatchObject({
      agentId: "active",
      status: "running",
      branchName: "agent/active-work",
      startedAt: 2_000,
      elapsedMs: 3_000,
    });
    expect(listed[1].status).toBe("timed_out");
    expect(listed[1].lastEvent.status).toBe("timed_out");
    expect(listed[2].status).toBe("failed");
    expect(listed[2].lastEvent.status).toBe("failed");
  });
});
