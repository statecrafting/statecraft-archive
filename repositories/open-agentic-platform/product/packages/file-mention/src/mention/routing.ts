/**
 * Agent mention routing (058 Phase 6).
 *
 * Routes messages to specific agents when an agent @mention is present.
 * Integrates with the provider registry (042) conceptually — this module
 * defines the routing contract without importing the registry directly.
 */

import type { MentionMessage, AgentInfo, AgentCandidate } from "../types.js";

/**
 * Callback signature for agent message delivery.
 */
export type AgentMessageHandler = (
  agentId: string,
  message: MentionMessage,
) => void | Promise<void>;

/**
 * Agent source — provides registered agents to the mention index.
 * Compatible with @opc/provider-registry without direct import.
 */
export interface AgentSource {
  listAgents(): AgentInfo[];
}

/**
 * Router configuration.
 */
export interface RouterOptions {
  /** Callback invoked when a message is routed to an agent. */
  onRoute: AgentMessageHandler;
  /** Optional: called when routing fails (agent not found). */
  onRoutingError?: (agentId: string, error: Error) => void;
}

/**
 * Message router for agent @mentions (FR-007, SC-005).
 *
 * When a message contains an agent mention token, the router
 * delivers the message to that agent via the configured handler.
 */
export class MentionRouter {
  private handler: AgentMessageHandler;
  private errorHandler?: (agentId: string, error: Error) => void;
  private knownAgents = new Map<string, AgentInfo>();

  constructor(options: RouterOptions) {
    this.handler = options.onRoute;
    this.errorHandler = options.onRoutingError;
  }

  /**
   * Register agents from an AgentSource.
   */
  loadAgents(source: AgentSource): void {
    for (const agent of source.listAgents()) {
      this.knownAgents.set(agent.agentId, agent);
    }
  }

  /**
   * Register a single agent.
   */
  addAgent(agent: AgentInfo): void {
    this.knownAgents.set(agent.agentId, agent);
  }

  /**
   * Unregister an agent.
   */
  removeAgent(agentId: string): void {
    this.knownAgents.delete(agentId);
  }

  /**
   * Get all known agents as candidates for the mention index.
   */
  getAgentCandidates(): AgentCandidate[] {
    return Array.from(this.knownAgents.values()).map((a) => ({
      type: "agent" as const,
      agentId: a.agentId,
      displayName: a.displayName,
      avatar: a.avatar,
    }));
  }

  /**
   * Get all known agent infos.
   */
  getAgents(): AgentInfo[] {
    return Array.from(this.knownAgents.values());
  }

  /**
   * Route a resolved message to its target agent, if any (SC-005).
   *
   * Returns true if the message was routed, false if no agent target.
   */
  async route(message: MentionMessage): Promise<boolean> {
    if (!message.targetAgentId) return false;

    const agent = this.knownAgents.get(message.targetAgentId);
    if (!agent) {
      const err = new Error(
        `Agent "${message.targetAgentId}" not found in registry`,
      );
      this.errorHandler?.(message.targetAgentId, err);
      return false;
    }

    try {
      await this.handler(message.targetAgentId, message);
      return true;
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error(String(error));
      this.errorHandler?.(message.targetAgentId, err);
      return false;
    }
  }
}
