import { Outlet } from "react-router";
import { SiteFooter, SiteHeader } from "~/components/site-chrome";

// Base layout: shared header + footer around every page (spec 001 §3).
export default function SiteLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
