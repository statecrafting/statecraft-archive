import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Login, loginLoader } from "./login";

describe("Login route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the auth drivers the control plane reports", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false, drivers: ["mock"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const router = createMemoryRouter(
      [{ path: "/login", element: <Login />, loader: loginLoader }],
      { initialEntries: ["/login"] },
    );
    render(<RouterProvider router={router} />);

    // The loader runs asynchronously; wait for its data to render.
    expect(await screen.findByText("Mock: Casey User")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
