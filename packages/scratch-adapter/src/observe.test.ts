import { describe, expect, it } from "vitest";
import {
  buildMotionProject,
  createAdapter,
  loadProjectJson,
} from "./index.js";

describe("observe", () => {
  it("loads a project and exposes thread/target/variable fields", async () => {
    const adapter = await createAdapter();
    await loadProjectJson(adapter, buildMotionProject({ steps: 10, variableValue: "7" }));
    adapter.greenFlag();
    // Allow runtime to start threads
    await adapter.stepVisual();
    const snap = adapter.observe();
    expect(Array.isArray(snap.threads)).toBe(true);
    expect(snap.targets.length).toBeGreaterThan(0);
    expect(snap.targets[0]?.name).toBe("Sprite1");
    // Variables may appear after setvariable runs; structure must be present
    expect(typeof snap.variables).toBe("object");
    adapter.dispose();
  });
});
