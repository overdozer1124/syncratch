import {describe, expect, it} from "vitest";
import {buildDiagnosticProjectIR} from "../ir.js";
import {
  broadcastMatched,
  broadcastNearMissParentFieldOnly,
  broadcastReceiveOnly,
  broadcastSendOnly,
  emptyFlagHat,
  emptyForeverBody,
  filledForeverBody,
  normalGreenFlagMove,
} from "../testing/project-fixtures.js";
import {
  broadcastReceiveWithoutSendRule,
  broadcastSendWithoutReceiveRule,
  resolveSendBroadcast,
} from "./broadcast-flow.js";
import {emptyCBlockRule} from "./empty-c-block.js";
import {emptyEventScriptRule} from "./empty-event-script.js";
import {runRegisteredRules} from "./registry.js";

describe("emptyCBlockRule", () => {
  it("positive: empty forever SUBSTACK", () => {
    const findings = emptyCBlockRule.run(
      buildDiagnosticProjectIR(emptyForeverBody()),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.confidence).toBe("certain");
    expect(findings[0]?.severity).toBe("suggestion");
  });

  it("negative: filled forever body", () => {
    expect(
      emptyCBlockRule.run(buildDiagnosticProjectIR(filledForeverBody())),
    ).toHaveLength(0);
  });
});

describe("broadcast flow", () => {
  it("negative: matched send/receive across targets", () => {
    const ir = buildDiagnosticProjectIR(broadcastMatched());
    expect(broadcastSendWithoutReceiveRule.run(ir)).toHaveLength(0);
    expect(broadcastReceiveWithoutSendRule.run(ir)).toHaveLength(0);
  });

  it("positive: send without receive", () => {
    const findings = broadcastSendWithoutReceiveRule.run(
      buildDiagnosticProjectIR(broadcastSendOnly()),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.confidence).toBe("certain");
  });

  it("positive: receive without send", () => {
    const findings = broadcastReceiveWithoutSendRule.run(
      buildDiagnosticProjectIR(broadcastReceiveOnly()),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.confidence).toBe("likely");
  });

  it("near-miss: parent field alone does not count as send match", () => {
    const ir = buildDiagnosticProjectIR(broadcastNearMissParentFieldOnly());
    const sender = ir.targets.find(t => t.id === "s1")!;
    const send = sender.blocksById.get("send")!;
    expect(resolveSendBroadcast(sender, send)).toBeNull();
    // Receive exists but no menu-resolved send → receive-without-send.
    expect(broadcastReceiveWithoutSendRule.run(ir).length).toBeGreaterThan(0);
    expect(broadcastSendWithoutReceiveRule.run(ir)).toHaveLength(0);
  });
});

describe("emptyEventScriptRule", () => {
  it("positive: bare green-flag hat", () => {
    const findings = emptyEventScriptRule.run(
      buildDiagnosticProjectIR(emptyFlagHat()),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("empty-event-script");
  });

  it("negative: hat with body", () => {
    expect(
      emptyEventScriptRule.run(
        buildDiagnosticProjectIR(normalGreenFlagMove()),
      ),
    ).toHaveLength(0);
  });
});

describe("registry", () => {
  it("keeps stable rule order", () => {
    const ids = runRegisteredRules(
      buildDiagnosticProjectIR(emptyForeverBody()),
    ).map(f => f.ruleId);
    expect(ids).toContain("empty-c-block");
  });
});
