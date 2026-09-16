// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052: React hook for consuming conversation-level durable event streams.

import { useCallback, useEffect, useRef, useState } from "react";

export interface PersistedEvent {
  event_id: number;
  workflow_id: string;
  timestamp: string;
  event_type: string;
  payload: unknown;
  scope?: string;
}

interface UseConversationEventsOptions {
  /** Base URL of the orchestrator HTTP server (e.g. "http://localhost:8080"). */
  baseUrl: string;
  /** Initial offset — only events with event_id > offset are returned. */
  offset?: number;
  /** Whether the subscription is active.  Set to false to disconnect. */
  enabled?: boolean;
}

interface UseConversationEventsResult {
  events: PersistedEvent[];
  isConnected: boolean;
  error: string | null;
  /** Clear accumulated events. */
  clear: () => void;
}

/**
 * Subscribe to conversation-scoped durable event streams via SSE.
 *
 * The orchestrator's `/conversations/:session_id/events?offset=N` endpoint
 * replays historical events then streams live events with deduplication.
 */
export function useConversationEvents(
  sessionId: string | null,
  options: UseConversationEventsOptions,
): UseConversationEventsResult {
  const { baseUrl, offset = 0, enabled = true } = options;
  const [events, setEvents] = useState<PersistedEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hwmRef = useRef(offset);
  const eventSourceRef = useRef<EventSource | null>(null);

  const clear = useCallback(() => {
    setEvents([]);
    hwmRef.current = offset;
  }, [offset]);

  useEffect(() => {
    if (!sessionId || !enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    const url = `${baseUrl}/conversations/${sessionId}/events?offset=${hwmRef.current}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    es.onmessage = (msg) => {
      try {
        const event: PersistedEvent = JSON.parse(msg.data);
        if (event.event_id <= hwmRef.current) return; // dedup
        hwmRef.current = event.event_id;
        setEvents((prev) => [...prev, event]);
      } catch {
        // Skip malformed events.
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      setError("Connection lost — will retry automatically.");
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [sessionId, baseUrl, enabled, offset]);

  return { events, isConnected, error, clear };
}
