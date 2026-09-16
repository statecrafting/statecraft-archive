/**
 * Node sidecar entry for Tauri IPC (spec 042 Phase 6 + 045): stdin JSONL control,
 * stdout JSONL compatible with `claude-output` consumers.
 *
 * Model convention: `providerId:apiModel` (e.g. `anthropic:claude-3-5-sonnet-20241022`)
 * selects {@link ProviderRegistry}; otherwise the legacy Claude Code bridge path runs.
 */
import { createInterface } from "node:readline";
import {
  bridgeEventToClaudeOutputLines,
  PermissionBroker,
  queryClaudeCode,
} from "@opc/claude-code-bridge";
import type { BridgeQueryOptions, PermissionMode } from "@opc/claude-code-bridge/types";
import {
  createPermissionHandler,
  createPermissionStore,
  type PermissionBlockedDecision,
} from "@opc/permission-system";
import { AgentEventBridgeEncoder } from "./agent-event-bridge-encode.js";
import { parseProviderModel } from "./model-selector.js";
import { registerBuiltInProvidersFromEnv } from "./register-env-providers.js";
import { getProviderRegistry } from "./registry.js";
import { ProviderError } from "./types.js";
import type { QueryParams } from "./types.js";

interface SidecarQueryMessage {
  type: "query";
  prompt: string;
  agentName?: string;
  workingDirectory: string;
  model?: string;
  sessionId?: string;
  permissionMode?: PermissionMode;
  oauthToken?: string;
  systemPrompt?: string;
  allowedTools?: string[];
}

interface PermissionResponseMessage {
  type: "permission-response";
  requestId: string;
  allowed: boolean;
}

interface AbortMessage {
  type: "abort";
}

function isAbortMessage(m: unknown): m is AbortMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as AbortMessage).type === "abort"
  );
}

function isPermissionResponse(m: unknown): m is PermissionResponseMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as PermissionResponseMessage).type === "permission-response"
  );
}

function parseQuery(raw: string): SidecarQueryMessage {
  const v = JSON.parse(raw) as unknown;
  if (
    typeof v !== "object" ||
    v === null ||
    (v as SidecarQueryMessage).type !== "query"
  ) {
    throw new Error('First stdin line must be a JSON object with type: "query"');
  }
  return v as SidecarQueryMessage;
}

