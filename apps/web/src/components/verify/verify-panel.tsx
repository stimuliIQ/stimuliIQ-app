// VerifyPanel — pure presentation component for the public certificate verify page.
// No business logic, no data fetching. All async work is in the RSC page layer.
// (CLAUDE.md §3: "No business logic in components — use hooks/services.")
//
// Three states (AC-H1, AC-H2, AC-H3/H4/H5):
//   valid    → a photo of the real certificate stock, filling the panel; the verdict text is
//              sr-only there (see StatusSeal), and the program/date/holder card sits beside it
//   revoked  → distinct revoked visual (struck seal, cross glyph + text + program info; NOT color-only)
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
// No "use client" needed — this component is purely presentational with no hooks. The
// scan-then-reveal intro (verify-reveal.tsx) IS a client island; this file hands it the
// server-rendered result to unveil, so the verdict is in the DOM whether or not it runs.

import * as React from "react";
import Image from "next/image";
import type { VerifyResult } from "@repo/types";
import { isCertificateSerial, normalizeCertificateSerial } from "@repo/types";
import { StatusChip, Card, CardContent, cn } from "@repo/ui";

import { SITE_NAME } from "../../lib/seo/metadata";
import { VerifyReveal } from "./verify-reveal";

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icons (lucide-compatible paths) — avoids adding lucide-react
// as a direct dependency of apps/web.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The verification seal's mark.
 *
 * A lucide shield reads as a security warning, which is the wrong register for a document
 * somebody earned. What a verified credential is stamped with is a SEAL: a milled rosette
 * edge, a double keyline, and one glyph in the middle. That is what this draws.
 *
 * The rosette is 24 shallow lobes on a radius-26 circle (arc radius = chord/2 x 1.45, so the
 * teeth are milled rather than scalloped like a flower). It is inlined as a literal rather
 * than computed at render time on purpose: this exact markup is produced BOTH by the server
 * and by the reveal's client overlay, and a trig round-trip that disagrees in the last ulp
 * between Node and the browser would be a hydration mismatch bought for nothing.
 */
const SEAL_ROSETTE_PATH =
  "M32.00 6.00 A4.92 4.92 0 0 1 38.73 6.89 A4.92 4.92 0 0 1 45.00 9.48 A4.92 4.92 0 0 1 50.38 13.62 A4.92 4.92 0 0 1 54.52 19.00 A4.92 4.92 0 0 1 57.11 25.27 A4.92 4.92 0 0 1 58.00 32.00 A4.92 4.92 0 0 1 57.11 38.73 A4.92 4.92 0 0 1 54.52 45.00 A4.92 4.92 0 0 1 50.38 50.38 A4.92 4.92 0 0 1 45.00 54.52 A4.92 4.92 0 0 1 38.73 57.11 A4.92 4.92 0 0 1 32.00 58.00 A4.92 4.92 0 0 1 25.27 57.11 A4.92 4.92 0 0 1 19.00 54.52 A4.92 4.92 0 0 1 13.62 50.38 A4.92 4.92 0 0 1 9.48 45.00 A4.92 4.92 0 0 1 6.89 38.73 A4.92 4.92 0 0 1 6.00 32.00 A4.92 4.92 0 0 1 6.89 25.27 A4.92 4.92 0 0 1 9.48 19.00 A4.92 4.92 0 0 1 13.62 13.62 A4.92 4.92 0 0 1 19.00 9.48 A4.92 4.92 0 0 1 25.27 6.89 A4.92 4.92 0 0 1 32.00 6.00Z";

/**
 * The three glyphs. They differ in SHAPE, not only in the tone they are painted with, which
 * is what keeps the three results distinguishable without colour (docs/07 §2, WCAG 1.4.1).
 */
const SEAL_GLYPHS = {
  check: <path d="M25 32.5 30.5 38 41 26.5" />,
  cross: <path d="m26.5 26.5 11 11M37.5 26.5l-11 11" />,
  alert: <path d="M32 23.5v10.5M32 40.5h.01" />,
} as const;

