/**
 * QuickPaneApp — floating input panel shown via global shortcut.
 *
 * On submit: emits `quick-pane-submit` event to the main window so it can
 * inject the text into the active session, then dismisses itself.
 * On Escape / blur: dismisses without sending.
 */
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

export default function QuickPaneApp() {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus when the window becomes visible
  useEffect(() => {
    const focus = () => {
      setValue("");
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("focus", focus);
    focus();
    return () => window.removeEventListener("focus", focus);
  }, []);

  const dismiss = useCallback(() => {
    invoke("dismiss_quick_pane").catch(console.error);
  }, []);

  const submit = useCallback(async () => {
    const text = value.trim();
    if (text) {
      await emit("quick-pane-submit", { text });
    }
    dismiss();
  }, [value, dismiss]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [dismiss, submit]
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        padding: "12px 16px",
        background: "rgba(20, 20, 30, 0.92)",
        backdropFilter: "blur(20px)",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.12)",
        boxSizing: "border-box",
      }}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={dismiss}
        placeholder="Ask Claude… (Enter to send, Shift+Enter for newline)"
        rows={1}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "rgba(255,255,255,0.9)",
          fontSize: "14px",
          fontFamily: "inherit",
          resize: "none",
          lineHeight: "1.5",
        }}
      />
    </div>
  );
}
