"use client";

import * as React from "react";

import { cn } from "../lib/cn";
import { Skeleton } from "./skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/**
 * DetailShell — tabbed record-detail layout for the CRM student-360 profile
 * (Enrollments/Payments/Attendance/Certificates/Tickets/Timeline) and the batch detail
 * drawer (T19, docs/plans/phase-9-completion.md). A thin composition over the existing
 * `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` primitives (Radix Tabs — roving-tabindex
 * keyboard navigation, `tablist`/`tab`/`tabpanel` roles already handled there); this
 * component only owns the header chrome (avatar/title/meta/actions) + loading/error shell
 * so every record-detail surface looks identical without re-deriving the layout each time.
 *
 * a11y:
 * - Tab switching is fully keyboard-operable via Radix's roving tabindex (arrow keys,
 *   Home/End) — see `packages/ui/src/components/tabs.tsx`.
 * - The header title is an `<h1>` (or `headingLevel` override) so the record name is the
 *   page's primary landmark heading.
 * - Per-tab badges (e.g. "3 open tickets") are visible text, never color-only.
 * - Works inside both a full page and a `Drawer`/`DrawerBody` (batch detail drawer) — no
 *   assumptions about the surrounding chrome.
 *
 * Usage (CRM student 360):
 *   <DetailShell
 *     title={student.fullName}
 *     subtitle={student.email}
 *     avatar={<Avatar src={student.avatarUrl} />}
 *     meta={<StatusChip tone="success" label="Active" />}
 *     actions={<Button size="sm">Edit</Button>}
 *     tabs={[
 *       { value: "enrollments", label: "Enrollments", content: <EnrollmentsTab /> },
 *       { value: "payments", label: "Payments", content: <PaymentsTab /> },
 *       { value: "attendance", label: "Attendance", content: <AttendanceTab /> },
 *       { value: "certificates", label: "Certificates", content: <CertificatesTab /> },
 *       { value: "tickets", label: "Tickets", badge: <StatusChip tone="warning" label="2 open" size="sm" />, content: <TicketsTab /> },
 *       { value: "timeline", label: "Timeline", content: <TimelineTab /> },
 *     ]}
 *     defaultValue="enrollments"
 *     tabsAriaLabel="Student record sections"
 *   />
 */
export interface DetailShellTab {
  value: string;
  label: string;
  icon?: React.ReactNode;
  /** Small status/count indicator rendered after the label — always paired with text. */
  badge?: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
  /** Test hook for the trigger; defaults to `detail-shell-tab-{value}`. */
  "data-testid"?: string;
}

export interface DetailShellProps {
  /**
   * Optional: omit inside a `Drawer`, whose `DrawerContent` already renders the record's
   * title/description — passing it there rendered the name and email TWICE, stacked.
   * The whole header block is skipped when no header slot is supplied.
   */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  avatar?: React.ReactNode;
  /** Small inline row under the title (status chips, key facts). */
  meta?: React.ReactNode;
  /** Top-right action slot (buttons, kebab menu). */
  actions?: React.ReactNode;
  tabs: DetailShellTab[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  tabsAriaLabel?: string;
  headingLevel?: "h1" | "h2" | "h3";
  loading?: boolean;
  error?: string;
  className?: string;
  /** Test hook; defaults to "detail-shell" when omitted. */
  "data-testid"?: string;
}

export function DetailShell({
  title,
  subtitle,
  avatar,
  meta,
  actions,
  tabs,
  value,
  defaultValue,
  onValueChange,
  tabsAriaLabel = "Record sections",
  headingLevel = "h1",
  loading = false,
  error,
  className,
  "data-testid": testId,
}: DetailShellProps): React.JSX.Element {
  const Heading = headingLevel;
  const resolvedDefault = defaultValue ?? tabs[0]?.value;
  const hasHeader = Boolean(title || subtitle || avatar || meta || actions);

  if (loading) {
    return (
      <div data-testid={testId ?? "detail-shell"} aria-busy="true" aria-label="Loading record" className={cn("flex flex-col gap-6", className)}>
        <div className="flex items-center gap-4">
          <Skeleton shape="circle" className="size-12" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton shape="line" className="h-5 w-48" />
            <Skeleton shape="line" className="h-4 w-32" />
          </div>
        </div>
        <Skeleton shape="line" className="h-10 w-full max-w-md" />
        <Skeleton shape="block" className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid={testId ?? "detail-shell"} role="alert" className={cn("rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger", className)}>
        {error}
      </div>
    );
  }

  return (
    <div data-testid={testId ?? "detail-shell"} className={cn("flex flex-col gap-6", className)}>
      {/* Header — skipped entirely when the surrounding chrome (e.g. DrawerContent) owns it. */}
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {avatar ? <div className="shrink-0">{avatar}</div> : null}
            <div className="flex flex-col gap-1">
              {title ? <Heading className="text-lg font-semibold leading-heading text-fg">{title}</Heading> : null}
              {subtitle ? <p className="text-sm text-fg-muted">{subtitle}</p> : null}
              {meta ? <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div> : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      {/* Tabs */}
      <Tabs value={value} defaultValue={resolvedDefault} onValueChange={onValueChange}>
        <TabsList aria-label={tabsAriaLabel} className="flex-wrap">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              disabled={tab.disabled}
              data-testid={tab["data-testid"] ?? `detail-shell-tab-${tab.value}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.icon}
                {tab.label}
                {tab.badge}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} data-testid={`detail-shell-panel-${tab.value}`}>
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

DetailShell.displayName = "DetailShell";
