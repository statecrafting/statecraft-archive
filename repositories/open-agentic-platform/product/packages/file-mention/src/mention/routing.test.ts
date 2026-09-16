import { describe, it, expect, vi, beforeEach } from "vitest";
import { MentionRouter } from "./routing.js";
import type { MentionMessage, AgentInfo } from "../types.js";
import type { AgentSource } from "./routing.js";

const testAgent: AgentInfo = {
  agentId: "builder",
  displayName: "Builder Agent",
  avatar: "🤖",
};

function makeMessage(targetAgentId?: string): MentionMessage {
  return {
    text: "test message",
    tokens: [],
    fileAttachments: [],
    targetAgentId,
  };
}

describe("MentionRouter", () => {
  let onRoute: ReturnType<typeof vi.fn>;
  let router: MentionRouter;

  beforeEach(() => {
    onRoute = vi.fn();
    router = new MentionRouter({ onRoute });
    router.addAgent(testAgent);
  });

  it("routes message to target agent (SC-005)", async () => {
    const msg = makeMessage("builder");
    const routed = await router.route(msg);
    expect(routed).toBe(true);
    expect(onRoute).toHaveBeenCalledWith("builder", msg);
  });

  it("returns false when no target agent", async () => {
    const msg = makeMessage(undefined);
    const routed = await router.route(msg);
    expect(routed).toBe(false);
    expect(onRoute).not.toHaveBeenCalled();
  });

  it("returns false for unknown agent", async () => {
    const onError = vi.fn();
    const r = new MentionRouter({ onRoute, onRoutingError: onError });
    const msg = makeMessage("unknown");
    const routed = await r.route(msg);
    expect(routed).toBe(false);
    expect(onError).toHaveBeenCalledWith("unknown", expect.any(Error));
  });

  it("handles async route handler", async () => {
    const asyncHandler = vi.fn().mockResolvedValue(undefined);
    const r = new MentionRouter({ onRoute: asyncHandler });
    r.addAgent(testAgent);
    const routed = await r.route(makeMessage("builder"));
    expect(routed).toBe(true);
  });

  it("catches handler errors", async () => {
    const onError = vi.fn();
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const r = new MentionRouter({ onRoute: failing, onRoutingError: onError });
    r.addAgent(testAgent);
    const routed = await r.route(makeMessage("builder"));
    expect(routed).toBe(false);
    expect(onError).toHaveBeenCalledWith("builder", expect.any(Error));
  });

  it("loadAgents from source", () => {
    const source: AgentSource = {
      listAgents: () => [
        testAgent,
        { agentId: "reviewer", displayName: "Reviewer", avatar: "👁️" },
      ],
    };
    const r = new MentionRouter({ onRoute });
    r.loadAgents(source);
    expect(r.getAgents()).toHaveLength(2);
  });

  it("addAgent and removeAgent", () => {
    expect(router.getAgents()).toHaveLength(1);
    router.removeAgent("builder");
    expect(router.getAgents()).toHaveLength(0);
  });

  it("getAgentCandidates returns typed candidates", () => {
    const candidates = router.getAgentCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.type).toBe("agent");
    expect(candidates[0]!.agentId).toBe("builder");
  });
});
