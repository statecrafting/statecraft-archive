import type { ToolDisplayConfig, ContentRenderer } from "./types.js";

/**
 * Default fallback config for unknown tools (FR-002).
 */
export const FALLBACK_TOOL_CONFIG: ToolDisplayConfig = {
  toolId: "__fallback__",
  label: "Tool",
  icon: "terminal",
  accentColor: "#6b7280",
  inputDisplay: {
    fields: [],
    format: "block",
  },
  resultDisplay: {
    contentRenderer: "text",
    maxCollapsedLines: 20,
  },
  collapse: {
    defaultState: "expanded",
    collapseThreshold: 50,
  },
};

/**
 * Config-driven tool display registry (FR-002, FR-009).
 *
 * Maps tool ids to their ToolDisplayConfig. Unknown tools fall back to
 * a generic default. Supports runtime extension for MCP tools.
 */
export class ToolDisplayRegistry {
  private configs = new Map<string, ToolDisplayConfig>();
  private contentRenderers = new Map<string, ContentRenderer>();

  /** Register a tool display config. Overwrites any existing config for the same toolId. */
  register(config: ToolDisplayConfig): void {
    this.configs.set(config.toolId, config);
  }

  /** Register multiple configs at once. */
  registerAll(configs: ToolDisplayConfig[]): void {
    for (const config of configs) {
      this.register(config);
    }
  }

  /** Get the display config for a tool. Returns fallback for unknown tools (FR-002). */
  get(toolId: string): ToolDisplayConfig {
    return this.configs.get(toolId) ?? {
      ...FALLBACK_TOOL_CONFIG,
      toolId,
      label: toolId,
    };
  }

  /** Check if a tool has a registered config. */
  has(toolId: string): boolean {
    return this.configs.has(toolId);
  }

  /** Remove a tool's display config. */
  unregister(toolId: string): boolean {
    return this.configs.delete(toolId);
  }

  /** List all registered tool ids. */
  listToolIds(): string[] {
    return Array.from(this.configs.keys());
  }

  /** Register a content renderer (FR-005). */
  registerContentRenderer(renderer: ContentRenderer): void {
    this.contentRenderers.set(renderer.id, renderer);
  }

  /** Get a content renderer by id. Returns undefined if not found. */
  getContentRenderer(id: string): ContentRenderer | undefined {
    return this.contentRenderers.get(id);
  }

  /** List all registered content renderer ids. */
  listContentRendererIds(): string[] {
    return Array.from(this.contentRenderers.keys());
  }

  /** Export all configs as a JSON-serializable array (NF-003). */
  toJSON(): ToolDisplayConfig[] {
    return Array.from(this.configs.values());
  }

  /** Import configs from a JSON-serializable array. */
  fromJSON(configs: ToolDisplayConfig[]): void {
    for (const config of configs) {
      this.register(config);
    }
  }
}

/** Singleton registry instance. */
export const defaultRegistry = new ToolDisplayRegistry();
