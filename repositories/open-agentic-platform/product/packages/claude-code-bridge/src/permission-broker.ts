import { randomUUID } from "node:crypto";
import type { BridgePermissionRequestEvent } from "./types.js";

/**
 * Manages the canUseTool round-trip: emits a permission-request event,
 * waits for an external response, and resolves the SDK's promise.
 */
export class PermissionBroker {
  private pending = new Map<string, (allowed: boolean) => void>();
  private eventSink: ((event: BridgePermissionRequestEvent) => void) | null =
    null;

  /** Register the sink that receives permission-request events. */
  setEventSink(sink: (event: BridgePermissionRequestEvent) => void): void {
    this.eventSink = sink;
  }

  /**
   * Called by the SDK adapter when query() invokes canUseTool.
   * Emits a permission-request event and blocks until respond() is called.
   */
  async request(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<boolean> {
    const requestId = randomUUID();

    if (!this.eventSink) {
      // No consumer listening — deny by default (NF-003).
      return false;
    }

    return new Promise<boolean>((resolve) => {
      this.pending.set(requestId, resolve);
      this.eventSink!({
        kind: "permission-request",
        requestId,
        toolName,
        toolInput,
      });
    });
  }

  /** External caller (e.g. Tauri IPC) resolves a pending permission request. */
  respond(requestId: string, allowed: boolean): void {
    const resolve = this.pending.get(requestId);
    if (resolve) {
      this.pending.delete(requestId);
      resolve(allowed);
    }
  }

  /** Deny all outstanding requests (used on abort / cleanup). */
  denyAll(): void {
    for (const [id, resolve] of this.pending) {
      resolve(false);
      this.pending.delete(id);
    }
  }
}
