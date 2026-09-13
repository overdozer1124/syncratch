import {describe, expect, it} from "vitest";
import {createRewindVmHarness} from "./execution-rewind-vm-harness.js";
import {createExecutionTrace} from "./execution-trace.js";

describe("timeline scrub integration", () => {
  it("scrubs backward and forward without truncating frames", async () => {
    const harness = await createRewindVmHarness({steps: [10, 5, 3]});
    harness.stepRecordedFrames(3);
    expect(harness.rewind.getFrames()).toHaveLength(3);
    const xAtFrontier = harness.findSprite().x!;

    const back = await harness.rewind.scrubToFrame(1);
    expect(back.ok, back.error ?? undefined).toBe(true);
    const xAtOne = harness.findSprite().x!;
    expect(xAtOne).not.toBe(xAtFrontier);
    expect(harness.rewind.getFrames()).toHaveLength(3);
    expect(harness.rewind.getSnapshot().scrubDepthForward).toBe(1);

    const forward = await harness.rewind.scrubForwardOneFrame();
    expect(forward.ok, forward.error ?? undefined).toBe(true);
    expect(harness.findSprite().x).toBe(xAtFrontier);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("commitPlaybackBranch truncates frames after playback head", async () => {
    const harness = await createRewindVmHarness({steps: [10, 5, 3]});
    harness.stepRecordedFrames(3);
    await harness.rewind.scrubToFrame(1);
    harness.rewind.commitPlaybackBranch();
    expect(harness.rewind.getFrames()).toHaveLength(2);
    expect(harness.rewind.getSnapshot().recordFrontierFrameIndex).toBe(1);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });
});

describe("trace suspend during replay", () => {
  it("does not append entries while recording is suspended", () => {
    const trace = createExecutionTrace();
    trace.record({
      blockId: "a",
      targetId: "t1",
      targetName: "Sprite1",
      snapshot: {opcode: "motion_movesteps", args: {}},
    });
    expect(trace.size()).toBe(1);

    trace.setRecordingSuspended(true);
    trace.record({
      blockId: "b",
      targetId: "t1",
      targetName: "Sprite1",
      snapshot: {opcode: "motion_movesteps", args: {}},
    });
    expect(trace.size()).toBe(1);

    trace.setRecordingSuspended(false);
    trace.record({
      blockId: "c",
      targetId: "t1",
      targetName: "Sprite1",
      snapshot: {opcode: "motion_movesteps", args: {}},
    });
    expect(trace.size()).toBe(2);
  });

  it("limits rendered entries via display cursor", () => {
    const trace = createExecutionTrace();
    trace.record({
      blockId: "a",
      targetId: null,
      targetName: null,
      snapshot: {opcode: "motion_movesteps", args: {}},
    });
    trace.record({
      blockId: "b",
      targetId: null,
      targetName: null,
      snapshot: {opcode: "motion_movesteps", args: {}},
    });
    trace.setDisplayCursor(1);
    expect(trace.getDisplayEntries()).toHaveLength(1);
    expect(trace.getEntries()).toHaveLength(2);
  });
});
