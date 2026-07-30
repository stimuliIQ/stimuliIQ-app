// CRM shell — collapsible sidebar + topbar wrapping every route (docs/03
// §10). Renders the explicit loading/signed-out/error states for the `me`
// fetch at the shell level so every page underneath can assume `me` is
// loaded and authenticated (CLAUDE.md §4: "loading/empty/error on every
// async UI"). `data-density="compact"` is set on the shell root per
// docs/03 §12 ("dense, professional" CRM styling) — every @repo/ui
// primitive consumes this via the `--density-*` tokens.
import * as React from "react";
import { useLocation } from "@tanstack/react-router";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui";

import { useMe } from "../../hooks/use-me";
import { useLogout } from "../../hooks/use-logout";
import { BranchScopeProvider } from "../../app/branch-scope";
import { AuthLayout } from "../auth/auth-layout";
import { LoginForm } from "../auth/login-form";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

// Password-reset (QA defect #5) must be reachable while signed out — that's
// the entire point of the flow. Every other route in this SPA is gated on
// `me` below; these two render their own full-page layout instead.
const PUBLIC_PATHS = new Set(["/forgot-password", "/reset-password"]);

export function AppShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const location = useLocation();
  const { me, isLoading, isSignedOut, isError, error, refetch } = useMe();
  const logout = useLogout();
  const [collapsed, setCollapsed] = React.useState(false);

  if (PUBLIC_PATHS.has(location.pathname)) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <AuthLayout>
        <Card data-testid="app-shell-loading" aria-busy="true" aria-live="polite" className="auth-card w-full">
          <CardHeader className="items-center text-center">
            <CardTitle>Loading Stimuli IQ admin…</CardTitle>
            <CardDescription>Checking your session.</CardDescription>
          </CardHeader>
        </Card>
      </AuthLayout>
    );
  }

  if (isSignedOut) {
    return <LoginForm />;
  }

  if (isError) {
    return (
      <AuthLayout>
        <Card data-testid="app-shell-error" className="auth-card w-full">
          <CardHeader className="items-center text-center">
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>
              {error?.problem?.detail ?? error?.problem?.title ?? "We couldn't load your session right now."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" onClick={refetch} data-testid="app-shell-retry" className="w-full">
              Try again
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <BranchScopeProvider me={me}>
      <div className="fixed inset-0 flex overflow-hidden bg-bg" data-density="compact" data-testid="app-shell">
        <Sidebar me={me} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar me={me} onLogout={() => logout.mutate()} loggingOut={logout.isPending} />
          <main id="main-content" className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </BranchScopeProvider>
  );
}
