import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { getEnvironmentInfo } from '@/lib/apiAdapter';
import type { ClaudeStreamMessage } from '../AgentExecution';

import { listen as tauriListen } from '@tauri-apps/api/event';

interface UseClaudeMessagesOptions {
  onSessionInfo?: (info: { sessionId: string; projectId: string }) => void;
  onTokenUpdate?: (tokens: number) => void;
  onStreamingChange?: (isStreaming: boolean, sessionId: string | null) => void;
}

export function useClaudeMessages(options: UseClaudeMessagesOptions = {}) {
  const [messages, setMessages] = useState<ClaudeStreamMessage[]>([]);
  const [rawJsonlOutput, setRawJsonlOutput] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  const eventListenerRef = useRef<(() => void) | null>(null);
  const accumulatedContentRef = useRef<{ [key: string]: string }>({});

  const handleMessage = useCallback((message: ClaudeStreamMessage) => {
    const m = message as ClaudeStreamMessage & { tool_calls?: unknown[] };
    const t = m.type;

    // stream-json / SDK (system, assistant, user, result) + 045 bridge extras
    if (t === "system" && m.subtype === "init" && m.session_id) {
      accumulatedContentRef.current = {};
      setIsStreaming(true);
      setCurrentSessionId(m.session_id);
      options.onStreamingChange?.(true, m.session_id);
      options.onSessionInfo?.({
        sessionId: m.session_id,
        projectId: typeof m.cwd === "string" ? m.cwd : "",
      });
    } else if (t === "assistant") {
      const usage = m.message?.usage ?? m.usage;
      if (usage) {
        const totalTokens =
          (usage.input_tokens || 0) + (usage.output_tokens || 0);
        options.onTokenUpdate?.(totalTokens);
      }
      const toolCalls = m.message?.tool_calls ?? m.tool_calls;
      if (Array.isArray(toolCalls)) {
        toolCalls.forEach((toolCall: Record<string, unknown>) => {
          if (
            toolCall.content != null &&
            toolCall.partial_tool_call_index !== undefined
          ) {
            const key = `tool-${String(toolCall.partial_tool_call_index)}`;
            if (!accumulatedContentRef.current[key]) {
              accumulatedContentRef.current[key] = "";
            }
            accumulatedContentRef.current[key] += String(toolCall.content);
            toolCall.accumulated_content = accumulatedContentRef.current[key];
          }
        });
      }
    } else if (t === "result") {
      const inTok = m.total_input_tokens ?? 0;
      const outTok = m.total_output_tokens ?? 0;
      if (inTok + outTok > 0) {
        options.onTokenUpdate?.(inTok + outTok);
      }
      if (m.session_id) {
        setCurrentSessionId(m.session_id);
      }
      setIsStreaming(false);
      options.onStreamingChange?.(false, m.session_id ?? currentSessionId);
    } else if (t === "error") {
      setIsStreaming(false);
      options.onStreamingChange?.(false, currentSessionId);
    } else if (t === "bridge_permission_request") {
      // Listed in UI via `messages`; permission UI can subscribe separately later
    } else if (t === "start") {
      accumulatedContentRef.current = {};
      setIsStreaming(true);
      options.onStreamingChange?.(true, currentSessionId);
    } else if (t === "partial") {
      const toolCalls = m.message?.tool_calls ?? m.tool_calls;
      if (Array.isArray(toolCalls)) {
        toolCalls.forEach((toolCall: Record<string, unknown>) => {
          if (
            toolCall.content != null &&
            toolCall.partial_tool_call_index !== undefined
          ) {
            const key = `tool-${String(toolCall.partial_tool_call_index)}`;
            if (!accumulatedContentRef.current[key]) {
              accumulatedContentRef.current[key] = "";
            }
            accumulatedContentRef.current[key] += String(toolCall.content);
            toolCall.accumulated_content = accumulatedContentRef.current[key];
          }
        });
      }
    } else if (t === "response" && m.message?.usage) {
      const totalTokens =
        (m.message.usage.input_tokens || 0) +
        (m.message.usage.output_tokens || 0);
      options.onTokenUpdate?.(totalTokens);
    } else if (t === "response") {
      setIsStreaming(false);
      options.onStreamingChange?.(false, currentSessionId);
    } else if (
      t === "session_info" &&
      typeof m.session_id === "string" &&
      typeof m.project_id === "string"
    ) {
      options.onSessionInfo?.({
        sessionId: m.session_id,
        projectId: m.project_id,
      });
      setCurrentSessionId(m.session_id);
    }

    setMessages((prev) => [...prev, message]);
    setRawJsonlOutput((prev) => [...prev, JSON.stringify(message)]);
  }, [currentSessionId, options]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setRawJsonlOutput([]);
    accumulatedContentRef.current = {};
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const output = await api.getSessionOutput(parseInt(sessionId));
      // Note: API returns a string, not an array of outputs
      const outputs = [{ jsonl: output }];
      const loadedMessages: ClaudeStreamMessage[] = [];
      const loadedRawJsonl: string[] = [];
      
      outputs.forEach(output => {
        if (output.jsonl) {
          const lines = output.jsonl.split('\n').filter(line => line.trim());
          lines.forEach(line => {
            try {
              const msg = JSON.parse(line);
              loadedMessages.push(msg);
              loadedRawJsonl.push(line);
            } catch (e) {
              console.error("Failed to parse JSONL:", e);
            }
          });
        }
      });
      
      setMessages(loadedMessages);
      setRawJsonlOutput(loadedRawJsonl);
    } catch (error) {
      console.error("Failed to load session outputs:", error);
      throw error;
    }
  }, []);

  // Set up event listener
  useEffect(() => {
    const setupListener = async () => {
      console.log('[TRACE] useClaudeMessages setupListener called');
      if (eventListenerRef.current) {
        console.log('[TRACE] Cleaning up existing event listener');
        eventListenerRef.current();
      }
      
      const envInfo = getEnvironmentInfo();
      console.log('[TRACE] Environment info:', envInfo);
      
      if (envInfo.isTauri) {
        // Tauri mode - use Tauri's event system
        console.log('[TRACE] Setting up Tauri event listener for claude-output');
        eventListenerRef.current = await tauriListen("claude-output", (event: any) => {
          console.log('[TRACE] Tauri event received:', event);
          try {
            const message = JSON.parse(event.payload) as ClaudeStreamMessage;
            console.log('[TRACE] Parsed Tauri message:', message);
            handleMessage(message);
          } catch (error) {
            console.error("[TRACE] Failed to parse Claude stream message:", error);
          }
        });
        console.log('[TRACE] Tauri event listener setup complete');
      } else {
        // Web mode - use DOM events (these are dispatched by our WebSocket handler)
        console.log('[TRACE] Setting up web event listener for claude-output');
        const webEventHandler = (event: any) => {
          console.log('[TRACE] Web event received:', event);
          console.log('[TRACE] Event detail:', event.detail);
          try {
            const message = event.detail as ClaudeStreamMessage;
            console.log('[TRACE] Calling handleMessage with:', message);
            handleMessage(message);
          } catch (error) {
            console.error("[TRACE] Failed to parse Claude stream message:", error);
          }
        };
        
        window.addEventListener('claude-output', webEventHandler);
        console.log('[TRACE] Web event listener added for claude-output');
        console.log('[TRACE] Event listener function:', webEventHandler);

        eventListenerRef.current = () => {
          console.log('[TRACE] Removing web event listener');
          window.removeEventListener('claude-output', webEventHandler);
        };
      }
    };

    setupListener();

    return () => {
      console.log('[TRACE] useClaudeMessages cleanup');
      if (eventListenerRef.current) {
        eventListenerRef.current();
      }
    };
  }, [handleMessage]);

  return {
    messages,
    rawJsonlOutput,
    isStreaming,
    currentSessionId,
    clearMessages,
    loadMessages,
    handleMessage
  };
}