import { createElement } from "react";
import type { InputDisplayConfig } from "../types.js";

export interface InputDisplayProps {
  config: InputDisplayConfig;
  input: Record<string, unknown>;
}

export function extractFields(
  fields: string[],
  input: Record<string, unknown>,
): Array<{ field: string; value: string }> {
  return fields
    .filter((f) => input[f] !== undefined && input[f] !== null)
    .map((f) => ({
      field: f,
      value: typeof input[f] === "string" ? input[f] as string : JSON.stringify(input[f]),
    }));
}

export function InputDisplay({ config, input }: InputDisplayProps) {
  const entries = extractFields(config.fields, input);

  if (entries.length === 0) {
    // Show raw input keys as fallback
    const keys = Object.keys(input);
    if (keys.length === 0) return null;
    return createElement("div", { className: "tool-renderer-input tool-renderer-input-fallback" },
      keys.map((key) =>
        createElement("div", { key, className: "tool-renderer-input-entry" },
          createElement("span", { className: "tool-renderer-input-label" }, key + ": "),
          createElement("span", { className: "tool-renderer-input-value" },
            typeof input[key] === "string" ? input[key] as string : JSON.stringify(input[key]),
          ),
        ),
      ),
    );
  }

  if (config.format === "inline" && entries.length === 1) {
    return createElement("div", { className: "tool-renderer-input tool-renderer-input-inline" },
      config.syntaxHighlight
        ? createElement("code", { className: `language-${config.syntaxHighlight}` }, entries[0].value)
        : createElement("span", null, entries[0].value),
    );
  }

  return createElement("div", { className: "tool-renderer-input tool-renderer-input-block" },
    entries.map((entry) =>
      createElement("div", { key: entry.field, className: "tool-renderer-input-entry" },
        entries.length > 1
          ? createElement("span", { className: "tool-renderer-input-label" }, entry.field + ": ")
          : null,
        config.syntaxHighlight
          ? createElement("code", { className: `language-${config.syntaxHighlight}` }, entry.value)
          : createElement("pre", null, entry.value),
      ),
    ),
  );
}
