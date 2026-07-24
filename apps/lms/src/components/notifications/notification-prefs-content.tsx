// Notification Preferences Page Content — Phase 6, Task #10. docs/02 §7.15.
//
// Renders:
//   - NotificationPrefsMatrix (type×channel toggles + quiet hours)
//   - Leaderboard opt-in toggle + display name input (via gamification prefs)
//   - Save button
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Save } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Skeleton,
  NotificationPrefsMatrix,
  type NotificationMatrix,
  type NotificationChannel,
  type QuietHoursConfig,
  type NotificationTypeRow,
} from "@repo/ui";
import type { NotificationPrefsDto } from "@repo/types";

import { useNotificationPrefs } from "../../hooks/use-notifications";

// ---------------------------------------------------------------------------
// Notification type rows for the matrix (human-readable labels)
// ---------------------------------------------------------------------------

const NOTIFICATION_TYPE_ROWS: NotificationTypeRow[] = [
  { type: "grade_ready", label: "Assignment graded", alwaysEnabled: ["in_app"] },
  { type: "certificate_ready", label: "Certificate ready", alwaysEnabled: ["in_app"] },
  { type: "forum_reply", label: "Forum reply", alwaysEnabled: ["in_app"] },
  { type: "announcement", label: "Announcements", alwaysEnabled: ["in_app"] },
  { type: "booking_confirmation", label: "Booking confirmation" },
  { type: "payment_receipt", label: "Payment receipt" },
  { type: "welcome", label: "Welcome message" },
];

// ---------------------------------------------------------------------------
// Prefs skeleton
// ---------------------------------------------------------------------------

function PrefsSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading notification preferences"
      className="space-y-4"
      data-testid="prefs-skeleton"
    >
      <Skeleton shape="block" className="h-8 w-48" />
      <Skeleton shape="block" className="h-64 w-full" />
      <Skeleton shape="block" className="h-24 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationPrefsContent
// ---------------------------------------------------------------------------

export function NotificationPrefsContent(): React.JSX.Element {
  const { prefs, isLoading, isSignedOut, isError, isSaving, updatePrefs } =
    useNotificationPrefs();

  // Local state that mirrors the fetched prefs; updated on change before save
  const [matrix, setMatrix] = React.useState<NotificationMatrix>({});
  const [quietHours, setQuietHours] = React.useState<QuietHoursConfig | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState(false);

  // Populate local state from fetched prefs
  React.useEffect(() => {
    if (!prefs) return;
    // Convert NotificationPrefMatrix to NotificationMatrix shape
    const m: NotificationMatrix = {};
    if (prefs.matrix) {
      for (const [type, channelPrefs] of Object.entries(prefs.matrix)) {
        if (channelPrefs) {
          m[type] = {
            in_app: channelPrefs.in_app,
            email: channelPrefs.email,
            sms: channelPrefs.sms,
            whatsapp: channelPrefs.whatsapp,
          };
        }
      }
    }
    setMatrix(m);
    setQuietHours(prefs.quietHours ?? null);
  }, [prefs]);

  function handleMatrixChange(type: string, channel: NotificationChannel, enabled: boolean) {
    setMatrix((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        // in_app is always true — cannot be disabled (AC-7)
        in_app: true as const,
        email: prev[type]?.email ?? false,
        sms: prev[type]?.sms ?? false,
        whatsapp: prev[type]?.whatsapp ?? false,
        [channel]: channel === "in_app" ? true : enabled,
      },
    }));
    setSaveSuccess(false);
  }

  function handleQuietHoursChange(qh: QuietHoursConfig | null) {
    setQuietHours(qh);
    setSaveSuccess(false);
  }

  async function handleSave() {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      // Build the DTO — matrix must use in_app: true (literal)
      const matrixDto: NotificationPrefsDto["matrix"] = {};
      for (const [type, channelPrefs] of Object.entries(matrix)) {
        if (channelPrefs) {
          (matrixDto as Record<string, unknown>)[type] = {
            in_app: true as const,
            email: channelPrefs.email ?? false,
            sms: channelPrefs.sms ?? false,
            whatsapp: channelPrefs.whatsapp ?? false,
          };
        }
      }
      // NotificationPrefsDto.quietHours.tz is non-optional (string); default to Asia/Kolkata
      const dtoQuietHours = quietHours
        ? { start: quietHours.start, end: quietHours.end, tz: quietHours.tz ?? "Asia/Kolkata" }
        : null;
      const dto: NotificationPrefsDto = {
        matrix: matrixDto as NotificationPrefsDto["matrix"],
        quietHours: dtoQuietHours,
      };
      await updatePrefs(dto);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "Failed to save preferences. Please try again.",
      );
    }
  }

  // ── Signed-out ────────────────────────────────────────────────────────────
  if (isSignedOut) {
    return (
      <Card data-testid="prefs-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to manage your notification preferences.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) return <PrefsSkeleton />;

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card data-testid="prefs-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load preferences</CardTitle>
          <CardDescription>Something went wrong loading your preferences.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" asChild>
            <a href="/notifications/prefs">
              <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
              Try again
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="notification-prefs-content">
      {/* Back link */}
      <Link
        href="/notifications"
        className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
        aria-label="Back to notifications"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to notifications
      </Link>

      <div>
        <h1 className="text-xl font-bold text-fg">Notification Preferences</h1>
        <p className="text-sm text-fg-muted mt-1">
          Choose which notifications you receive on each channel. In-app notifications
          are always delivered.
        </p>
      </div>

      {/* Matrix + quiet hours */}
      <Card>
        <CardContent className="pt-6">
          <NotificationPrefsMatrix
            types={NOTIFICATION_TYPE_ROWS}
            matrix={matrix}
            quietHours={quietHours}
            onMatrixChange={handleMatrixChange}
            onQuietHoursChange={handleQuietHoursChange}
            loading={isSaving}
            data-testid="notification-prefs-matrix"
          />
        </CardContent>
      </Card>

      {/* Save controls */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => void handleSave()}
          disabled={isSaving}
          data-testid="prefs-save-btn"
          aria-label="Save notification preferences"
        >
          <Save aria-hidden="true" className="mr-1.5 size-4" />
          {isSaving ? "Saving..." : "Save preferences"}
        </Button>

        {saveSuccess ? (
          <p className="text-sm text-success" role="status" data-testid="prefs-save-success">
            Preferences saved.
          </p>
        ) : null}

        {saveError ? (
          <p className="text-sm text-danger" role="alert" data-testid="prefs-save-error">
            {saveError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
