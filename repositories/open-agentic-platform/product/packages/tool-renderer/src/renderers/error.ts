import type { ContentRenderer, ContentRendererProps } from "../types.js";
import { createElement } from "react";

function ErrorRenderer(props: ContentRendererProps) {
  const { content } = props;
  return createElement("div", {
    className: "tool-renderer-error",
    role: "alert",
  },
    createElement("span", { className: "tool-renderer-error-icon" }, "!"),
    createElement("pre", { className: "tool-renderer-error-content" }, content),
  );
}

export const errorRenderer: ContentRenderer = {
  id: "error",
  render: (props) => createElement(ErrorRenderer, props),
};
