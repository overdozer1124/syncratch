import { describe, expect, it } from "vitest";
import {
  buildMotionProject,
  createAdapter,
  loadProjectJson,
} from "./index.js";

describe("observe (vendor v14.1.0)", () => {
  it("loads via vendor VM and exposes observation fields", async () => {
    const adapter = await createAdapter();
    expect(adapter.runtimeSource).toContain("14.1.0");
    expect(adapter.runtimeSource).toContain("vendor:");
    await loadProjectJson(
      adapter,
      buildMotionProject({ steps: 10, variableValue: "7" }),
    );
    adapter.greenFlag();
    await adapter.stepVisual();
    const snap = adapter.observe();
    expect(Array.isArray(snap.threads)).toBe(true);
    expect(snap.targets.length).toBeGreaterThan(0);
    expect(snap.targets[0]?.name).toBe("Sprite1");
    adapter.dispose();
  });
});
