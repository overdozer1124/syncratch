import { describe, expect, it } from "vitest";
import {
  buildMotionProject,
  createAdapter,
  loadProjectJson,
  type RuntimeSnapshot,
} from "./index.js";

function fingerprint(s: RuntimeSnapshot) {
  const vars: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(s.variables)) {
    vars[k] = typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  return JSON.stringify({
    targets: s.targets,
    variables: vars,
  });
}

describe("parity", () => {
  it("matches runToEnd vs stepped final state for Gate0 opcode script", async () => {
    const project = buildMotionProject({ steps: 25, variableValue: "9" });

    const a = await createAdapter();
    await loadProjectJson(a, project);
    const endA = await a.runToEnd();
    a.dispose();

    const b = await createAdapter();
    await loadProjectJson(b, project);
    for (let i = 0; i < 80; i++) {
      await b.stepVisual();
      if ((b.vm.runtime.threads ?? []).length === 0) break;
    }
    const endB = b.observe();
    b.dispose();

    expect(endA.targets[0]?.x).toBeGreaterThan(0);
    expect(endB.targets[0]?.x).toBeGreaterThan(0);
    expect(fingerprint(endB)).toEqual(fingerprint(endA));
  });
});
