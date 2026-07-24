// VerifyPanel — pure presentation component for the public certificate verify page.
// No business logic, no data fetching. All async work is in the RSC page layer.
// (CLAUDE.md §3: "No business logic in components — use hooks/services.")
//
// Three states (AC-H1, AC-H2, AC-H3/H4/H5):
//   valid    → green/valid visual (shield-check icon + "Certificate Verified" + program/date/holder)
//   revoked  → distinct revoked visual (shield-x icon + text + program info; NOT color-only)
//   invalid  → clean "This certificate could not be verified" (no internal details leaked)
//
// A11y (docs/07-design-system.md §11 + CLAUDE.md §3 rule 9, WCAG 2.2 AA):
//   - Semantic role="region" with aria-label on each state panel
//   - Status conveyed by icon + text label, NOT color alone (StatusChip pattern)
//   - role="status" aria-live="polite" on the status badge for screen readers
//   - All decorative SVGs aria-hidden="true"; functional icons have meaningful context
//   - Visible focus ring via Tailwind tokens
//
// Lucide icons: @repo/ui uses lucide-react but does not re-export icons.
// We use inline SVG shapes (copied from lucide) so apps/web has no direct
// lucide-react dependency (CLAUDE.md: "Do NOT install any dependency").
//
// No "use client" needed — this component is purely presentational with no hooks.

import * as React from "react";
import type { VerifyResult } from "@repo/types";
import { isCertificateSerial, normalizeCertificateSerial } from "@repo/types";
import { StatusChip, Card, CardContent, cn } from "@repo/ui";

import { CertificateDownloadButton } from "./certificate-download-button";

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icons (lucide-compatible paths) — avoids adding lucide-react
// as a direct dependency of apps/web.
// ─────────────────────────────────────────────────────────────────────────────

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ShieldXIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m14.5 9.5-5 5" />
      <path d="m9.5 9.5 5 5" />
    </svg>
  );
}

function ShieldAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function GraduationCapIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function HashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type VerifyState =
  | { kind: "valid"; result: Extract<VerifyResult, { valid: true }> }
  | { kind: "revoked"; result: Extract<VerifyResult, { valid: "revoked" }> }
  | { kind: "invalid" };

