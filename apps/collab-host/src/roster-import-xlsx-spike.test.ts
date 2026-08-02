/**
 * exceljs API smoke test only — NOT a production XLSX safety gate.
 *
 * PR 1 decision: XLSX import is adoption-pending. CSV (`csv-parse`) is the
 * only confirmed import format at this stage. Full gate validation (ZIP bomb,
 * RSS ceiling, row/column/sheet limits, interruptibility) is deferred.
 */
import {describe, expect, it} from "vitest";
import ExcelJS from "exceljs";

describe("exceljs XLSX API smoke (not safety gate)", () => {
  it("loads a small one-sheet workbook", async () => {
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

    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(loaded.worksheets).toHaveLength(1);
    expect(loaded.worksheets[0]?.rowCount).toBeGreaterThanOrEqual(2);
  });

  it("rejects formula cells when inspected explicitly", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("roster");
    sheet.addRow(["student_code", "display_name"]);
    sheet.getCell("A2").value = {formula: "HYPERLINK(\"http://evil\")"};
    sheet.getCell("B2").value = "x";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const value = loaded.worksheets[0]?.getCell("A2").value;
    expect(typeof value).toBe("object");
    expect(value && typeof value === "object" && "formula" in value).toBe(true);
  });

  it("survives malformed zip input without crashing the process", async () => {
    const loaded = new ExcelJS.Workbook();
    const bad = Buffer.from("PK\x03\x04corrupt");
    await expect(
      loaded.xlsx.load(bad as unknown as ExcelJS.Buffer),
    ).rejects.toThrow();
  });
});
