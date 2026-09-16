import type { RouteObject } from "react-router";

import { Dashboard, dashboardLoader } from "./routes/dashboard";
import { RouteError } from "./routes/error";
import { Fleet, fleetAction, fleetLoader } from "./routes/fleet";
import { Login, loginLoader } from "./routes/login";
import { OperatorTenants, operatorTenantsLoader } from "./routes/operator/tenants";
import { Root, rootLoader } from "./routes/root";
import { StampNew, stampNewAction, stampNewLoader } from "./routes/stamp-new";
import { StampProgress, stampProgressLoader } from "./routes/stamp-progress";
import { TenantDetail, tenantDetailAction, tenantDetailLoader } from "./routes/tenant-detail";
import { TenantNew, tenantNewAction } from "./routes/tenant-new";

// One route tree, shared by the browser router (main.tsx) and the memory router
// used in component tests, so tests exercise exactly what ships.
export const routes: RouteObject[] = [
  {
    path: "/login",
    element: <Login />,
    loader: loginLoader,
    errorElement: <RouteError />,
  },
  {
    path: "/",
    element: <Root />,
    loader: rootLoader,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard />, loader: dashboardLoader },
      { path: "operator/tenants", element: <OperatorTenants />, loader: operatorTenantsLoader },
      { path: "tenants/new", element: <TenantNew />, action: tenantNewAction },
      {
        path: "tenants/:id",
        element: <TenantDetail />,
        loader: tenantDetailLoader,
        action: tenantDetailAction,
      },
      {
        path: "tenants/:id/stamps/new",
        element: <StampNew />,
        loader: stampNewLoader,
        action: stampNewAction,
      },
      { path: "stamps/:jobId", element: <StampProgress />, loader: stampProgressLoader },
      {
        path: "tenants/:id/fleet",
        element: <Fleet />,
        loader: fleetLoader,
        action: fleetAction,
      },
    ],
  },
];
