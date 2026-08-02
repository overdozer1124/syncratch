import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {performance} from "node:perf_hooks";
import {describe, expect, it} from "vitest";
import ExcelJS from "exceljs";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_COLS = 20;
const MAX_WORKSHEETS = 1;
const TIMEOUT_MS = 5000;
const MAX_RSS_DELTA_BYTES = 96 * 1024 * 1024;

function rssBytes(): number {
  return process.memoryUsage().rss;
}

async function readWorkbookGate(
  input: Uint8Array,
  abortMs = TIMEOUT_MS,
): Promise<{rows: string[][]; aborted: boolean}> {
  if (input.byteLength > MAX_BYTES) {
    throw new Error("file_too_large");
  }

  const workbook = new ExcelJS.Workbook();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortMs);
  try {
    await workbook.xlsx.load(input as unknown as ExcelJS.Buffer, {
      ignoreNodes: ["sheetProtection"],
    });
  } finally {
    clearTimeout(timer);
  }

  if (workbook.worksheets.length !== MAX_WORKSHEETS) {
    throw new Error("worksheet_count");
  }

  const sheet = workbook.worksheets[0]!;
  const rows: string[][] = [];
  sheet.eachRow({includeEmpty: false}, (row, rowNumber) => {
    if (rowNumber > MAX_ROWS + 1) {
      throw new Error("row_limit");
    }
    const values = row.values as Array<string | number | boolean | Date | null>;
    const cells = values.slice(1, MAX_COLS + 1).map(value => {
      if (value === null || value === undefined) return "";
      if (typeof value === "object" && "formula" in (value as object)) {
        throw new Error("formula_rejected");
      }
      return String(value);
    });
    rows.push(cells);
  });
  return {rows, aborted: controller.signal.aborted};
}

describe("exceljs XLSX safety spike", () => {
  it("accepts a small one-sheet workbook within gate limits", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("roster");
    sheet.addRow([
      "student_code",
      "display_name",
      "attendance_number",
      "login_name",
      "group_label",
      "active",
    ]);
    sheet.addRow(["S001", "山田太郎", "01", "yamada01", "A", "true"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(buffer.byteLength).toBeLessThan(MAX_BYTES);

    const before = rssBytes();
    const started = performance.now();
    const result = await readWorkbookGate(buffer);
    const elapsed = performance.now() - started;
    const after = rssBytes();

    expect(result.rows).toHaveLength(2);
    expect(elapsed).toBeLessThan(TIMEOUT_MS);
    expect(after - before).toBeLessThan(MAX_RSS_DELTA_BYTES);
  });

  it("rejects workbooks with formulas", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("roster");
    sheet.addRow(["student_code", "display_name"]);
    sheet.getCell("A2").value = {formula: "HYPERLINK(\"http://evil\")"};
    sheet.getCell("B2").value = "x";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(readWorkbookGate(buffer)).rejects.toThrow(/formula_rejected/);
  });

  it("survives malformed zip input without crashing the process", async () => {
    const root = mkdtempSync(join(tmpdir(), "xlsx-spike-bad-"));
    const badPath = join(root, "bad.xlsx");
    writeFileSync(badPath, "not-a-zip");
    const bad = Buffer.from("PK\x03\x04corrupt");
    await expect(readWorkbookGate(bad)).rejects.toThrow();
    rmSync(root, {recursive: true, force: true});
  });
});
