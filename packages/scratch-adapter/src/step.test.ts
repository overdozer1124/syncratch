import { describe, expect, it } from "vitest";
import {
  buildMotionProject,
  createAdapter,
  loadProjectJson,
} from "./index.js";

describe("stepVisual", () => {
  it("keeps hat as a visual boundary and does not run multiple commands per step", async () => {
    const adapter = await createAdapter();
    // Initial variable 0; set block writes 5; move writes +10 on x.
    await loadProjectJson(
      adapter,
      buildMotionProject({ steps: 10, variableValue: "5" }),
    );

    const before = adapter.observe();
    expect(before.currentBlockId).toBeNull();
    expect(Number(before.variables.score)).toBe(0);
    expect(before.targets[0]?.x).toBe(0);

    // Step 1: hat only (startHats executes hat + one goToNextBlock → pause on set)
    const s1 = await adapter.stepVisual();
    expect(s1.currentBlockId).toBe("set");
    expect(Number(s1.variables.score)).toBe(0);
    expect(s1.targets[0]?.x).toBe(0);

    // Step 2: set only
    const s2 = await adapter.stepVisual();
    expect(s2.currentBlockId).toBe("move");
    expect(Number(s2.variables.score)).toBe(5);
    expect(s2.targets[0]?.x).toBe(0);

    // Step 3: move only
    const s3 = await adapter.stepVisual();
    expect(Number(s3.variables.score)).toBe(5);
    expect(s3.targets[0]?.x).toBe(10);

    // Further steps must not re-run (no double move)
    const s4 = await adapter.stepVisual();
    expect(s4.targets[0]?.x).toBe(10);
    expect((adapter.vm.runtime.threads ?? []).length).toBe(0);

    adapter.dispose();
  });
});
