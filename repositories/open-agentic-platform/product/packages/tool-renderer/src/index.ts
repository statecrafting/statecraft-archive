// Types
export type {
  ToolDisplayConfig,
  InputDisplayConfig,
  ResultDisplayConfig,
  CollapseConfig,
  ContentRenderer,
  ContentRendererProps,
  ToolInvocation,
  ToolResult,
  SubagentInfo,
  ThinkingTrace,
} from "./types.js";

// Registry
export {
  ToolDisplayRegistry,
  FALLBACK_TOOL_CONFIG,
  defaultRegistry,
} from "./registry.js";

// Content renderers
export {
  builtinRenderers,
  textRenderer,
  codeRenderer,
  diffRenderer,
  parseDiffLines,
  imageRenderer,
  jsonRenderer,
  tryParseJson,
  markdownRenderer,
  errorRenderer,
} from "./renderers/index.js";

// Components
export {
  ElapsedTime,
  formatElapsed,
  InputDisplay,
  extractFields,
  ResultDisplay,
  selectContentRenderer,
  ToolBlock,
  shouldAutoCollapse,
  SubagentContainer,
  AUTO_COLLAPSE_DEPTH,
  ThinkingTraceBlock,
  summarizeThinking,
} from "./components/index.js";

// Default configs
export { defaultToolConfigs } from "./configs/defaults.js";

// Convenience: create a fully-initialized registry
import { ToolDisplayRegistry } from "./registry.js";
import { builtinRenderers } from "./renderers/index.js";
import { defaultToolConfigs } from "./configs/defaults.js";

export function createDefaultRegistry(): ToolDisplayRegistry {
  const registry = new ToolDisplayRegistry();
  registry.registerAll(defaultToolConfigs);
  for (const renderer of builtinRenderers) {
    registry.registerContentRenderer(renderer);
  }
  return registry;
}
