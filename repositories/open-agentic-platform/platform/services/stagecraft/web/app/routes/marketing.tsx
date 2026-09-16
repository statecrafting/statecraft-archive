import { Outlet } from "react-router";
import { SiteHeader, SiteFooter } from "../components/marketing-chrome";

// Pathless layout for the public marketing surface. Wraps every public page
// (Overview, Products, Papers, Registry, Get Started) in the shared header +
// footer so nav and theme stay consistent. Sign-in / app / admin routes are
// NOT nested here and keep their own chrome.
export default function MarketingLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
