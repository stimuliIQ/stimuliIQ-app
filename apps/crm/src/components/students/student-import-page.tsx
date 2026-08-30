// Students ▸ Import — bulk student intake from a spreadsheet (Excel .xlsx/.xls
// or CSV). Mirrors leads/lead-import-page.tsx: client-side parse (SheetJS,
// dynamic import), zod-validated preview with per-row selection, rows created
// through the SAME POST /crm/students contract the "Add student" form uses —
// server-side validation / RBAC / audit apply per row. Accounts are created in
// the normal `invited` state; LMS credentials still go out at payment time.
//
// Expected columns (header row, case-insensitive): name, email, coursetype,
// phone, college, year, city, source. Extra columns are ignored.
import * as React from "react";
import { Alert, Button, PageHeader, useToast } from "@repo/ui";
import { CreateStudentRequestSchema, type CreateStudentRequest, type MeResponse } from "@repo/types";
import { Upload, FileSpreadsheet } from "lucide-react";

import { useCourseTypeOptions } from "../../hooks/use-course-types";
import { useCreateStudent } from "../../hooks/use-students";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage } from "../../lib/surface-error";

interface StudentImportPageProps {
  me: MeResponse | undefined;
}

interface ParsedRow {
  index: number;
  name: string;
  email: string;
  phone: string;
  courseType: string;
  college: string;
  year: string;
  city: string;
  error: string | null;
  body: CreateStudentRequest | null;
}

interface ImportOutcome {
  created: number;
  failed: Array<{ name: string; reason: string }>;
}

/** Strip spaces/dashes/parens; prefix +91 to a bare 10-digit Indian mobile. */
function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
  return cleaned;
}

/**
 * Match a free-typed sheet cell ("B.Tech", "b tech", "BTECH") against the tenant's OWN
 * course types, by label or by key, ignoring case and punctuation.
 *
 * This used to be a hardcoded ladder that funnelled anything unrecognised into "other".
 * That silently rewrote real answers: a sheet full of "MBBS" imported as six hundred
 * students whose qualification was recorded as Other, and nobody could tell afterwards.
 * An unmatched cell is now a ROW ERROR the importer can see and fix before anything is
 * written — see `toParsedRow`.
 */
function buildCourseTypeMatcher(options: { value: string; label: string }[]): (raw: string) => string {
  const compact = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byCompact = new Map<string, string>();
  for (const option of options) {
    byCompact.set(compact(option.label), option.value);
    byCompact.set(compact(option.value), option.value);
  }
  return (raw: string): string => byCompact.get(compact(raw)) ?? "";
}

function toParsedRow(
  record: Record<string, unknown>,
  index: number,
  matchCourseType: (raw: string) => string,
): ParsedRow {
  const get = (...keys: string[]): string => {
    for (const key of keys) {
      const found = Object.keys(record).find((k) => k.trim().toLowerCase().replace(/[\s_]/g, "") === key);
      if (found) {
        const value = record[found];
        if (value != null && String(value).trim() !== "") return String(value).trim();
      }
    }
    return "";
  };

  const name = get("name", "studentname", "fullname");
  const email = get("email", "emailid", "mail");
  const phone = normalizePhone(get("phone", "mobile", "phonenumber", "mobilenumber"));
  const courseTypeRaw = get("coursetype", "course", "program");
  const courseType = matchCourseType(courseTypeRaw);
  const college = get("college", "university", "collegename");
  const year = get("year", "yearofstudy");
  const city = get("city", "location");
  const source = get("source") || "excel-import";

  const candidate = {
    name,
    email,
    courseType,
    ...(phone ? { phone } : {}),
    ...(college ? { college } : {}),
    ...(year.trim() ? { year: Number(year) } : {}),
    ...(city ? { city } : {}),
    source,
  };
  // Reported before the zod parse so the message names the actual problem ("we do not
  // have a course type called MBBS") rather than "courseType: Invalid".
  if (!courseType) {
    const detail = courseTypeRaw
      ? `no course type matches "${courseTypeRaw}"`
      : "course type is missing";
    return {
      index, name, email, phone, courseType: courseTypeRaw, college, year, city,
      error: `courseType: ${detail}. Add it under Admin → Course types, or correct the sheet.`,
      body: null,
    };
  }

  const result = CreateStudentRequestSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".") || "row";
    return { index, name, email, phone, courseType, college, year, city, error: `${field}: ${issue?.message ?? "invalid"}`, body: null };
  }
  return { index, name, email, phone, courseType, college, year, city, error: null, body: result.data };
}

