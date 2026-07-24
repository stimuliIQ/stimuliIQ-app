"use client";

import * as React from "react";

import { cn } from "../lib/cn";
import { Checkbox } from "./checkbox";

/**
 * NotificationPrefsMatrix — a type×channel toggle grid + quiet-hours time picker.
 * Per docs/02-prd-lms.md §7.15, docs/03-prd-crm.md §7.16, docs/07 §11.
 *
 * Fully keyboard-navigable: all toggles are labelled checkboxes reachable via Tab.
 * The grid is a <table> so screen readers can announce both axes (row = type, col = channel).
 * Quiet-hours are optional; when enabled, two <input type="time"> fields appear.
 *
 * Presentational: passes changes up via `onMatrixChange`/`onQuietHoursChange` — no
 * internal state persistence. Caller owns the state and sends it to the API.
 *
 * Usage:
 *   <NotificationPrefsMatrix
 *     types={NOTIFICATION_TYPES}
 *     channels={NOTIFICATION_CHANNELS}
 *     matrix={prefs.matrix}
 *     quietHours={prefs.quietHours}
 *     onMatrixChange={(type, channel, enabled) =>
 *       updatePrefs({ type, channel, enabled })
 *     }
 *     onQuietHoursChange={(qh) => updateQuietHours(qh)}
 *   />
 */

export type NotificationChannel = "in_app" | "email" | "sms" | "whatsapp";

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: "In-app",
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

export interface NotificationTypeRow {
  type: string;
  label: string;
  /** Channels that cannot be disabled (e.g. in_app for announcements). */
  alwaysEnabled?: ReadonlyArray<NotificationChannel>;
}

/**
 * Nested map: matrix[type][channel] = enabled.
 * Matches the API's `NotificationPrefsDto.matrix` shape.
 */
export type NotificationMatrix = Record<string, Partial<Record<NotificationChannel, boolean>>>;

export interface QuietHoursConfig {
  start: string;  // "HH:MM" 24-hour
  end: string;    // "HH:MM" 24-hour
  tz?: string;    // IANA timezone, e.g. "Asia/Kolkata"
}

export interface NotificationPrefsMatrixProps {
  types: NotificationTypeRow[];
  channels?: NotificationChannel[];
  matrix: NotificationMatrix;
  quietHours?: QuietHoursConfig | null;
  /** Whether quiet-hours controls are shown. Default: true. */
  showQuietHours?: boolean;
  onMatrixChange: (type: string, channel: NotificationChannel, enabled: boolean) => void;
  onQuietHoursChange?: (quietHours: QuietHoursConfig | null) => void;
  loading?: boolean;
  className?: string;
  /** Test hook; defaults to "notification-prefs-matrix". */
  "data-testid"?: string;
}

const DEFAULT_CHANNELS: NotificationChannel[] = ["in_app", "email", "sms", "whatsapp"];

export function NotificationPrefsMatrix({
  types,
  channels = DEFAULT_CHANNELS,
  matrix,
  quietHours,
  showQuietHours = true,
  onMatrixChange,
  onQuietHoursChange,
  loading = false,
  className,
  "data-testid": testId,
}: NotificationPrefsMatrixProps): React.JSX.Element {
  const quietHoursEnabled = Boolean(quietHours);

  function handleQuietHoursToggle(enabled: boolean) {
    if (!onQuietHoursChange) return;
    if (enabled) {
      onQuietHoursChange({ start: "22:00", end: "08:00" });
    } else {
      onQuietHoursChange(null);
    }
  }

  function handleQuietHoursTime(field: "start" | "end", value: string) {
    if (!onQuietHoursChange || !quietHours) return;
    onQuietHoursChange({ ...quietHours, [field]: value });
  }

  return (
    <div
      data-testid={testId ?? "notification-prefs-matrix"}
      className={cn("flex flex-col gap-6", loading && "pointer-events-none opacity-60", className)}
      aria-busy={loading}
    >
      {/* Type × Channel grid */}
      <div className="overflow-x-auto">
        <table
          className="w-full min-w-[28rem] border-collapse text-sm"
          aria-label="Notification delivery preferences"
        >
          <caption className="sr-only">
            Toggle which notification types are delivered through which channels.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-48 pb-3 pr-4 text-left font-medium text-fg-muted"
              >
                Notification type
              </th>
              {channels.map((ch) => (
                <th
                  key={ch}
                  scope="col"
                  className="pb-3 px-2 text-center font-medium text-fg-muted"
                >
                  {NOTIFICATION_CHANNEL_LABELS[ch]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {types.map((row) => (
              <tr key={row.type} className="group">
                <th
                  scope="row"
                  className="py-3 pr-4 text-left text-sm font-normal text-fg"
                >
                  {row.label}
                </th>
                {channels.map((ch) => {
                  const isAlways = row.alwaysEnabled?.includes(ch) ?? false;
                  const checked = isAlways || (matrix[row.type]?.[ch] ?? false);
                  return (
                    <td key={ch} className="py-3 px-2 text-center">
                      <Checkbox
                        aria-label={`${row.label} — ${NOTIFICATION_CHANNEL_LABELS[ch]}`}
                        checked={checked}
                        disabled={isAlways}
                        onCheckedChange={(val) =>
                          !isAlways && onMatrixChange(row.type, ch, val === true)
                        }
                        data-testid={`prefs-${row.type}-${ch}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Quiet hours */}
      {showQuietHours ? (
        <fieldset className="rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium text-fg">Quiet hours</legend>
          <p className="mt-1 text-xs text-fg-muted">
            During quiet hours, non-urgent notifications are held until the window ends.
            In-app notifications are always delivered.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={quietHoursEnabled}
                onCheckedChange={(val) => handleQuietHoursToggle(val === true)}
                aria-label="Enable quiet hours"
                data-testid="prefs-quiet-hours-toggle"
              />
              Enable quiet hours
            </label>

            {quietHoursEnabled && quietHours ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-fg-muted">From</span>
                  <input
                    type="time"
                    value={quietHours.start}
                    onChange={(e) => handleQuietHoursTime("start", e.target.value)}
                    aria-label="Quiet hours start time"
                    data-testid="prefs-quiet-start"
                    className={cn(
                      "rounded-md border border-border bg-card px-2 py-1 text-sm text-fg",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-fg-muted">To</span>
                  <input
                    type="time"
                    value={quietHours.end}
                    onChange={(e) => handleQuietHoursTime("end", e.target.value)}
                    aria-label="Quiet hours end time"
                    data-testid="prefs-quiet-end"
                    className={cn(
                      "rounded-md border border-border bg-card px-2 py-1 text-sm text-fg",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
