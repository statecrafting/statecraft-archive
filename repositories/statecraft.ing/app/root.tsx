import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Statecraft" },
  {
    name: "description",
    content:
      "Statecraft is a governed agentic delivery control plane and its product family. Spec-governed, open source, static by construction.",
  },
];

// No-flash theme init. Runs before first paint: applies `.dark` to <html> from
// a stored preference, falling back to the OS color-scheme. Inlined so the
// correct theme is set before the first paint (no flash of the wrong theme).
const THEME_INIT = `(function(){var s=null;try{s=localStorage.getItem('theme');}catch(e){}try{var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-24">
      <h1 className="font-mono text-2xl font-bold">{message}</h1>
      <p className="mt-2 text-muted-foreground">{details}</p>
      {stack && (
        <pre className="mt-6 w-full overflow-x-auto rounded-lg border border-border bg-card p-4 text-sm">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
