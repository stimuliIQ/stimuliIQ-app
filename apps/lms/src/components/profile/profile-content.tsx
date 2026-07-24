// Profile & settings page content — Phase 9 Completion, T34
// (docs/plans/phase-9-completion.md, docs/02 §7.16 "Profile (photo, bio, skills,
// enrolled programs, certificates), settings (notification prefs, password,
// language, video quality default, theme), support/help desk, FAQ/help center").
//
// Password change: reuses the tokenized password-reset email flow (B9/T28) —
// there is no "current password" change endpoint in this API. See
// ../../hooks/use-profile-settings.ts for why.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import {
  Award,
  Bell,
  ChevronRight,
  KeyRound,
  LifeBuoy,
  LogOut,
  Moon,
  User as UserIcon,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  PageHeader,
  Select,
  SelectItem,
  Skeleton,
  StatusChip,
} from "@repo/ui";

import { useMe } from "../../hooks/use-me";
import { useLogout } from "../../hooks/use-logout";
import { useProfileSettings } from "../../hooks/use-profile-settings";
import {
  THEME_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
  LANGUAGE_OPTIONS,
  type ThemePreference,
  type VideoQualityPreference,
  type LanguagePreference,
} from "../../lib/user-prefs";

// ---------------------------------------------------------------------------
// Loading / signed-out / error states
// ---------------------------------------------------------------------------

function ProfileSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading profile" className="space-y-6">
      <Skeleton shape="block" className="h-24 w-full rounded-lg" />
      <Skeleton shape="block" className="h-48 w-full rounded-lg" />
      <Skeleton shape="block" className="h-32 w-full rounded-lg" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile summary card
// ---------------------------------------------------------------------------

function ProfileSummaryCard({ name, email, roles }: { name: string; email: string; roles: string[] }): React.JSX.Element {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Card data-testid="profile-summary-card" className="rounded-xl">
      <CardContent className="flex items-center gap-4 p-5">
        <div
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
        >
          {initials || <UserIcon className="size-6" strokeWidth={1.5} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-fg" data-testid="profile-name">
            {name}
          </p>
          <p className="truncate text-sm text-fg-muted" data-testid="profile-email">
            {email}
          </p>
          {roles.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <StatusChip key={r} tone="neutral" size="sm" label={r} />
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Appearance & playback settings card
// ---------------------------------------------------------------------------

function AppearanceCard(): React.JSX.Element {
  const { theme, setTheme, videoQuality, setVideoQuality, language, setLanguage } = useProfileSettings();

  return (
    <Card data-testid="profile-appearance-card" className="rounded-xl">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
          <Moon aria-hidden="true" className="size-4 text-fg-muted" />
          Appearance &amp; playback
        </CardTitle>
        <CardDescription>These preferences are saved on this device.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 p-5 pt-0 sm:grid-cols-3">
        <Select
          label="Theme"
          value={theme}
          onValueChange={(v) => setTheme(v as ThemePreference)}
          data-testid="profile-theme-select"
        >
          {THEME_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </Select>

        <Select
          label="Default video quality"
          value={videoQuality}
          onValueChange={(v) => setVideoQuality(v as VideoQualityPreference)}
          data-testid="profile-video-quality-select"
        >
          {VIDEO_QUALITY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </Select>

        <Select
          label="Language"
          value={language}
          onValueChange={(v) => setLanguage(v as LanguagePreference)}
          data-testid="profile-language-select"
        >
          {LANGUAGE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </Select>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Security card — password change via the reset-email flow
// ---------------------------------------------------------------------------

function SecurityCard({ email }: { email: string }): React.JSX.Element {
  const { requestPasswordReset, isRequestingReset, resetRequested, resetError } = useProfileSettings();

  return (
    <Card data-testid="profile-security-card" className="rounded-xl">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
          <KeyRound aria-hidden="true" className="size-4 text-fg-muted" />
          Password
        </CardTitle>
        <CardDescription>
          We&apos;ll email a secure link to <span className="font-medium text-fg">{email}</span> to set a new
          password.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex items-center gap-3 p-5 pt-0">
        <Button
          variant="secondary"
          onClick={() => void requestPasswordReset(email)}
          disabled={isRequestingReset || !email}
          aria-busy={isRequestingReset || undefined}
          data-testid="profile-change-password-btn"
        >
          {isRequestingReset ? "Sending…" : "Send password reset link"}
        </Button>
        {resetRequested ? (
          <p role="status" className="text-sm text-success" data-testid="profile-reset-sent">
            Check your inbox for a reset link.
          </p>
        ) : null}
        {resetError ? (
          <p role="alert" className="text-sm text-danger" data-testid="profile-reset-error">
            {resetError.problem.detail ?? "Couldn't send the reset email. Please try again."}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quick links — notification prefs, support, certificates
// ---------------------------------------------------------------------------

function QuickLinksCard(): React.JSX.Element {
  const links = [
    { href: "/notifications/prefs", label: "Notification preferences", Icon: Bell, testId: "profile-link-notifications" },
    { href: "/support", label: "Support / help desk", Icon: LifeBuoy, testId: "profile-link-support" },
    { href: "/certificates", label: "My certificates", Icon: Award, testId: "profile-link-certificates" },
  ] as const;

  return (
    <Card data-testid="profile-quick-links-card" className="rounded-xl">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
          More
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {links.map(({ href, label, Icon, testId }) => (
            <li key={href}>
              <Link
                href={href}
                data-testid={testId}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="flex items-center gap-2.5">
                  <Icon aria-hidden="true" className="size-4 text-fg-muted" />
                  {label}
                </span>
                <ChevronRight aria-hidden="true" className="size-4 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sign-out card
// ---------------------------------------------------------------------------

function SignOutCard(): React.JSX.Element {
  const logout = useLogout();

  return (
    <Card data-testid="profile-signout-card" className="rounded-xl">
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
          <LogOut aria-hidden="true" className="size-4 text-fg-muted" />
          Sign out
        </CardTitle>
        <CardDescription>End your session on this device.</CardDescription>
      </CardHeader>
      <CardFooter className="p-5 pt-0">
        <Button
          variant="secondary"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-busy={logout.isPending || undefined}
          data-testid="profile-signout-btn"
        >
          {logout.isPending ? "Signing out…" : "Sign out"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ProfileContent
// ---------------------------------------------------------------------------

export function ProfileContent(): React.JSX.Element {
  const { me, isLoading, isSignedOut, isError, error, refetch } = useMe();

  if (isLoading) return <ProfileSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="profile-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to view your profile and settings.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError || !me) {
    return (
      <Card data-testid="profile-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load your profile</CardTitle>
          <CardDescription>{error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="profile-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 md:space-y-8" data-testid="profile-content">
      <PageHeader
        title="Profile & Settings"
        description="Manage your account, preferences, and security."
      />
      <div className="space-y-4">
        <ProfileSummaryCard name={me.user.name} email={me.user.email} roles={me.roles} />
        <AppearanceCard />
        <SecurityCard email={me.user.email} />
        <QuickLinksCard />
        <SignOutCard />
      </div>
    </div>
  );
}
