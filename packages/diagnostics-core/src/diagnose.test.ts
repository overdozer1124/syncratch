import {describe, expect, it} from "vitest";
import {diagnoseProject} from "./diagnose.js";
import {
  emptyForeverBody,
  normalGreenFlagMove,
} from "./testing/project-fixtures.js";

describe("diagnoseProject", () => {
  it("combines schema + semantic rules without network deps", () => {
    const report = diagnoseProject(emptyForeverBody());
    expect(report.schemaVersion).toBe(1);
    expect(report.limitations).toContain("no-external-ai");
    expect(report.findings.some(f => f.ruleId === "empty-c-block")).toBe(true);
  });

  it("can skip schema findings", () => {
    const report = diagnoseProject(normalGreenFlagMove(), {
      includeSchemaFindings: false,
    });
    expect(report.findings.every(f => !f.ruleId.startsWith("schema."))).toBe(
      true,
    );
  });
});
