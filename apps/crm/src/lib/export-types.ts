// Static export-type catalog shared by the Export creation drawer, the
// export jobs list filter, and the report-schedule creation drawer
// (docs/plans/phase-7.md Wave 3 task #15). The 8 "report" types mirror the
// WS-A dashboards 1:1 and are the ONLY types offered for scheduling
// (LOCK-D2 — scheduled dispatch reuses the P6 Resend sync-seam, and
// CreateReportScheduleDtoSchema's discriminated union only has these 8
// variants). The 4 "entity" types are raw entity-list exports, CSV only
// (Rule H-2/AC-28/31 — no separate/broader export query than the matching
// on-screen list), and are never offered for scheduling.
import type { ExportEntityType } from "@repo/types";

export interface ExportTypeInfo {
  value: ExportEntityType;
  label: string;
  group: "report" | "entity";
  /** csv is always available; pdf ("printable summary", AC-40) only for report-backed types. */
  pdfAllowed: boolean;
}

export const REPORT_EXPORT_TYPES: ExportTypeInfo[] = [
  { value: "revenue", label: "Revenue report", group: "report", pdfAllowed: true },
  { value: "enrollments", label: "Enrollment trend", group: "report", pdfAllowed: true },
  { value: "funnel", label: "Lead funnel", group: "report", pdfAllowed: true },
  { value: "engagement", label: "Course / video engagement", group: "report", pdfAllowed: true },
  { value: "campaigns", label: "Campaign performance", group: "report", pdfAllowed: true },
  { value: "gamification", label: "Gamification participation", group: "report", pdfAllowed: true },
  { value: "forum-health", label: "Forum health", group: "report", pdfAllowed: true },
];

export const ENTITY_EXPORT_TYPES: ExportTypeInfo[] = [
  { value: "students", label: "Students (directory)", group: "entity", pdfAllowed: false },
  { value: "leads", label: "Leads (pipeline)", group: "entity", pdfAllowed: false },
  { value: "payments", label: "Payments (ledger)", group: "entity", pdfAllowed: false },
  { value: "campaign-audience", label: "Campaign audience", group: "entity", pdfAllowed: false },
];

export const EXPORT_TYPES: ExportTypeInfo[] = [...REPORT_EXPORT_TYPES, ...ENTITY_EXPORT_TYPES];

export function exportTypeInfo(type: ExportEntityType): ExportTypeInfo | undefined {
  return EXPORT_TYPES.find((t) => t.value === type);
}

export function exportTypeLabel(type: ExportEntityType): string {
  return exportTypeInfo(type)?.label ?? type;
}
