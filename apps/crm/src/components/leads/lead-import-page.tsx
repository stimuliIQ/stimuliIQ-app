// Leads ▸ Import — bulk lead intake from a spreadsheet (Excel .xlsx/.xls or CSV).
//
// Flow: upload → parse client-side (SheetJS, dynamic import so the parser never
// weighs down the main bundle) → validated preview with per-row selection →
// import the selected rows through the SAME POST /crm/leads endpoint the "Add
// lead" form uses (server-side validation/RBAC/audit all apply per row) →
// optionally bulk-move the created leads to a chosen starting stage via the
// existing bulk endpoint. Nothing bypasses the API contract.
//
// Expected columns (header row, case-insensitive): name, phone, email, source.
// Extra columns are ignored. Phone normalization: spaces/dashes stripped; a bare
// 10-digit Indian mobile gets +91 prefixed.
import * as React from "react";
import { Alert, Button, PageHeader, Select, SelectItem, useToast } from "@repo/ui";
import { CreateLeadRequestSchema, type CreateLeadRequest, type LeadStage, type MeResponse } from "@repo/types";
import { Upload, FileSpreadsheet } from "lucide-react";

import { useCreateLead } from "../../hooks/use-leads";
import { useBulkMoveLeadsStage } from "../../hooks/use-bulk-saved-views";
import { hasPermission } from "../../lib/permissions";
import { LEAD_STAGE_COLUMNS } from "./lead-stage-chip";
import { queryErrorMessage } from "../../lib/surface-error";

interface LeadImportPageProps {
  me: MeResponse | undefined;
}

interface ParsedRow {
  index: number;
  name: string;
  phone: string;
  email: string;
  source: string;
  /** null = valid; otherwise the first validation problem, human-readable. */
  error: string | null;
  /** The contract-ready body when valid. */
  body: CreateLeadRequest | null;
}

interface ImportOutcome {
  created: number;
  failed: Array<{ name: string; reason: string }>;
  stageMoved: number;
}

/** Strip spaces/dashes/parens; prefix +91 to a bare 10-digit Indian mobile. */
function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
  return cleaned;
}

function toParsedRow(record: Record<string, unknown>, index: number): ParsedRow {
  const get = (key: string): string => {
    const found = Object.keys(record).find((k) => k.trim().toLowerCase() === key);
    const value = found ? record[found] : "";
    return value == null ? "" : String(value).trim();
  };

  const name = get("name");
  const phone = normalizePhone(get("phone"));
  const email = get("email");
  const source = get("source") || "excel-import";

  const candidate = {
    name,
    phone,
    ...(email ? { email } : {}),
    source,
  };
  const result = CreateLeadRequestSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".") || "row";
    return { index, name, phone, email, source, error: `${field}: ${issue?.message ?? "invalid"}`, body: null };
  }
  return { index, name, phone, email, source, error: null, body: result.data };
}

