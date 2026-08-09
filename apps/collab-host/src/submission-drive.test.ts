import {describe, expect, it} from "vitest";
import {
  buildSubmissionSb3FileName,
  formatSubmissionTimestamp,
  sanitizeSubmissionFileNamePart,
} from "./submission-drive.js";

describe("formatSubmissionTimestamp", () => {
  it("formats UTC as YYYYMMDD-HHmmss", () => {
    expect(formatSubmissionTimestamp(Date.UTC(2026, 3, 15, 14, 30, 52))).toBe(
      "20260415-143052",
    );
  });
});

describe("buildSubmissionSb3FileName", () => {
  it("builds student_code_displayName_title_timestamp.sb3", () => {
    expect(
      buildSubmissionSb3FileName({
        studentCode: "261101",
        displayName: "山田太郎",
        projectTitle: "猫のアニメ",
        submittedAtMs: Date.UTC(2026, 3, 15, 14, 30, 52),
      }),
    ).toBe("261101_山田太郎_猫のアニメ_20260415-143052.sb3");
  });

  it("sanitizes unsafe characters and strips .sb3 from title", () => {
    expect(
      buildSubmissionSb3FileName({
        studentCode: "261110",
        displayName: "A/B 生徒",
        projectTitle: "work.sb3",
        submittedAtMs: Date.UTC(2026, 0, 1, 0, 0, 0),
      }),
    ).toBe("261110_A_B 生徒_work_20260101-000000.sb3");
  });

  it("uses defaults when title is empty", () => {
    expect(
      buildSubmissionSb3FileName({
        studentCode: "S001",
        displayName: "Student",
        projectTitle: "   ",
        submittedAtMs: 0,
      }),
    ).toBe("S001_Student_提出作品_19700101-000000.sb3");
  });
});

describe("sanitizeSubmissionFileNamePart", () => {
  it("replaces path separators and control chars", () => {
    expect(sanitizeSubmissionFileNamePart("a/b\\c", 20)).toBe("a_b_c");
  });
});