function normalizeAllowedTools(allowedTools: string[] | undefined): string[] | undefined {
  if (!Array.isArray(allowedTools)) {
    return undefined;
  }
  const normalized = allowedTools
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function formatToolAllowlistError(
  toolName: string,
  agentName: string | undefined,
  allowedTools: string[],
): string {
  const agent = agentName?.trim() || "unknown-agent";
  return `Tool '${toolName}' is not in agent '${agent}' allowlist. Declared tools: [${allowedTools.join(", ")}]`;
}

async function runProviderPath(
  q: SidecarQueryMessage,
  providerId: string,
  apiModel: string,
  ac: AbortController,
): Promise<void> {
  registerBuiltInProvidersFromEnv();
  const registry = getProviderRegistry();
  const provider = registry.get(providerId);

  const session = await provider.spawn({ defaultModel: apiModel });
  const params: QueryParams = {
    model: apiModel,
    messages: [{ role: "user", content: q.prompt }],
    systemPrompt: q.systemPrompt,
    signal: ac.signal,
  };

  const enc = new AgentEventBridgeEncoder(session.sessionId, q.workingDirectory);
  try {
    for await (const ev of provider.stream(session, params)) {
      for (const be of enc.push(ev)) {
        for (const line of bridgeEventToClaudeOutputLines(be)) {
          process.stdout.write(`${line}\n`);
        }
      }
    }
  } catch (e) {
    const msg =
      e instanceof ProviderError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    const fatal = e instanceof ProviderError ? !e.retryable : false;
    for (const line of bridgeEventToClaudeOutputLines({
      kind: "error",
      error: msg,
      fatal,
    })) {
      process.stdout.write(`${line}\n`);
    }
  } finally {
    await provider.abort(session).catch(() => undefined);
  }
}

async function run(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  const it = rl[Symbol.asyncIterator]();
  const first = await it.next();
  if (first.done || typeof first.value !== "string") {
    process.stderr.write("sidecar: missing query line on stdin\n");
    process.exit(1);
  }

  let q: SidecarQueryMessage;
  try {
    q = parseQuery(first.value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`sidecar: ${msg}\n`);
    rl.close();
    process.exit(1);
    return;
  }

  const ac = new AbortController();
  const broker = new PermissionBroker();

  broker.setEventSink((ev) => {
    for (const line of bridgeEventToClaudeOutputLines(ev)) {
      process.stdout.write(`${line}\n`);
    }
  });

  const controlLoop = (async () => {
    for (;;) {
      const n = await it.next();
      if (n.done) break;
      const line = String(n.value);
      if (line.trim() === "") continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (isAbortMessage(msg)) {
        ac.abort();
        continue;
      }
      if (isPermissionResponse(msg)) {
        broker.respond(msg.requestId, msg.allowed);
      }
    }
  })();

  const rawModel = q.model ?? "";
  const { providerId, model: apiModel } = parseProviderModel(rawModel);
  const allowedTools = normalizeAllowedTools(q.allowedTools);
  const permissionStore = createPermissionStore({ projectRoot: q.workingDirectory });
  let blockedDecision: PermissionBlockedDecision | null = null;
  const permissionCanUseTool = createPermissionHandler({
    evaluatorOptions: {
      store: permissionStore,
      prompt: async ({ toolName, argument }) => {
        const allowed = await broker.request(toolName, { argument });
        return { choice: allowed ? "allow_once" : "deny" };
      },
    },
    resolveArgument: (toolName, toolInput) => {
      if (toolName === "Bash" && typeof toolInput.command === "string") {
        return toolInput.command.trim().split(/\s+/).filter(Boolean).join(":");
      }
      if (typeof toolInput.file_path === "string") {
        return toolInput.file_path;
      }
      if (typeof toolInput.path === "string") {
        return toolInput.path;
      }
      if (typeof toolInput.server === "string" && typeof toolInput.tool === "string") {
        return `${toolInput.server}:${toolInput.tool}`;
      }
      const compact = JSON.stringify(toolInput);
      return compact && compact !== "{}" ? compact : "*";
    },
    onBlocked: async (blocked) => {
      blockedDecision = blocked;
    },
  });

  try {
    if (providerId !== null) {
      await runProviderPath(q, providerId, apiModel, ac);
    } else {
      const opts: BridgeQueryOptions = {
        prompt: q.prompt,
        workingDirectory: q.workingDirectory,
        model: rawModel || undefined,
        sessionId: q.sessionId,
        permissionMode: q.permissionMode ?? "default",
        systemPrompt: q.systemPrompt,
        allowedTools,
        abortController: ac,
        oauthToken: q.oauthToken,
        canUseTool: (toolName, toolInput) => {
          if (allowedTools && !allowedTools.includes(toolName)) {
            const error = formatToolAllowlistError(toolName, q.agentName, allowedTools);
            throw new Error(error);
          }
          return permissionCanUseTool(toolName, toolInput).then((allowed) => {
            if (!allowed) {
              const reason =
                blockedDecision?.evaluation.rationale ?? "Permission denied by policy";
              const source = blockedDecision?.evaluation.source ?? "unknown";
              throw new Error(`Permission denied for ${toolName}: ${reason} (source=${source})`);
            }
            return true;
          });
        },
      };

      for await (const ev of queryClaudeCode(opts)) {
        for (const line of bridgeEventToClaudeOutputLines(ev)) {
          process.stdout.write(`${line}\n`);
        }
      }
    }
  } finally {
    broker.denyAll();
    rl.close();
    await controlLoop.catch(() => undefined);
  }

  process.stdout.write(`${JSON.stringify({ done: true })}\n`);
}

run().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`sidecar: fatal: ${msg}\n`);
  process.exit(1);
});