export function LeadImportPage({ me }: LeadImportPageProps): React.JSX.Element {
  const { toast } = useToast();
  const createLead = useCreateLead();
  const bulkMoveStage = useBulkMoveLeadsStage();

  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ParsedRow[]>([]);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [stage, setStage] = React.useState<LeadStage>("new");
  const [importing, setImporting] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [outcome, setOutcome] = React.useState<ImportOutcome | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);

  const canCreate = hasPermission(me?.permissions, "leads.create");

  async function handleFile(file: File) {
    setParseError(null);
    setOutcome(null);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("The file has no sheets.");
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]!, {
        defval: "",
      });
      if (records.length === 0) throw new Error("No data rows found under the header row.");
      const parsed = records.map((record, i) => toParsedRow(record, i));
      setRows(parsed);
      // Preselect every valid row.
      setSelected(new Set(parsed.filter((r) => r.error === null).map((r) => r.index)));
    } catch (err) {
      setRows([]);
      setSelected(new Set());
      setParseError(err instanceof Error ? err.message : "Couldn't read this file.");
    }
  }

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const validRows = rows.filter((r) => r.error === null);
  const selectedRows = validRows.filter((r) => selected.has(r.index));
  const allSelected = validRows.length > 0 && selectedRows.length === validRows.length;

  async function handleImport() {
    if (selectedRows.length === 0) return;
    setImporting(true);
    setProgress(0);
    const failed: ImportOutcome["failed"] = [];
    const createdIds: string[] = [];

    for (const [i, row] of selectedRows.entries()) {
      try {
        const created = await createLead.mutateAsync(row.body!);
        createdIds.push(created.id);
      } catch (err) {
        failed.push({
          name: row.name || `row ${row.index + 2}`,
          reason: queryErrorMessage(err, "The server rejected this row."),
        });
      }
      setProgress(i + 1);
    }

    let stageMoved = 0;
    if (stage !== "new" && createdIds.length > 0) {
      try {
        const result = await bulkMoveStage.mutateAsync({ ids: createdIds, stage });
        stageMoved = result.successCount;
      } catch {
        toast({ title: "Leads imported, but the stage update failed", description: "Use the Pipeline table's bulk actions to move them.", variant: "destructive" });
      }
    }

    setOutcome({ created: createdIds.length, failed, stageMoved });
    setImporting(false);
    toast({
      title: `Imported ${createdIds.length} of ${selectedRows.length} leads`,
      variant: failed.length === 0 ? "success" : "default",
    });
  }

  if (!canCreate) {
    return (
      <div className="space-y-4 md:space-y-5">
        <PageHeader title="Import Leads" description="Bulk-create leads from an Excel or CSV sheet." />
        <Alert tone="warning" title="No access" data-testid="lead-import-no-access">
          You need the leads.create permission to import leads.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="lead-import-page">
      <PageHeader
        title="Import Leads"
        description="Upload an Excel (.xlsx/.xls) or CSV sheet, review the parsed rows, pick the ones to import, and optionally start them at a stage."
      />

      <Alert tone="neutral" title="Sheet format" data-testid="lead-import-format-note">
        First row = headers. Recognized columns (case-insensitive): <strong>name</strong> and{" "}
        <strong>phone</strong> (required), <strong>email</strong>, <strong>source</strong> (defaults to
        &quot;excel-import&quot;). Extra columns are ignored. Bare 10-digit numbers get +91 automatically.
      </Alert>

      <label
        className="flex w-full max-w-2xl cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface/50 px-6 py-8 text-sm font-medium text-fg-muted transition-colors hover:bg-surface focus-within:ring-2 focus-within:ring-ring"
        data-testid="lead-import-dropzone"
      >
        <Upload className="size-5" aria-hidden="true" />
        {fileName ? (
          <span className="inline-flex items-center gap-1.5">
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            {fileName}, choose another file
          </span>
        ) : (
          "Choose an .xlsx / .xls / .csv file"
        )}
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
          data-testid="lead-import-file-input"
        />
      </label>

      {parseError ? (
        <Alert tone="danger" title="Couldn't read the file" data-testid="lead-import-parse-error">
          {parseError}
        </Alert>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-56">
              <Select
                label="Starting stage for imported leads"
                value={stage}
                onValueChange={(value) => setStage(value as LeadStage)}
                data-testid="lead-import-stage-select"
              >
                {LEAD_STAGE_COLUMNS.map((col) => (
                  <SelectItem key={col.id} value={col.id}>
                    {col.title}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <p className="text-sm text-fg-muted" aria-live="polite">
              {rows.length} rows parsed · {validRows.length} valid · {selectedRows.length} selected
              {importing ? ` · importing ${progress}/${selectedRows.length}…` : ""}
            </p>
            <Button
              onClick={handleImport}
              disabled={selectedRows.length === 0 || importing}
              loading={importing}
              data-testid="lead-import-submit"
            >
              Import {selectedRows.length} lead{selectedRows.length === 1 ? "" : "s"}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm" data-testid="lead-import-preview">
              <thead className="bg-surface text-left text-fg-muted">
                <tr>
                  <th scope="col" className="w-10 p-3">
                    <input
                      type="checkbox"
                      aria-label="Select all valid rows"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(validRows.map((r) => r.index)))
                      }
                    />
                  </th>
                  <th scope="col" className="p-3 font-medium">Name</th>
                  <th scope="col" className="p-3 font-medium">Phone</th>
                  <th scope="col" className="p-3 font-medium">Email</th>
                  <th scope="col" className="p-3 font-medium">Source</th>
                  <th scope="col" className="p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.index} className="border-t border-border">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.name || `row ${row.index + 2}`}`}
                        checked={selected.has(row.index)}
                        disabled={row.error !== null}
                        onChange={() => toggleRow(row.index)}
                      />
                    </td>
                    <td className="p-3 text-fg">{row.name || "-"}</td>
                    <td className="p-3 text-fg">{row.phone || "-"}</td>
                    <td className="p-3 text-fg">{row.email || "-"}</td>
                    <td className="p-3 text-fg">{row.source}</td>
                    <td className="p-3">
                      {row.error ? (
                        <span className="text-danger">{row.error}</span>
                      ) : (
                        <span className="text-success">Valid</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {outcome ? (
        <Alert
          tone={outcome.failed.length === 0 ? "success" : "warning"}
          title={`Imported ${outcome.created} lead${outcome.created === 1 ? "" : "s"}${
            stage !== "new" ? ` · ${outcome.stageMoved} moved to ${LEAD_STAGE_COLUMNS.find((c) => c.id === stage)?.title}` : ""
          }`}
          data-testid="lead-import-outcome"
        >
          {outcome.failed.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {outcome.failed.map((f, i) => (
                <li key={i}>
                  {f.name}: {f.reason}
                </li>
              ))}
            </ul>
          ) : (
            <>All selected rows were created. Open the Pipeline to work them. Its checkboxes support further bulk stage moves and owner assignment.</>
          )}
        </Alert>
      ) : null}
    </div>
  );
}
