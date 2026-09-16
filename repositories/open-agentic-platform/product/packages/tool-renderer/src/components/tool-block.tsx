import { createElement } from "react";
import type { ToolInvocation, ToolDisplayConfig, ContentRenderer } from "../types.js";
import { ElapsedTime } from "./elapsed-time.js";
import { InputDisplay } from "./input-display.js";
import { ResultDisplay } from "./result-display.js";

export interface ToolBlockProps {
  invocation: ToolInvocation;
  config: ToolDisplayConfig;
  getContentRenderer: (id: string) => ContentRenderer | undefined;
}

export function shouldAutoCollapse(
  invocation: ToolInvocation,
  config: ToolDisplayConfig,
): boolean {
  if (config.collapse.defaultState === "collapsed") return true;
  if (!invocation.result) return false;
  const lineCount = invocation.result.content.split("\n").length;
  return lineCount > config.collapse.collapseThreshold;
}

export function ToolBlock({ invocation, config, getContentRenderer }: ToolBlockProps) {
  const collapsed = shouldAutoCollapse(invocation, config);

  return createElement("div", {
    className: "tool-renderer-block",
    "data-tool-id": invocation.toolId,
    "data-collapsed": collapsed ? "true" : undefined,
    style: { borderLeftColor: config.accentColor },
  },
    // Header
    createElement("div", { className: "tool-renderer-block-header" },
      createElement("span", { className: "tool-renderer-block-icon", "data-icon": config.icon }),
      createElement("span", { className: "tool-renderer-block-label" }, config.label),
      createElement(ElapsedTime, {
        startedAt: invocation.startedAt,
        completedAt: invocation.completedAt,
      }),
    ),
    // Input
    createElement(InputDisplay, {
      config: config.inputDisplay,
      input: invocation.input,
    }),
    // Result
    invocation.result
      ? createElement(ResultDisplay, {
          config: config.resultDisplay,
          result: invocation.result,
          getContentRenderer,
        })
      : createElement("div", { className: "tool-renderer-pending" }, "Running..."),
  );
}
