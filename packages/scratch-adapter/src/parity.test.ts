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
    vars[k] =
      typeof v === "string" && v !== "" && !Number.isNaN(Number(v))
        ? Number(v)
        : v;
  }
  return JSON.stringify({ targets: s.targets, variables: vars });
}

describe("parity (vendor v14.1.0)", () => {
  it("matches Scratch normal ticks vs visual-step final state", async () => {
    const project = buildMotionProject({ steps: 25, variableValue: "9" });

    const a = await createAdapter();
    expect(a.runtimeSource).toContain("vendor:");
    await loadProjectJson(a, project);
    const endA = await a.runToEnd();
    a.dispose();

    const b = await createAdapter();
    await loadProjectJson(b, project);
    let lastX = 0;
    for (let i = 0; i < 80; i++) {
      const snap = await b.stepVisual();
      lastX = snap.targets[0]?.x ?? 0;
      if ((b.vm.runtime.threads ?? []).length === 0) break;
    }
    const endB = b.observe();
    expect(endB.targets[0]?.x).toBe(lastX);
    b.dispose();

    expect(endA.targets[0]?.x).toBeGreaterThan(0);
    expect(endB.targets[0]?.x).toBeGreaterThan(0);
    expect(fingerprint(endB)).toEqual(fingerprint(endA));
  });
});
