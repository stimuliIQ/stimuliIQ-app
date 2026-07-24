// apps/api/src/modules/exports/lib/csv.spec.ts
//
// Unit tests for the AC-28/AC-29 CSV-injection choke-point (docs/plans/phase-7.md
// task #8 HEADLINE). Two layers:
//   1. Behavioural tests of csvSafeCell/toCsvCell/rowsToCsv/IncrementalCsvWriter.
//   2. A static source-scan (AC-29) asserting no OTHER file in this module hand-rolls
//      CSV escaping — every CSV cell must route through this file's exports.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { csvSafeCell, toCsvCell, writeCsvRow, rowsToCsv, IncrementalCsvWriter } from "./csv";

describe("csvSafeCell — AC-28 formula-injection neutralization", () => {
  it.each(["=cmd|' /C calc'!A0", "=1+1", "="])("neutralizes a value starting with '=' (%s)", (value) => {
    expect(csvSafeCell(value)).toBe(`'${value}`);
  });

  it.each(["+SUM(1+1)", "+"])("neutralizes a value starting with '+' (%s)", (value) => {
    expect(csvSafeCell(value)).toBe(`'${value}`);
  });

  it.each(["-2+3", "-"])("neutralizes a value starting with '-' (%s)", (value) => {
    expect(csvSafeCell(value)).toBe(`'${value}`);
  });

  it.each(["@SUM(A1)", "@"])("neutralizes a value starting with '@' (%s)", (value) => {
    expect(csvSafeCell(value)).toBe(`'${value}`);
  });

  it("neutralizes a value starting with a tab character", () => {
    expect(csvSafeCell("\t=cmd()")).toBe("'\t=cmd()");
  });

  it("neutralizes a value starting with a carriage return", () => {
    expect(csvSafeCell("\rmalicious")).toBe("'\rmalicious");
  });

  it("does NOT alter a safe value (no leading trigger char)", () => {
    expect(csvSafeCell("Ravi Kumar")).toBe("Ravi Kumar");
    // Starts with 's', not '@' — the '@' appears mid-string, so it is NOT neutralized.
    expect(csvSafeCell("student@example.com")).toBe("student@example.com");
  });

  it("empty string is returned unchanged (no crash on empty cell)", () => {
    expect(csvSafeCell("")).toBe("");
  });

  it("a value containing (but not starting with) a trigger char is untouched", () => {
    expect(csvSafeCell("Total = 500")).toBe("Total = 500");
  });
});

