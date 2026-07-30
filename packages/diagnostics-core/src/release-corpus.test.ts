import {describe, expect, it} from "vitest";
import {diagnoseProject} from "./diagnose.js";
import {presentDiagnosticHints} from "./hints/presenter.js";
import {block, normalIfElse} from "./testing/project-fixtures.js";
import {SINGLE_MUTATIONS} from "./testing/mutations.js";
import type {ProjectDocument} from "@blocksync/project-schema";

describe("release corpus", () => {
  it("single mutations match oracle rule ids", () => {
    for (const mut of SINGLE_MUTATIONS) {
      const report = diagnoseProject(mut.document);
      const semantic = report.findings.filter(
        f => !f.ruleId.startsWith("schema."),
      );
      expect(
        semantic.map(f => f.ruleId).sort(),
        mut.id,
      ).toEqual([...mut.expectedRuleIds].sort());
    }
  });

  it("normal creative variants have zero integrity false positives", () => {
    for (const doc of [normalIfElse()]) {
      const report = diagnoseProject(doc);
      expect(report.findings.filter(f => f.severity === "integrity")).toEqual(
        [],
      );
    }
  });

  it("no-match path always yields a generic debugging guide", () => {
    const presented = presentDiagnosticHints(
      diagnoseProject(SINGLE_MUTATIONS[0]!.document),
    );
    expect(presented.usedGenericGuide).toBe(true);
  });

  it("runs in linear time on a synthetic large project", () => {
    const blocks: ProjectDocument["targets"][0]["blocks"] = {};
    const n = 800;
    for (let i = 0; i < n; i++) {
      const id = `b${i}`;
      const next = i + 1 < n ? `b${i + 1}` : null;
      blocks[id] = block(
        id,
        i === 0 ? "event_whenflagclicked" : "motion_movesteps",
        {
          next,
          parent: i === 0 ? null : `b${i - 1}`,
          topLevel: i === 0,
          ...(i === 0
            ? {}
            : {inputs: {STEPS: [1, [4, "1"]]}}),
        },
      );
    }
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks,
        },
      ],
      extensions: [],
    };
    const started = Date.now();
    const report = diagnoseProject(doc);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2000);
    expect(report.findings.filter(f => f.ruleId === "empty-event-script")).toHaveLength(
      0,
    );
  });
});
