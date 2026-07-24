"use client";

import * as React from "react";
import { AlertTriangle, Clock } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * CountdownTimer — server-authoritative countdown from `expiresAt` (an ISO timestamp or
 * Date object computed server-side), per docs/07-design-system.md §5/§7 and
 * docs/02-prd-lms.md §7.9 ("timed assessment, server time-box").
 *
 * Design rules (docs/07 §11):
 * - aria-live="polite" updates at sensible intervals (not every second), so screen
 *   readers don't interrupt constantly.
 * - Low-time state uses an icon + text color change — NOT color alone.
 * - prefers-reduced-motion: the visual pulsing on low-time is disabled; the countdown
 *   itself still ticks (it is functional, not decorative).
 * - `onExpire` is called when the countdown reaches 00:00. The component does NOT enforce
 *   the time-box (the server does); `onExpire` is a UI hint to submit / lock the UI.
 *
 * Reusable standalone — QuizRunner composes this.
 *
 * Usage:
 *   <CountdownTimer
 *     expiresAt={attempt.time_expires_at}
 *     onExpire={() => handleSubmit()}
 *     lowTimeThresholdSeconds={120}
 *   />
 */

export interface CountdownTimerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Server-computed expiry: ISO string or Date. The component computes remaining seconds
   * from `Date.now()` vs this value — the server is authoritative, this is display-only.
   */
  expiresAt: string | Date;
  /** Called once when the remaining time reaches 0. */
  onExpire?: () => void;
  /**
   * Seconds threshold below which the low-time visual state activates (icon + text color).
   * Defaults to 120 s (2 minutes).
   */
  lowTimeThresholdSeconds?: number;
  /**
   * How often (in seconds) to emit a polite aria-live announcement.
   * Defaults to announce at 5 min, 2 min, 1 min, 30 s, 10 s remaining.
   * Pass a custom list if the defaults don't match the quiz duration.
   */
  announceAtSeconds?: number[];
  /** Test hook; defaults to "countdown-timer" when omitted. */
  "data-testid"?: string;
}

/**
 * Format remaining seconds as "H:MM:SS" once an hour or more remains, otherwise "MM:SS".
 * Keeping the mm:ss shape under an hour preserves the familiar quiz-timer display (e.g. a
 * 30-minute quiz reads "29:58"); the hours segment only appears for long countdowns such
 * as the assessment retry cooldown, where mm:ss would otherwise overflow (e.g. "141:12").
 */
function formatRemaining(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Compute remaining seconds from now until expiresAt (floor, never negative). */
function computeRemaining(expiresAt: string | Date): number {
  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return Math.max(0, Math.floor((exp.getTime() - Date.now()) / 1000));
}

const DEFAULT_ANNOUNCE_AT = [300, 120, 60, 30, 10];

export function CountdownTimer({
  expiresAt,
  onExpire,
  lowTimeThresholdSeconds = 120,
  announceAtSeconds = DEFAULT_ANNOUNCE_AT,
  className,
  "data-testid": testId,
  ...props
}: CountdownTimerProps): React.JSX.Element {
  const [remaining, setRemaining] = React.useState<number>(() => computeRemaining(expiresAt));
  // The live region text is only updated at `announceAtSeconds` intervals to avoid
  // flooding screen readers with a new announcement every second.
  const [liveText, setLiveText] = React.useState<string>("");
  const expiredRef = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);
  React.useEffect(() => {
    onExpireRef.current = onExpire;
  });

  React.useEffect(() => {
    expiredRef.current = false;

    const tick = () => {
      const r = computeRemaining(expiresAt);
      setRemaining(r);

      // Announce at the configured intervals (once per crossing, not every second).
      if (announceAtSeconds.includes(r)) {
        const mins = Math.floor(r / 60);
        const secs = r % 60;
        const msg =
          r >= 60
            ? `${mins} minute${mins === 1 ? "" : "s"} remaining`
            : `${secs} second${secs === 1 ? "" : "s"} remaining`;
        setLiveText(msg);
      }

      if (r === 0 && !expiredRef.current) {
        expiredRef.current = true;
        setLiveText("Time is up.");
        onExpireRef.current?.();
        clearInterval(id);
      }
    };

    // Tick immediately so the display is correct before the first second elapses.
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, announceAtSeconds]);

  const isLow = remaining <= lowTimeThresholdSeconds && remaining > 0;
  const isExpired = remaining === 0;

  return (
    <div
      data-testid={testId ?? "countdown-timer"}
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    >
      {/* aria-live region: updates only at key intervals, not every second */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveText}
      </span>

      {/* Visual display — aria-hidden so the static clock text doesn't duplicate the
          live region announcement */}
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-sm font-medium tabular-nums",
          isExpired
            ? "border-danger/40 bg-danger/10 text-danger"
            : isLow
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border bg-surface text-fg",
          // Pulse animation on low-time; disabled for prefers-reduced-motion.
          isLow && !isExpired && "motion-safe:animate-pulse",
        )}
      >
        {isExpired ? (
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        {isExpired ? "Time up" : formatRemaining(remaining)}
      </span>

      {/* Visually hidden but always-present accessible label (not aria-live — just static
          context) so a screen reader user who focuses this element hears the exact value. */}
      <span className="sr-only">
        {isExpired
          ? "Time is up"
          : `Time remaining: ${formatRemaining(remaining)}`}
      </span>
    </div>
  );
}
