import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { routes } from "./routes";
import "./styles.css";

const router = createBrowserRouter(routes);

const el = document.getElementById("root");
if (!el) throw new Error("missing #root element");

createRoot(el).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