function SealMark({ glyph, className }: { glyph: keyof typeof SEAL_GLYPHS; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Milled edge, filled faintly then outlined, so the teeth read at small sizes */}
      <path d={SEAL_ROSETTE_PATH} fill="currentColor" fillOpacity="0.08" />
      <path d={SEAL_ROSETTE_PATH} stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.25" />
      {/* The double keyline every struck seal carries */}
      <circle cx="32" cy="32" r="20.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
      <circle cx="32" cy="32" r="17.25" stroke="currentColor" strokeOpacity="0.9" strokeWidth="1.5" />
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {SEAL_GLYPHS[glyph]}
      </g>
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
  index,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  testId: string;
  /** Position in the list — the settled reveal staggers the rows off this. */
  index: number;
}) {
  return (
    <div
      className="verify-row-in flex items-start gap-3 px-5 py-3.5"
      style={{ "--verify-row-delay": `${430 + index * 70}ms` } as React.CSSProperties}
    >
      <span className="mt-0.5 shrink-0 text-fg-subtle">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-semibold text-fg" data-testid={testId}>
          {value}
        </dd>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared pieces for the two "we found this certificate" states
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The certificate details card — identical structure for valid and revoked, only the
 * "Issued to" label and the card's emphasis differ. Sits beside the status seal on
 * desktop (md+) and stacks under it on mobile.
 */
function CertificateDetailsCard({
  result,
  serial,
  holderLabel,
  muted = false,
  className,
}: {
  result: Extract<VerifyResult, { valid: true } | { valid: "revoked" }>;
  serial: string | null;
  holderLabel: string;
  muted?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("h-full w-full", muted && "opacity-80", className)}>
      <CardContent className="flex h-full flex-col p-0">
        <p className="border-b border-border px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Certificate details
        </p>
        {/* Only the fields the public endpoint returns (AC-H7) */}
        <dl aria-label="Certificate details" className="divide-y divide-border">
          <DetailRow
            icon={<GraduationCapIcon className="size-4" />}
            label="Program"
            value={result.program}
            testId="verify-program"
            index={0}
          />
          <DetailRow
            icon={<UserIcon className="size-4" />}
            label={holderLabel}
            value={result.holderName}
            testId="verify-holder"
            index={1}
          />
          <DetailRow
            icon={<CalendarIcon className="size-4" />}
            label="Issue date"
            value={formatDate(result.issuedAt)}
            testId="verify-issued-at"
            index={2}
          />
          {serial ? (
            <DetailRow
              icon={<HashIcon className="size-4" />}
              label="Certificate ID"
              value={serial}
              testId="verify-serial"
              index={3}
            />
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * The status seal — the redesigned replacement for the old flat tinted box.
 *
 * A layered medallion (soft outer halo → tinted ring → solid disc → icon) reads as a stamp
 * rather than an alert banner, which is what a verification result actually is. Status is
 * still carried by icon SHAPE + text + chip, never by colour alone (docs/07 §2, WCAG 2.2 AA).
 */
const SEAL_TONES = {
  success: {
    panel: "border-success/25 bg-success/[0.07]",
    halo: "bg-success/15",
    ring: "ring-success/20",
    disc: "bg-success/10",
    mark: "text-success",
    eyebrow: "text-success/70",
    title: "text-success",
  },
  danger: {
    panel: "border-danger/25 bg-danger/[0.07]",
    halo: "bg-danger/15",
    ring: "ring-danger/20",
    disc: "bg-danger/10",
    mark: "text-danger",
    eyebrow: "text-danger/70",
    title: "text-danger",
  },
  warning: {
    panel: "border-warning/25 bg-warning/[0.07]",
    halo: "bg-warning/15",
    ring: "ring-warning/20",
    disc: "bg-warning/10",
    mark: "text-warning",
    eyebrow: "text-warning/80",
    title: "text-warning",
  },
} as const;

/**
 * The verified state's medallion is a PHOTOGRAPH of the real certificate stock — the milled
 * guilloche and the rosette a Stimuli IQ certificate is actually printed with — rather than
 * a drawn tick. A visitor arrives here holding (or looking at) that document, and matching
 * what they hold is a stronger claim than a generic check mark.
 *
 * It is used ONLY for `valid`. Revoked and not-found keep their drawn glyphs: those two must
 * stay tellable apart by SHAPE, and a photo that reads "certificate" would be exactly the
 * wrong thing to stamp on a withdrawn one. Status is still carried by the eyebrow, the title
 * and the chip in every state, so nothing here depends on the image loading, or on colour
 * (docs/07 §2, WCAG 1.4.1).
 */
const VERIFIED_SEAL_IMAGE = "/images/certificate-verified-seal.webp";

/**
 * The crop. The source is 4:3 and the band is 16:9, so `object-cover` trims the HEIGHT and
 * this Y value decides what survives. The rosette sits high in the frame (its centre is at
 * roughly 32% of the image), so a centred crop would slice its top off and fill the band
 * with the empty paper below it.
 *
 * A circle was tried first and abandoned: at 76px the crop is horizontal-only, which leaves
 * the rosette stuck near the top of the disc, and zooming enough to centre it makes it fill
 * the disc edge to edge. The artwork is a photograph of a rolled certificate — a band lets
 * it be that, instead of losing everything outside a 76px hole.
 */
const VERIFIED_SEAL_POSITION = "50% 32%";

function StatusSeal({
  tone,
  glyph,
  image,
  eyebrow,
  title,
  chip,
  description,
  className,
}: {
  tone: keyof typeof SEAL_TONES;
  glyph: "check" | "cross" | "alert";
  /** When set, the medallion shows this image instead of the drawn glyph. Decorative. */
  image?: string;
  /** The small tracked line above the title. Says what happened; the title says what it is. */
  eyebrow: string;
  title: string;
  chip: React.ReactNode;
  description: string;
  className?: string;
}) {
  const toneClasses = SEAL_TONES[tone];

  return (
    <div
      className={cn(
        // overflow-hidden so the banner can run to the card's rounded edges. The padding
        // moved onto the inner column: a full-bleed image cannot live inside px-6.
        "flex h-full w-full flex-col items-center overflow-hidden rounded-2xl border text-center",
        image ? "justify-start" : "justify-center",
        toneClasses.panel,
        className,
      )}
      aria-live="polite"
      role="status"
    >
      {image ? (
        <Image
          src={image}
          alt=""
          width={1448}
          height={1086}
          // This is the beat the whole reveal animation lands on, and it is above the fold
          // on the page's only purpose. Lazy-loading it would show an empty band at exactly
          // the moment the visitor is looking for the verdict.
          priority
          sizes="(min-width: 768px) 26rem, 92vw"
          // The photo IS the card in this state, so it fills the column: a 16:9 band when
          // stacked on mobile, stretched to match the details card beside it from md up.
          className="aspect-[16/9] w-full shrink-0 object-cover md:aspect-auto md:h-full md:flex-1"
          style={{ objectPosition: VERIFIED_SEAL_POSITION }}
        />
      ) : null}

      {/*
        WITH A PHOTO, THE WORDS ARE SCREEN-READER ONLY (product decision, 2026-08-30: the
        verified card is the certificate, nothing else). They are NOT deleted. The image is
        decorative (alt=""), so removing this block outright would leave this panel with no
        text alternative at all — a verdict conveyed only as a picture, announced to a
        screen reader as silence, and indistinguishable from the revoked panel to anyone
        who cannot see it (WCAG 1.1.1 / 1.4.1, and the a11y contract in this file header).
        `sr-only` keeps every word in the accessibility tree and paints none of it.
      */}
      <div
        className={cn(
          "flex w-full flex-1 flex-col items-center justify-center gap-5 px-6",
          image ? "sr-only" : "py-10",
        )}
      >
        {image ? null : (
          /* Medallion: halo, tinted disc, struck seal. All of it decorative — every word
             of the verdict is in the text below. */
          <span className="relative flex size-24 items-center justify-center" aria-hidden="true">
            <span className={cn("absolute inset-1 rounded-full blur-lg", toneClasses.halo)} />
            <span
              className={cn(
                "absolute inset-2 rounded-full ring-1",
                toneClasses.ring,
                toneClasses.disc,
              )}
            />
            <SealMark glyph={glyph} className={cn("relative size-[4.25rem]", toneClasses.mark)} />
          </span>
        )}

        <div className="flex flex-col items-center gap-2">
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.28em]",
              toneClasses.eyebrow,
            )}
          >
            {eyebrow}
          </p>
          {/* Text label — status is NOT colour-only */}
          <p
            className={cn("font-display text-2xl font-bold tracking-tight", toneClasses.title)}
            data-testid="verify-status-label"
          >
            {title}
          </p>
          {chip}
        </div>

        {/* text-balance: at this measure the sentence otherwise leaves two words alone on
            the last line, which is the one thing that makes a careful card look careless. */}
        <p className="max-w-[19rem] text-balance text-sm leading-relaxed text-fg-muted">
          {description}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components — one per state
// ─────────────────────────────────────────────────────────────────────────────

function ValidPanel({
  result,
  serial,
  scanId,
}: {
  result: Extract<VerifyResult, { valid: true }>;
  serial: string | null;
  scanId: string;
}) {
  // Rendered twice on purpose: once inside the reveal's overlay as the seal that lands at
  // the end of the scan, and once here as the settled result it hands over to. Identical
  // markup in the identical box is what makes the handover invisible.
  const seal = (
    <StatusSeal
      tone="success"
      glyph="check"
      image={VERIFIED_SEAL_IMAGE}
      eyebrow="Authenticity confirmed"
      title="Verified Authentic"
      chip={<StatusChip tone="success" label="Valid" size="sm" data-testid="verify-status-chip" />}
      description={`Issued by ${SITE_NAME} and confirmed against our records.`}
    />
  );

  return (
    <VerifyReveal tone="success" idText={scanId} seal={seal} layout="split">
      <div
        data-testid="verify-panel-valid"
        role="region"
        aria-label="Certificate verification result: Valid"
        // Seal and details sit side by side from md up, stacked below it.
        className="grid w-full items-stretch gap-5 md:grid-cols-2"
      >
        <StatusSeal
          tone="success"
          glyph="check"
          image={VERIFIED_SEAL_IMAGE}
          eyebrow="Authenticity confirmed"
          title="Verified Authentic"
          chip={<StatusChip tone="success" label="Valid" size="sm" data-testid="verify-status-chip" />}
          description={`Issued by ${SITE_NAME} and confirmed against our records.`}
          className="verify-settle-seal relative z-10"
        />
        <CertificateDetailsCard
          result={result}
          serial={serial}
          holderLabel="Issued to"
          className="verify-settle-details"
        />
      </div>
    </VerifyReveal>
  );
}

function RevokedPanel({
  result,
  serial,
  scanId,
}: {
  result: Extract<VerifyResult, { valid: "revoked" }>;
  serial: string | null;
  scanId: string;
}) {
  const seal = (
    <StatusSeal
      tone="danger"
      glyph="cross"
      eyebrow="Authenticity withdrawn"
      title="Certificate Revoked"
      chip={<StatusChip tone="danger" label="Revoked" size="sm" data-testid="verify-status-chip" />}
      description={`${SITE_NAME} has revoked this certificate. It is no longer valid.`}
    />
  );

  return (
    <VerifyReveal tone="danger" idText={scanId} seal={seal} layout="split">
      <div
        data-testid="verify-panel-revoked"
        role="region"
        aria-label="Certificate verification result: Revoked"
        className="grid w-full items-stretch gap-5 md:grid-cols-2"
      >
        <StatusSeal
          tone="danger"
          glyph="cross"
          eyebrow="Authenticity withdrawn"
          title="Certificate Revoked"
          chip={<StatusChip tone="danger" label="Revoked" size="sm" data-testid="verify-status-chip" />}
          description={`${SITE_NAME} has revoked this certificate. It is no longer valid.`}
          className="verify-settle-seal relative z-10"
        />
        {/* Details still shown, muted — useful to confirm which certificate this was */}
        <CertificateDetailsCard
          result={result}
          serial={serial}
          holderLabel="Originally issued to"
          muted
          className="verify-settle-details"
        />
      </div>
    </VerifyReveal>
  );
}

function InvalidPanel({ certId, scanId }: { certId: string; scanId: string }) {
  const seal = (
    <StatusSeal
      tone="warning"
      glyph="alert"
      eyebrow="No matching record"
      title="Certificate Not Found"
      chip={<StatusChip tone="warning" label="Not found" size="sm" data-testid="verify-status-chip" />}
      description={`No ${SITE_NAME} certificate carries this ID. Check the ID and try again.`}
    />
  );

  // "solo" — nothing to reveal beside the seal, so the scan cross-fades into it in place
  // rather than walking left out of centre.
  return (
    <VerifyReveal tone="warning" idText={scanId} seal={seal} layout="solo">
      <div
        data-testid="verify-panel-invalid"
        role="region"
        aria-label="Certificate verification result: Not found"
        className="flex flex-col items-center gap-6"
      >
        <div className="verify-settle-seal relative z-10 w-full max-w-sm">{seal}</div>

        {/* Show the attempted ID for the visitor to double-check — no internal details (AC-H3) */}
        <p className="text-center text-xs text-fg-subtle" data-testid="verify-attempted-id">
          <span className="sr-only">Attempted certificate ID: </span>
          <span className="font-mono">{certId}</span>
        </p>
      </div>
    </VerifyReveal>
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

  // What the reveal's scanner reads off the foot of the card. A typed serial is short and
  // is shown whole; a signed cert_uid from a QR/link is arbitrarily long, so it is clipped
  // to a strip's worth rather than being allowed to run out of the card.
  const scanId = serial ?? (certId.length > 24 ? `${certId.slice(0, 24)}…` : certId);

  return (
    <div data-testid={testId} className="w-full">
      {state.kind === "valid" && (
        <ValidPanel result={state.result} serial={serial} scanId={scanId} />
      )}
      {state.kind === "revoked" && (
        <RevokedPanel result={state.result} serial={serial} scanId={scanId} />
      )}
      {state.kind === "invalid" && <InvalidPanel certId={certId} scanId={scanId} />}
    </div>
  );
}