export function StudentImportPage({ me }: StudentImportPageProps): React.JSX.Element {
  const { toast } = useToast();
  const createStudent = useCreateStudent();

  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ParsedRow[]>([]);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [importing, setImporting] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [outcome, setOutcome] = React.useState<ImportOutcome | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);

  const canCreate = hasPermission(me?.permissions, "students.create");
  // The sheet is matched against the tenant's live options, so an import cannot invent a
  // qualification the CRM does not offer.
  const { options: courseTypeOptions } = useCourseTypeOptions();
  const matchCourseType = React.useMemo(() => buildCourseTypeMatcher(courseTypeOptions), [courseTypeOptions]);

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
      const parsed = records.map((record, i) => toParsedRow(record, i, matchCourseType));
      setRows(parsed);
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
    let created = 0;

    for (const [i, row] of selectedRows.entries()) {
      try {
        await createStudent.mutateAsync(row.body!);
        created += 1;
      } catch (err) {
        failed.push({
          name: row.name || `row ${row.index + 2}`,
          reason: queryErrorMessage(err, "The server rejected this row."),
        });
      }
      setProgress(i + 1);
    }

    setOutcome({ created, failed });
    setImporting(false);
    toast({
      title: `Imported ${created} of ${selectedRows.length} students`,
      variant: failed.length === 0 ? "success" : "default",
    });
  }

  if (!canCreate) {
    return (
      <div className="space-y-4 md:space-y-5">
        <PageHeader title="Import Students" description="Bulk-create student records from an Excel or CSV sheet." />
        <Alert tone="warning" title="No access" data-testid="student-import-no-access">
          You need the students.create permission to import students.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="student-import-page">
      <PageHeader
        title="Import Students"
        description="Upload an Excel (.xlsx/.xls) or CSV sheet, review the parsed rows, pick the ones to import. Every row is created through the same validated Add-student flow."
      />

      <Alert tone="neutral" title="Sheet format" data-testid="student-import-format-note">
        First row = headers. Recognized columns (case-insensitive): <strong>name</strong> and{" "}
        <strong>email</strong> (required), <strong>course type</strong> (must match one of your course types:{" "}
        {courseTypeOptions.length > 0 ? courseTypeOptions.map((o) => o.label).join(" / ") : "none set up yet"}),{" "}
        <strong>phone</strong>, <strong>college</strong>,{" "}
        <strong>year</strong>, <strong>city</strong>, <strong>source</strong>. Extra columns are ignored. Bare
        10-digit numbers get +91 automatically. LMS credentials are still emailed only when payment completes.
      </Alert>

      <label
        className="flex w-full max-w-2xl cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface/50 px-6 py-8 text-sm font-medium text-fg-muted transition-colors hover:bg-surface focus-within:ring-2 focus-within:ring-ring"
        data-testid="student-import-dropzone"
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
          data-testid="student-import-file-input"
        />
      </label>

      {parseError ? (
        <Alert tone="danger" title="Couldn't read the file" data-testid="student-import-parse-error">
          {parseError}
        </Alert>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm text-fg-muted" aria-live="polite">
              {rows.length} rows parsed · {validRows.length} valid · {selectedRows.length} selected
              {importing ? ` · importing ${progress}/${selectedRows.length}…` : ""}
            </p>
            <Button
              onClick={handleImport}
              disabled={selectedRows.length === 0 || importing}
              loading={importing}
              data-testid="student-import-submit"
            >
              Import {selectedRows.length} student{selectedRows.length === 1 ? "" : "s"}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm" data-testid="student-import-preview">
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
                  <th scope="col" className="p-3 font-medium">Email</th>
                  <th scope="col" className="p-3 font-medium">Phone</th>
                  <th scope="col" className="p-3 font-medium">Course</th>
                  <th scope="col" className="p-3 font-medium">College</th>
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
                    <td className="p-3 text-fg">{row.email || "-"}</td>
                    <td className="p-3 text-fg">{row.phone || "-"}</td>
                    <td className="p-3 text-fg">{row.courseType}</td>
                    <td className="p-3 text-fg">{row.college || "-"}</td>
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
          title={`Imported ${outcome.created} student${outcome.created === 1 ? "" : "s"}`}
          data-testid="student-import-outcome"
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
            <>All selected rows were created. They appear in the Students directory in the Admissions group.</>
          )}
        </Alert>
      ) : null}
    </div>
  );
}
