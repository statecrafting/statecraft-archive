/**
 * Parse hooks declared in settings.json (FR-005a).
 *
 * Settings format (from spec):
 * ```json
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       { "name": "block-force-push", "type": "bash", "run": "echo ...", "action": "block", "priority": 100 }
 *     ]
 *   }
 * }
 * ```
 */

import type {
  FailMode,
  HandlerType,
  HookEventType,
  HookHandler,
  RegisteredHook,
} from "./types.js";

const VALID_EVENTS = new Set<HookEventType>([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "SessionStop",
  "FileChanged",
]);

const VALID_HANDLER_TYPES = new Set<HandlerType>(["bash", "agent", "prompt"]);
const VALID_ACTIONS = new Set(["block", "warn", "modify"]);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PRIORITY = 50;

interface RawSettingsHook {
  name?: string;
  type?: string;
  run?: string;
  if?: string;
  action?: string;
  priority?: number;
  failMode?: string;
  timeout?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildHandler(raw: RawSettingsHook): HookHandler | null {
  const handlerType = (raw.type ?? "bash") as HandlerType;
  if (!VALID_HANDLER_TYPES.has(handlerType)) {
    return null;
  }

  const run = raw.run;
  if (typeof run !== "string" || run.trim().length === 0) {
    return null;
  }

  switch (handlerType) {
    case "bash":
      return { type: "bash", command: run };
    case "agent":
      return { type: "agent", promptTemplate: run };
    case "prompt":
      return { type: "prompt", message: run };
  }
}

/**
 * Parse the `hooks` key from a settings.json object into RegisteredHook[].
 * Invalid entries are silently skipped (settings are user-authored, not crash-worthy).
 */
export function parseSettingsHooks(
  settings: Record<string, unknown>,
): RegisteredHook[] {
  const hooksObj = settings.hooks;
  if (!isRecord(hooksObj)) {
    return [];
  }

  const hooks: RegisteredHook[] = [];

  for (const [eventKey, hookList] of Object.entries(hooksObj)) {
    if (!VALID_EVENTS.has(eventKey as HookEventType)) {
      continue;
    }
    const event = eventKey as HookEventType;

    if (!Array.isArray(hookList)) {
      continue;
    }

    for (let i = 0; i < hookList.length; i++) {
      const raw = hookList[i] as RawSettingsHook;
      if (!isRecord(raw)) {
        continue;
      }

      const name = typeof raw.name === "string" ? raw.name : `settings:${event}:${i}`;
      const handler = buildHandler(raw);
      if (!handler) {
        continue;
      }

      const action = typeof raw.action === "string" && VALID_ACTIONS.has(raw.action)
        ? (raw.action as "block" | "warn" | "modify")
        : "warn";

      const failMode: FailMode =
        typeof raw.failMode === "string" && (raw.failMode === "block" || raw.failMode === "warn")
          ? raw.failMode
          : "warn";

      const priority = typeof raw.priority === "number" && Number.isFinite(raw.priority)
        ? raw.priority
        : DEFAULT_PRIORITY;

      const timeoutMs = typeof raw.timeout === "number" && raw.timeout > 0
        ? raw.timeout
        : DEFAULT_TIMEOUT_MS;

      hooks.push({
        name,
        event,
        condition: null,
        matcher: {},
        handler,
        action,
        priority,
        failMode,
        timeoutMs,
        source: "settings",
      });
    }
  }

  return hooks;
}
