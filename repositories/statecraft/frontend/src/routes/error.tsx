import { isRouteErrorResponse, Link, useRouteError } from "react-router";

import { ApiError } from "../lib/api";

/** Route-level error boundary: renders API and unexpected errors legibly. */
export function RouteError() {
  const error = useRouteError();

  let title = "Something went wrong";
  let detail = "";

  if (error instanceof ApiError) {
    title = `Request failed (${error.status})`;
    detail = error.message;
  } else if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    detail = typeof error.data === "string" ? error.data : "";
  } else if (error instanceof Error) {
    detail = error.message;
  }

  return (
    <main className="container">
      <div className="card">
        <h2 className="error">{title}</h2>
        {detail && <p className="muted">{detail}</p>}
        <p>
          <Link to="/">Back to tenants</Link>
        </p>
      </div>
    </main>
  );
}
