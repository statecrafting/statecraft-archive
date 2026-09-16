import { useEffect, useState } from "react";
import { Download, X, ExternalLink } from "lucide-react";
import { Button } from "@opc/ui/button";
import { commands, type UpdateInfo } from "@/lib/bindings";

const DISMISS_KEY_PREFIX = "opc.update.dismissed:";

function dismissKey(version: string) {
  return `${DISMISS_KEY_PREFIX}${version}`;
}

function firstLine(s: string, max = 140): string {
  const line = s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await commands.checkForUpdate();
      if (cancelled || result.status !== "ok") return;
      const dismissed =
        typeof window !== "undefined" &&
        window.localStorage.getItem(dismissKey(result.data.version)) === "1";
      if (!dismissed) setInfo(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const onInstall = async () => {
    setInstalling(true);
    setError(null);
    const result = await commands.downloadAndInstallUpdate(info.url, info.checksum);
    if (result.status === "error") {
      setInstalling(false);
      const e = result.error as { type?: string; message?: string };
      setError(
        e.type === "ChecksumMismatch"
          ? "Download checksum mismatch — try again later."
          : e.message ?? "Update failed."
      );
    }
  };

  const onDismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(info.version), "1");
    } catch {
      /* ignore */
    }
    setInfo(null);
  };

  return (
    <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm">
      <Download className="h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          OPC v{info.version} is available
        </div>
        {info.notes && (
          <div className="text-muted-foreground truncate">
            {firstLine(info.notes)}
          </div>
        )}
        {error && <div className="text-destructive">{error}</div>}
      </div>
      {info.notes && (
        <a
          href={`https://github.com/statecrafting/open-agentic-platform/releases/tag/v${info.version}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          Release notes
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      <Button size="sm" onClick={onInstall} disabled={installing}>
        {installing ? "Downloading…" : "Install"}
      </Button>
      <button
        type="button"
        onClick={onDismiss}
        disabled={installing}
        aria-label="Dismiss update notification"
        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
