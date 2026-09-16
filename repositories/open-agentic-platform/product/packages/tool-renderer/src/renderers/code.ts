import type { ContentRenderer, ContentRendererProps } from "../types.js";
import { createElement } from "react";

function CodeRenderer(props: ContentRendererProps) {
  const { content, syntaxHighlight, maxCollapsedLines } = props;
  const lines = content.split("\n");
  const truncated = maxCollapsedLines && lines.length > maxCollapsedLines;
  const displayContent = truncated
    ? lines.slice(0, maxCollapsedLines).join("\n")
    : content;

  return createElement("pre", {
    className: "tool-renderer-code",
    "data-language": syntaxHighlight ?? undefined,
    "data-truncated": truncated ? "true" : undefined,
    "data-total-lines": String(lines.length),
  },
    createElement("code", {
      className: syntaxHighlight ? `language-${syntaxHighlight}` : undefined,
    }, displayContent),
  );
}

export const codeRenderer: ContentRenderer = {
  id: "code",
  render: (props) => createElement(CodeRenderer, props),
};
