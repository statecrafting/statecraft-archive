import type { ContentRenderer, ContentRendererProps } from "../types.js";
import { createElement } from "react";

function TextRenderer(props: ContentRendererProps) {
  const { content, maxCollapsedLines } = props;
  const lines = content.split("\n");
  const truncated = maxCollapsedLines && lines.length > maxCollapsedLines;
  const displayContent = truncated
    ? lines.slice(0, maxCollapsedLines).join("\n")
    : content;

  return createElement("pre", {
    className: "tool-renderer-text",
    "data-truncated": truncated ? "true" : undefined,
    "data-total-lines": String(lines.length),
  }, displayContent);
}

export const textRenderer: ContentRenderer = {
  id: "text",
  render: (props) => createElement(TextRenderer, props),
};
