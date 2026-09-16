import { createElement } from "react";
import type { ThinkingTrace } from "../types.js";
import { formatElapsed } from "./elapsed-time.js";

export interface ThinkingTraceProps {
  trace: ThinkingTrace;
}

export function summarizeThinking(text: string, maxLength = 80): string {
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return firstLine.slice(0, maxLength - 3) + "...";
}

export function ThinkingTraceBlock({ trace }: ThinkingTraceProps) {
  const elapsed = (trace.completedAt ?? Date.now()) - trace.startedAt;
  const isRunning = trace.completedAt === undefined;
  const summary = summarizeThinking(trace.text);

  return createElement("details", {
    className: "tool-renderer-thinking",
    "data-thinking-id": trace.id,
    "data-running": isRunning ? "true" : undefined,
  },
    // Summary line (collapsed view) — FR-008
    createElement("summary", { className: "tool-renderer-thinking-summary" },
      createElement("span", { className: "tool-renderer-thinking-label" }, "Thinking"),
      createElement("span", { className: "tool-renderer-thinking-elapsed" }, formatElapsed(elapsed)),
      createElement("span", { className: "tool-renderer-thinking-preview" }, summary),
    ),
    // Full thinking text (expanded view) — FR-008
    createElement("pre", { className: "tool-renderer-thinking-content" }, trace.text),
  );
}
