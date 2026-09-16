import { createElement } from "react";
import type { SubagentInfo, ContentRenderer, ToolDisplayConfig } from "../types.js";
import { ElapsedTime } from "./elapsed-time.js";
import { ToolBlock } from "./tool-block.js";

export interface SubagentContainerProps {
  subagent: SubagentInfo;
  getConfig: (toolId: string) => ToolDisplayConfig;
  getContentRenderer: (id: string) => ContentRenderer | undefined;
  depth?: number;
}

/** Maximum nesting depth before auto-collapsing (R-002 mitigation). */
export const AUTO_COLLAPSE_DEPTH = 2;

export function SubagentContainer({
  subagent,
  getConfig,
  getContentRenderer,
  depth = 0,
}: SubagentContainerProps) {
  const autoCollapse = depth >= AUTO_COLLAPSE_DEPTH;

  return createElement("div", {
    className: "tool-renderer-subagent",
    "data-subagent-id": subagent.id,
    "data-depth": String(depth),
    "data-collapsed": autoCollapse ? "true" : undefined,
  },
    // Header (FR-007: agent identity)
    createElement("div", { className: "tool-renderer-subagent-header" },
      createElement("span", { className: "tool-renderer-subagent-name" }, subagent.name),
      subagent.model
        ? createElement("span", { className: "tool-renderer-subagent-model" }, subagent.model)
        : null,
      createElement(ElapsedTime, {
        startedAt: subagent.startedAt,
        completedAt: subagent.completedAt,
      }),
    ),
    // Nested tool history (FR-007: tool call history as nested list)
    createElement("div", { className: "tool-renderer-subagent-tools" },
      subagent.toolInvocations.map((invocation) =>
        createElement(ToolBlock, {
          key: invocation.id,
          invocation,
          config: getConfig(invocation.toolId),
          getContentRenderer,
        }),
      ),
    ),
  );
}
