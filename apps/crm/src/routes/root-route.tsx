// Root route — mounts the CRM shell (nav + topbar) around every screen.
// Code-based route tree (not file-based codegen) per docs/04 §3.4: TanStack
// Router, kept simple for the P1 route surface (Students/Faculty/Courses).
// Wave 4b adds Batches + Admin routes as children of the same root.
import { createRootRoute, Outlet } from "@tanstack/react-router";

import { AppShell } from "../components/layout/app-shell";

export const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