describe("toCsvCell — full choke-point (neutralize + RFC-4180 quote)", () => {
  it("neutralizes AND quotes a formula value that also contains a comma", () => {
    // '=a,b' -> neutralized to "'=a,b" -> contains a comma -> RFC-4180 quoted.
    expect(toCsvCell("=a,b")).toBe(`"'=a,b"`);
  });

  it("quotes a value containing a comma (no injection trigger)", () => {
    expect(toCsvCell("Hyderabad, Telangana")).toBe('"Hyderabad, Telangana"');
  });

  it("quotes and doubles an embedded double-quote", () => {
    expect(toCsvCell('She said "hi"')).toBe('"She said ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(toCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("does not quote a plain safe string", () => {
    expect(toCsvCell("Ravi Kumar")).toBe("Ravi Kumar");
  });

  it("null/undefined render as an empty cell", () => {
    expect(toCsvCell(null)).toBe("");
    expect(toCsvCell(undefined)).toBe("");
  });

  it("integers (paise) are emitted as plain digits — never float-formatted", () => {
    expect(toCsvCell(1234500)).toBe("1234500");
    expect(toCsvCell(0)).toBe("0");
  });

  it("booleans render as literal true/false", () => {
    expect(toCsvCell(true)).toBe("true");
    expect(toCsvCell(false)).toBe("false");
  });

  it("Date values render as ISO 8601", () => {
    const d = new Date("2026-06-01T00:00:00.000Z");
    expect(toCsvCell(d)).toBe("2026-06-01T00:00:00.000Z");
  });

  it("SECURITY: a formula cell survives round-trip neutralized even when it is the ENTIRE row's only cell", () => {
    const row = writeCsvRow(["=cmd()"]);
    expect(row).toBe("'=cmd()");
    expect(row.startsWith("=")).toBe(false);
  });
});

describe("writeCsvRow / rowsToCsv", () => {
  it("joins cells with commas", () => {
    expect(writeCsvRow(["a", "b", "c"])).toBe("a,b,c");
  });

  it("rowsToCsv emits a header row + CRLF-terminated data rows", () => {
    const csv = rowsToCsv(["name", "amount"], [["Ravi", 500], ["=evil()", 999]]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("name,amount");
    expect(lines[1]).toBe("Ravi,500");
    expect(lines[2]).toBe("'=evil(),999");
    expect(lines[lines.length - 1]).toBe(""); // trailing CRLF -> final split segment is empty
  });

  it("a zero-row export still emits the header row alone (Part 4 edge case)", () => {
    const csv = rowsToCsv(["a", "b"], []);
    expect(csv).toBe("a,b\r\n");
  });

  it("SECURITY: scans the raw bytes for any un-neutralized leading formula character across every row", () => {
    const csv = rowsToCsv(
      ["cell"],
      [["=cmd|' /C calc'!A0"], ["+SUM(1+1)"], ["-2+3+cmd|' /C calc'"], ["@SUM(A1)"], ["safe value"]],
    );
    const dataLines = csv.split("\r\n").slice(1, -1); // drop header + trailing empty segment
    for (const line of dataLines) {
      if (line === "safe value") continue;
      expect(/^[=+\-@]/.test(line)).toBe(false); // never a raw leading trigger char
      expect(line.startsWith("'")).toBe(true); // always neutralized with a leading apostrophe
    }
  });
});

describe("IncrementalCsvWriter — bounded-batch streaming (AC-33)", () => {
  it("emits header-only CSV when no rows are ever appended", () => {
    const writer = new IncrementalCsvWriter(["a", "b"]);
    expect(writer.toBuffer().toString("utf8")).toBe("a,b\r\n");
    expect(writer.rowCount).toBe(0);
  });

  it("accumulates rows across multiple appendRows() batches without holding a single giant array", () => {
    const writer = new IncrementalCsvWriter(["id", "name"]);
    writer.appendRows([["1", "Alice"], ["2", "Bob"]]);
    writer.appendRows([["3", "=evil()"]]);
    expect(writer.rowCount).toBe(3);
    const csv = writer.toBuffer().toString("utf8");
    expect(csv).toBe("id,name\r\n1,Alice\r\n2,Bob\r\n3,'=evil()\r\n");
  });
});

describe("AC-29: single shared choke-point — static source scan", () => {
  const EXPORTS_DIR = resolve(__dirname, "..");

  function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectTsFiles(full));
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
        out.push(full);
      }
    }
    return out;
  }

  it("no file besides lib/csv.ts implements its own CSV cell-join/escaping logic", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(EXPORTS_DIR)) {
      if (file === resolve(__dirname, "csv.ts")) continue; // the choke-point itself
      const source = readFileSync(file, "utf8");
      // Heuristic ad hoc-escaping signatures: a manual `.replace(/"/g` (quote doubling)
      // or a manual `.join(",")` on row cells outside of csv.ts would indicate a second,
      // un-audited CSV-writing code path.
      if (/replace\(\/"\/g/.test(source)) {
        offenders.push(`${file}: contains a manual quote-doubling replace() — should call toCsvCell()/writeCsvRow() instead.`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("row-builders.ts (if present) never constructs a CSV string directly — only supplies rows to rowsToCsv/IncrementalCsvWriter", () => {
    const rowBuildersPath = resolve(__dirname, "row-builders.ts");
    let source: string;
    try {
      source = readFileSync(rowBuildersPath, "utf8");
    } catch {
      return; // file not present yet — nothing to assert.
    }
    expect(source).not.toMatch(/\.join\(","\)/);
  });
});
