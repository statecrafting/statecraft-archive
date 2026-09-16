/**
 * Quick pane entry point.
 * Minimal floating input rendered in the quick-pane.html window.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import QuickPaneApp from "./components/QuickPaneApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QuickPaneApp />
  </React.StrictMode>
);
