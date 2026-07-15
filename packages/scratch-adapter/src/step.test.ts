import { describe, expect, it } from "vitest";
import {
  buildMotionProject,
  createAdapter,
  loadProjectJson,
} from "./index.js";

describe("stepVisual", () => {
  it("advances along a linear script with visual boundaries", async () => {
    const adapter = await createAdapter();
    await loadProjectJson(
      adapter,
      buildMotionProject({ steps: 10, variableValue: "5" }),
    );
    const seen = new Set<string | null>();
    for (let i = 0; i < 20; i++) {
      const snap = await adapter.stepVisual();
      seen.add(snap.currentBlockId);
      if (snap.targets[0] && snap.targets[0].x !== 0) break;
      if ((adapter.vm.runtime.threads ?? []).length === 0) break;
    }
    const final = adapter.observe();
    expect(final.targets[0]?.x).toBeGreaterThan(0);
    adapter.dispose();
  });
});
