import { useState } from "react";

// Spec 112 §6.3 — "Open in OPC" handoff button.
//
// Renders the precomputed `opc://` deep link as a click target plus a
// small disclosure that:
//   - shows the raw deep link (copy-paste fallback for users who
//     haven't yet installed OPC),
//   - links to the OPC install affordance.
//
// We do not detect OPC presence here — the deep link itself is the
// detection: if OPC is registered for the scheme the click activates
// the desktop, otherwise the browser surfaces "no app to handle this
// link" which is when the disclosure becomes useful.

interface Props {
  deepLink: string;
  adapterName: string | null;
}

const OPC_INSTALL_URL = "https://github.com/statecrafting/open-agentic-platform/releases";

export function OpenInOpcButton({ deepLink, adapterName }: Props) {
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — leave the link visible for manual copy.
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <a
        href={deepLink}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        title={
          adapterName
            ? `Hand this project to OPC (adapter: ${adapterName})`
            : "Hand this project to OPC"
        }
      >
        <span>Open in OPC</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          className="w-3.5 h-3.5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
      </a>
      <button
        type="button"
        onClick={() => setShowFallback((v) => !v)}
        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
      >
        {showFallback ? "Hide deep link" : "Don't have OPC?"}
      </button>
      {showFallback && (
        <div className="flex flex-col items-end gap-1 text-xs">
          <code className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono select-all max-w-md break-all text-right">
            {deepLink}
          </code>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <a
              href={OPC_INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Install OPC
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
