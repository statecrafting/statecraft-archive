/**
 * The Operators nav entry is the first consumer of me.roles in the SPA (spec
 * 011 §5.8): it appears only for a statecraft_operator. Server-side enforcement
 * is the truth; this gating is convenience, so the test asserts only presence.
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "../lib/api";

import { Root } from "./root";

function meWith(roles: string[]): Me {
  return {
    id: "u1",
    email: "op@example.com",
    name: "Operator",
    roles,
    ssoProvider: "rauthy",
    isActive: true,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function renderRoot(me: Me) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Root />,
        loader: () => ({ me }),
        children: [{ index: true, element: <div>home</div> }],
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("Operators nav gating", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the Operators link for a statecraft_operator", async () => {
    renderRoot(meWith(["user", "statecraft_operator"]));
    expect(await screen.findByRole("link", { name: "Operators" })).toBeInTheDocument();
  });

  it("hides the Operators link for a non-operator", async () => {
    renderRoot(meWith(["user"]));
    await screen.findByRole("link", { name: "Tenants" });
    expect(screen.queryByRole("link", { name: "Operators" })).toBeNull();
  });
});
