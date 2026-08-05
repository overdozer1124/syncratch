import {describe, expect, it} from "vitest";
import {parse} from "csv-parse/sync";
import {ROSTER_SHEET_COLUMNS} from "@blocksync/classroom-access";

describe("csv-parse roster import gate", () => {
  it("parses the canonical roster CSV contract", () => {
    const csv = [
      ROSTER_SHEET_COLUMNS.join(","),
      "S001,山田太郎,01,yamada01,,A,true",
    ].join("\n");
    const rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_quotes: true,
    }) as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      student_code: "S001",
      display_name: "山田太郎",
      attendance_number: "01",
      login_name: "yamada01",
      google_email: "",
      group_label: "A",
      active: "true",
    });
  });

  it("preserves leading zeros and quoted newlines", () => {
    const csv = [
      "student_code,display_name,attendance_number,login_name,group_label,active",
      'S002,"Line\nBreak",007,yamada02,B,false',
    ].join("\n");
    const rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
    }) as Array<Record<string, string>>;
    expect(rows[0]?.attendance_number).toBe("007");
    expect(rows[0]?.display_name).toBe("Line\nBreak");
  });
});
