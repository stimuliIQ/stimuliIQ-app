// apps/api/src/modules/exports/providers/pdf/sync-report-pdf.adapter.ts
//
// Real ReportPdfPort adapter — renders a generic title + metadata + tabular-rows
// summary PDF, INLINE, using @react-pdf/renderer's renderToBuffer() (mirrors
// certificates/providers/pdf/sync-certificate-pdf.adapter.ts's "Sync" ADR-0020 seam:
// PDF generation happens in the request cycle; a future BullMQ `report-pdf-gen` worker
// would implement the same ReportPdfPort and be bound in its place with zero changes
// to ExportsService).
//
// NO JSX — the document tree is built with React.createElement (matches the
// certificates adapter; backend tsconfig needs no `jsx` compiler option).
//
// SECURITY (port contract): never logs any cell value (rows may carry PII for
// staff-facing gamification/campaign-audience exports); reads nothing from
// process.env; makes no external HTTP calls.

import { Injectable } from "@nestjs/common";
import { createElement as h, type ReactElement } from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReportPdfPort, ReportPdfInput, ReportPdfResult } from "./report-pdf-port.interface";

const styles = StyleSheet.create({
  page: { padding: 32, fontFamily: "Helvetica", fontSize: 9 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#555555", marginBottom: 8 },
  generatedAt: { fontSize: 8, color: "#888888", marginBottom: 12 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#333333", paddingBottom: 4, marginBottom: 2 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dddddd", paddingVertical: 2 },
  cellHeader: { flex: 1, fontFamily: "Helvetica-Bold", paddingRight: 4 },
  cell: { flex: 1, paddingRight: 4 },
  emptyNote: { fontSize: 9, color: "#888888", marginTop: 8, fontStyle: "italic" },
});

function buildDocument(input: ReportPdfInput): ReactElement<DocumentProps> {
  const headerRow = h(
    View,
    { key: "head", style: styles.tableHeaderRow, fixed: true },
    input.headers.map((header, i) => h(Text, { key: `h-${i}`, style: styles.cellHeader }, header)),
  );

  const dataRows = input.rows.map((row, rowIndex) =>
    h(
      View,
      { key: `r-${rowIndex}`, style: styles.tableRow },
      row.map((cell, cellIndex) => h(Text, { key: `c-${rowIndex}-${cellIndex}` , style: styles.cell }, cell)),
    ),
  );

  const emptyNote =
    input.rows.length === 0
      ? h(Text, { key: "empty", style: styles.emptyNote }, "No data for this range.")
      : null;

  return h(
    Document,
    { title: input.title },
    h(
      Page,
      { size: "A4", orientation: "landscape", style: styles.page, wrap: true },
      [
        h(Text, { key: "title", style: styles.title }, input.title),
        input.subtitle ? h(Text, { key: "subtitle", style: styles.subtitle }, input.subtitle) : null,
        h(Text, { key: "gen", style: styles.generatedAt }, `Generated: ${input.generatedAt}`),
        headerRow,
        ...dataRows,
        emptyNote,
      ],
    ),
  );
}

@Injectable()
export class SyncReportPdfAdapter implements ReportPdfPort {
  async render(input: ReportPdfInput): Promise<ReportPdfResult> {
    const bytes = await renderToBuffer(buildDocument(input));
    return { bytes, contentType: "application/pdf" };
  }
}
