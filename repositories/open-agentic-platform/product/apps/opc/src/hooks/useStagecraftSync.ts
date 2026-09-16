/**
 * WebSocket bridge to Statecraft sync relay (spec 087 Phase 3).
 *
 * Connects to `GET /api/sync/events` on Statecraft and dispatches
 * incoming WorkspaceEvent messages. Handles reconnection with
 * exponential backoff. Provides postOpcEvent() for desktop-to-web sync.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { WorkspaceEvent, OpcEvent } from "@opc/workspace-sdk";

export interface StatecraftSyncOptions {
  /** Statecraft base URL (e.g. "https://statecraft.example.com"). */
  baseUrl: string | null;
  /** Auth token for the WebSocket connection. */
  token: string | null;
  /** Active org ID — connection is only opened when set. */
  orgId: string | null;
  /** Called for each incoming workspace event. */
  onEvent?: (event: WorkspaceEvent) => void;
}

export interface StatecraftSyncState {
  connected: boolean;
  /** POST an OPC event to Statecraft. No-op if not configured. */
  postOpcEvent: (event: OpcEvent) => Promise<void>;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function useStatecraftSync(opts: StatecraftSyncOptions): StatecraftSyncState {
  const { baseUrl, token, orgId, onEvent } = opts;
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!baseUrl || !token || !orgId) {
      // Not configured — close any existing connection.
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      return;
    }

    let disposed = false;

    function connect() {
      if (disposed) return;

      const wsUrl = baseUrl!
        .replace(/^http/, "ws")
        .replace(/\/$/, "");
      const url = `${wsUrl}/api/sync/events?orgId=${encodeURIComponent(orgId!)}&token=${encodeURIComponent(token!)}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) { ws.close(); return; }
        setConnected(true);
        backoffRef.current = INITIAL_BACKOFF_MS;
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as WorkspaceEvent;
          onEventRef.current?.(event);
        } catch {
          // Heartbeat or non-JSON — ignore.
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        wsRef.current = null;
        // Exponential backoff reconnect.
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after onerror — reconnect handled there.
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [baseUrl, token, orgId]);

  const postOpcEvent = useCallback(
    async (event: OpcEvent) => {
      if (!baseUrl || !token) return;
      const url = `${baseUrl.replace(/\/$/, "")}/api/sync/opc-events`;
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(event),
      });
    },
    [baseUrl, token],
  );

  return { connected, postOpcEvent };
}
