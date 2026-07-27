import {describe, expect, it} from "vitest";
import {installExecutionControl} from "./execution-control.js";
import {installExecutionTrace} from "./execution-trace.js";
import {createRewindVmHarness} from "./execution-rewind-vm-harness.js";
import {replayToFrame} from "./execution-rewind-replay.js";
import {installExecutionRewind} from "./execution-rewind.js";
import {restartGreenFlagHatThreads} from "./execution-rewind-green-flag.js";
import {stableTargetIdentity} from "./execution-rewind-target-identity.js";

describe("execution rewind scratch-vm integration", () => {
  it("reaches frame 1 after origin load and green-flag thread restart", async () => {
    const harness = await createRewindVmHarness({steps: [10, 5, 3]});
    harness.stepRecordedFrames(3);

    const frames = harness.rewind.getFrames();
    expect(frames.length).toBeGreaterThanOrEqual(2);

    const beforeIds = harness.vm.runtime.targets.map(
      target => (target as {id?: string}).id,
    );

    const result = await harness.rewind.replayToFrame(1);
    expect(result.ok).toBe(true);

    const afterIds = harness.vm.runtime.targets.map(
      target => (target as {id?: string}).id,
    );
    expect(afterIds).not.toEqual(beforeIds);
    expect(harness.vm.runtime.threads.length).toBeGreaterThan(0);

    const sprite = harness.vm.runtime.targets.find(
      target => (target as {isStage?: boolean}).isStage === false,
    ) as {x?: number};
    expect(sprite.x).toBe(10);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("matches fingerprint when runtime target ids change after reload", async () => {
    const harness = await createRewindVmHarness({steps: [7, 4]});
    harness.stepRecordedFrames(2);
    const frame0 = harness.rewind.getFrames()[0]!;
    const originalSprite = harness.vm.runtime.targets.find(
      target => (target as {isStage?: boolean}).isStage === false,
    )!;

    const replay = await harness.rewind.replayToFrame(0);
    expect(replay.ok).toBe(true);
    expect(replay.actualFingerprint).toBe(frame0.fingerprint);

    const reloadedSprite = harness.vm.runtime.targets.find(
      target => (target as {isStage?: boolean}).isStage === false,
    ) as {id?: string; getName?: () => string; layerOrder?: number};
    expect(reloadedSprite.id).not.toBe((originalSprite as {id?: string}).id);
    expect(stableTargetIdentity(reloadedSprite)).toBe(
      stableTargetIdentity(originalSprite as Parameters<typeof stableTargetIdentity>[0]),
    );

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("replays through the pause gate while execution is paused", async () => {
    const harness = await createRewindVmHarness({steps: [10, 5, 3]});
    harness.stepRecordedFrames(3);
    harness.control.pause();

    const result = await harness.rewind.replayToFrame(1);
    expect(result.ok).toBe(true);

    const sprite = harness.vm.runtime.targets.find(
      target => (target as {isStage?: boolean}).isStage === false,
    ) as {x?: number};
    expect(sprite.x).toBe(10);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("replays wait/timer journal entries deterministically", async () => {
    const harness = await createRewindVmHarness({steps: [4, 2]});
    harness.stepRecordedFrames(4);
    const targetFrame = Math.min(2, harness.rewind.getFrames().length - 1);
    const sprite = harness.vm.runtime.targets.find(
      target => (target as {isStage?: boolean}).isStage === false,
    ) as {x?: number};
    const expectedX = sprite.x;

    const result = await harness.rewind.replayToFrame(targetFrame);
    expect(result.ok).toBe(true);
    expect(sprite.x).toBe(expectedX);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("fails when replay journal entries remain unconsumed", async () => {
    const harness = await createRewindVmHarness({steps: [6, 2]});
    harness.stepRecordedFrames(2);
    const origin = harness.rewind.getOrigin()!;
    const frames = harness.rewind.getFrames().map(frame =>
      frame.frameIndex === 0
        ? {...frame, journalEnd: frame.journalEnd + 1}
        : frame,
    );

    const result = await replayToFrame({
      origin,
      frames,
      journal: harness.journal,
      targetFrameIndex: 0,
      runtime: harness.vm.runtime,
      step: () => harness.vm.runtime._step?.(),
      restoreOrigin: async loaded => {
        await harness.vm.loadProject(structuredClone(loaded.vmProjectJson));
        restartGreenFlagHatThreads(harness.vm.runtime);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not fully consumed/i);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("does not stack wrappers when controllers are reinstalled", async () => {
    const harness = await createRewindVmHarness({steps: [10]});
    const runtime = harness.vm.runtime;

    harness.control.dispose();
    harness.rewind.dispose();
    harness.trace.dispose();

    const trace = installExecutionTrace({runtime})!;
    const first = installExecutionRewind({runtime}, {journal: harness.journal})!;
    installExecutionControl({runtime});
    const second = installExecutionRewind({runtime}, {journal: harness.journal})!;

    expect(first).toBe(second);

    trace.dispose();
    first.dispose();
  });
});
