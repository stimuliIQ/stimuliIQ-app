// Renders the GET /me result with explicit loading / signed-out / error /
// success states (CLAUDE.md §4 DoD: "Loading / empty / error states
// implemented for every async UI"). Pure presentation — all data fetching
// lives in useMe().
"use client";

import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@repo/ui";

import { useMe } from "../hooks/use-me";

/** RBAC-aware demo: presentation-only permission check. The server (NestJS
 * guard + ScopeInterceptor) is the only real enforcement point — this only
 * decides whether to render a control the API would accept; it must never be
 * relied on for security (CLAUDE.md §3 rule 5, docs/04 §3.6). */
function hasPermission(permissions: { key: string }[] | undefined, key: string): boolean {
  return (permissions ?? []).some((grant) => grant.key === key);
}

export function AccountStatus() {
  const { me, isLoading, isSignedOut, isError, error, refetch } = useMe();

  if (isLoading) {
    return (
      <Card data-testid="account-status-loading" aria-busy="true" aria-live="polite">
        <CardHeader>
          <CardTitle>Checking your account…</CardTitle>
          <CardDescription>Loading your session.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2" role="status" aria-label="Loading account status">
            <div className="h-4 w-48 animate-pulse rounded bg-surface" />
            <div className="h-4 w-32 animate-pulse rounded bg-surface" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isSignedOut) {
    return (
      <Card data-testid="account-status-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>
            Sign in to view your enrollments, certificates, and account details.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild data-testid="account-sign-in-cta">
            <a href="/enroll">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="account-status-error">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "We couldn't load your account right now."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="account-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!me) {
    // Defensive fallback — query settled without data/error, which the SDK
    // contract treats as an upstream mismatch. Surface it like an error.
    return (
      <Card data-testid="account-status-empty">
        <CardHeader>
          <CardTitle>No account data</CardTitle>
          <CardDescription>We didn&apos;t receive any account details. Please try again.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="account-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const canManageBilling = hasPermission(me.permissions, "billing.manage");

  return (
    <Card data-testid="account-status-success">
      <CardHeader>
        <CardTitle>Welcome back, {me.user.name}</CardTitle>
        <CardDescription>{me.user.email}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <span className="text-sm font-medium text-fg-muted">Roles: </span>
          <span className="text-sm text-fg" data-testid="account-roles">
            {me.roles.join(", ")}
          </span>
        </div>
        {/* UI hides what the API forbids (CLAUDE.md §3 rule 5) — this control
            is presentation-only; GET/PATCH billing endpoints enforce
            `billing.manage` server-side regardless of whether it's rendered. */}
        {canManageBilling ? (
          <Button variant="secondary" size="sm" data-testid="account-manage-billing">
            Manage billing
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