export interface VerifyPanelProps {
  state: VerifyState;
  certId: string;
  /** Test hook; defaults to "verify-panel" when omitted. */
  "data-testid"?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail row inside <dl>
// ─────────────────────────────────────────────────────────────────────────────

function DetailRow({
  icon,
  label,
  value,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium text-fg-muted">{label}</dt>
        <dd className="truncate text-sm font-medium text-fg" data-testid={testId}>
          {value}
        </dd>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components — one per state
// ─────────────────────────────────────────────────────────────────────────────

function ValidPanel({
  result,
  certId,
  serial,
}: {
  result: Extract<VerifyResult, { valid: true }>;
  certId: string;
  serial: string | null;
}) {
  return (
    <div
      data-testid="verify-panel-valid"
      role="region"
      aria-label="Certificate verification result: Valid"
      className="flex flex-col items-center gap-8"
    >
      {/* Status badge — icon + text + tone; never color-only (docs/07 §2 rule) */}
      <div
        className={cn(
          "flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl",
          "border border-success/30 bg-success/10 px-8 py-6 text-center",
        )}
        aria-live="polite"
        role="status"
      >
        {/* ShieldCheck — distinct icon from ShieldX (revoked) and ShieldAlert (invalid) */}
        <ShieldCheckIcon className="size-12 text-success" />
        {/* Text label — status is NOT color-only (a11y: icon shape + text convey meaning) */}
        <p className="text-lg font-semibold text-success" data-testid="verify-status-label">
          Certificate Verified
        </p>
        <StatusChip tone="success" label="Valid" size="sm" data-testid="verify-status-chip" />
        <p className="text-sm text-fg-muted">
          This is an authentic stimuliiq certificate.
        </p>
      </div>

      {/* Certificate details — only the 5 allowed fields (AC-H7) */}
      <Card className="w-full max-w-sm">
        <CardContent className="p-0">
          <dl aria-label="Certificate details" className="divide-y divide-border">
            <DetailRow
              icon={<GraduationCapIcon className="size-4 text-fg-muted" />}
              label="Program"
              value={result.program}
              testId="verify-program"
            />
            <DetailRow
              icon={<UserIcon className="size-4 text-fg-muted" />}
              label="Issued to"
              value={result.holderName}
              testId="verify-holder"
            />
            <DetailRow
              icon={<CalendarIcon className="size-4 text-fg-muted" />}
              label="Issue date"
              value={formatDate(result.issuedAt)}
              testId="verify-issued-at"
            />
            {serial ? (
              <DetailRow
                icon={<HashIcon className="size-4 text-fg-muted" />}
                label="Certificate ID"
                value={serial}
                testId="verify-serial"
              />
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {/* Only a VALID certificate is downloadable — the endpoint 410s a revoked one. */}
      <CertificateDownloadButton certUid={certId} />
    </div>
  );
}

function RevokedPanel({
  result,
  serial,
}: {
  result: Extract<VerifyResult, { valid: "revoked" }>;
  serial: string | null;
}) {
  return (
    <div
      data-testid="verify-panel-revoked"
      role="region"
      aria-label="Certificate verification result: Revoked"
      className="flex flex-col items-center gap-8"
    >
      {/* Distinct revoked visual — ShieldX icon (different path from ShieldCheck) + text */}
      <div
        className={cn(
          "flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl",
          "border border-danger/30 bg-danger/10 px-8 py-6 text-center",
        )}
        aria-live="polite"
        role="status"
      >
        {/* ShieldX — distinct shape AND different color from ShieldCheck — not color-only */}
        <ShieldXIcon className="size-12 text-danger" />
        <p className="text-lg font-semibold text-danger" data-testid="verify-status-label">
          Certificate Revoked
        </p>
        <StatusChip tone="danger" label="Revoked" size="sm" data-testid="verify-status-chip" />
        <p className="text-sm text-fg-muted">
          This certificate has been revoked and is no longer valid.
        </p>
      </div>

      {/* Show certificate details for context — still useful to confirm which cert */}
      <Card className="w-full max-w-sm opacity-70">
        <CardContent className="p-0">
          <dl aria-label="Certificate details" className="divide-y divide-border">
            <DetailRow
              icon={<GraduationCapIcon className="size-4 text-fg-muted" />}
              label="Program"
              value={result.program}
              testId="verify-program"
            />
            <DetailRow
              icon={<UserIcon className="size-4 text-fg-muted" />}
              label="Originally issued to"
              value={result.holderName}
              testId="verify-holder"
            />
            <DetailRow
              icon={<CalendarIcon className="size-4 text-fg-muted" />}
              label="Issue date"
              value={formatDate(result.issuedAt)}
              testId="verify-issued-at"
            />
            {serial ? (
              <DetailRow
                icon={<HashIcon className="size-4 text-fg-muted" />}
                label="Certificate ID"
                value={serial}
                testId="verify-serial"
              />
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function InvalidPanel({ certId }: { certId: string }) {
  return (
    <div
      data-testid="verify-panel-invalid"
      role="region"
      aria-label="Certificate verification result: Not found"
      className="flex flex-col items-center gap-6"
    >
      {/* ShieldAlert — distinct shape (exclamation mark) and tone (warning) — not color-only */}
      <div
        className={cn(
          "flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl",
          "border border-warning/30 bg-warning/10 px-8 py-6 text-center",
        )}
        aria-live="polite"
        role="status"
      >
        <ShieldAlertIcon className="size-12 text-warning" />
        <p className="text-lg font-semibold text-warning" data-testid="verify-status-label">
          Certificate Not Found
        </p>
        <StatusChip tone="warning" label="Not found" size="sm" data-testid="verify-status-chip" />
        <p className="text-sm text-fg-muted">
          This certificate could not be verified. The ID may be incorrect or the
          certificate may not exist.
        </p>
      </div>

      {/* Show the attempted ID for user to double-check — no internal details (AC-H3) */}
      <p className="text-center text-xs text-fg-subtle" data-testid="verify-attempted-id">
        <span className="sr-only">Attempted certificate ID: </span>
        <span className="font-mono">{certId}</span>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main VerifyPanel — routes to the three sub-panels
// ─────────────────────────────────────────────────────────────────────────────

export function VerifyPanel({
  state,
  certId,
  "data-testid": testId = "verify-panel",
}: VerifyPanelProps) {
  // The public verify response is deliberately minimal (AC-H7, 5 fields, no serial). When
  // the visitor arrived by TYPING the short serial, `certId` IS that serial — so we can
  // surface it as the human-readable "Certificate ID". When they arrived via the QR/link
  // (a long signed cert_uid), there is no short ID to show, so this stays null.
  const normalized = normalizeCertificateSerial(certId);
  const serial = isCertificateSerial(normalized) ? normalized : null;

  return (
    <div data-testid={testId} className="w-full">
      {state.kind === "valid" && <ValidPanel result={state.result} certId={certId} serial={serial} />}
      {state.kind === "revoked" && <RevokedPanel result={state.result} serial={serial} />}
      {state.kind === "invalid" && <InvalidPanel certId={certId} />}
    </div>
  );
}
