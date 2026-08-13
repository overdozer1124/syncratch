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

    const sprite = harness.findSprite();
    expect(sprite.x).toBe(10);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("matches fingerprint when runtime target ids change after reload", async () => {
    const harness = await createRewindVmHarness({steps: [7, 4]});
    harness.stepRecordedFrames(2);
    const frame0 = harness.rewind.getFrames()[0]!;
    const originalSprite = harness.findSprite();

    const replay = await harness.rewind.replayToFrame(0);
    expect(replay.ok).toBe(true);
    expect(replay.actualFingerprint).toBe(frame0.fingerprint);

    const reloadedSprite = harness.findSprite();
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

    const sprite = harness.findSprite();
    expect(sprite.x).toBe(10);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("replays wait/timer journal entries deterministically after reload", async () => {
    const harness = await createRewindVmHarness({steps: [4, 2]});
    harness.stepRecordedFrames(4);
    const targetFrame = Math.min(2, harness.rewind.getFrames().length - 1);
    const expectedX = harness.findSprite().x;

    const result = await harness.rewind.replayToFrame(targetFrame);
    expect(result.ok, result.error ?? undefined).toBe(true);
    expect(harness.findSprite().x).toBe(expectedX);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("does not advance timer replay when wall clock moves during replay", async () => {
    const harness = await createRewindVmHarness({steps: [6, 4, 2]});
    harness.stepRecordedFrames(4);
    const targetFrame = Math.min(2, harness.rewind.getFrames().length - 1);
    const expectedX = harness.findSprite().x;

    const origin = harness.rewind.getOrigin()!;
    const frames = harness.rewind.getFrames();
    const result = await replayToFrame({
      origin,
      frames,
      journal: harness.journal,
      targetFrameIndex: targetFrame,
      runtime: harness.vm.runtime,
      step: () => {
        harness.vm.runtime.currentMSecs = (harness.vm.runtime.currentMSecs ?? 0) + 60_000;
        return harness.vm.runtime._step?.();
      },
      restoreOrigin: async loaded => {
        await harness.vm.loadProject(structuredClone(loaded.vmProjectJson));
        restartGreenFlagHatThreads(harness.vm.runtime);
      },
    });

    expect(result.ok).toBe(true);
    expect(harness.findSprite().x).toBe(expectedX);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  });

  it("assigns distinct clone identities and replays clone threads", async () => {
    const harness = await createRewindVmHarness({
      clones: true,
      cloneMoves: [5, 8],
    });
    harness.stepRecordedFrames(6);

    const spriteTargets = harness.vm.runtime.targets.filter(
      target => (target as {isStage?: boolean}).isStage === false,
    );
    expect(spriteTargets.length).toBeGreaterThanOrEqual(3);

    const identities = spriteTargets.map(target =>
      stableTargetIdentity(target as Parameters<typeof stableTargetIdentity>[0]),
    );
    expect(new Set(identities).size).toBe(identities.length);
    expect(identities.some(id => id.endsWith(":orig"))).toBe(true);
    expect(identities.filter(id => id.includes(":clone:")).length).toBeGreaterThanOrEqual(2);
    expect(
      harness.journal
        .cloneEntries()
        .filter(entry => entry.kind === "cloneOrder").length,
    ).toBeGreaterThanOrEqual(2);

    const targetFrame = Math.min(3, harness.rewind.getFrames().length - 1);
    const positionsBefore = spriteTargets.map(target => ({
      identity: stableTargetIdentity(target as Parameters<typeof stableTargetIdentity>[0]),
      x: (target as {x?: number}).x ?? 0,
      y: (target as {y?: number}).y ?? 0,
    }));

    const result = await harness.rewind.replayToFrame(targetFrame);
    expect(result.ok, result.error ?? undefined).toBe(true);

    const positionsAfter = harness.vm.runtime.targets
      .filter(target => (target as {isStage?: boolean}).isStage === false)
      .map(target => ({
        identity: stableTargetIdentity(target as Parameters<typeof stableTargetIdentity>[0]),
        x: (target as {x?: number}).x ?? 0,
        y: (target as {y?: number}).y ?? 0,
      }));

    expect(positionsAfter).toEqual(positionsBefore);

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

  it("rewinds stepped forever-loop frames while paused", async () => {
    const harness = await createRewindVmHarness({forever: true, foreverStep: 1});
    harness.vm.greenFlag();
    harness.control.pause();
    for (let i = 0; i < 5; i += 1) {
      harness.control.stepFrame();
      harness.vm.runtime._step?.();
    }
    expect(harness.rewind.getFrames().length).toBeGreaterThanOrEqual(4);

    const result = await harness.rewind.rewindFrame();
    expect(result.ok, result.error ?? undefined).toBe(true);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  }, 15_000);

  it("replays every recorded frame for forever move + if x>240 goto", async () => {
    const harness = await createRewindVmHarness({foreverIfGoto: true});
    harness.vm.greenFlag();
    harness.control.pause();
    for (let i = 0; i < 12; i += 1) {
      harness.control.stepFrame();
      harness.vm.runtime._step?.();
    }
    const frames = harness.rewind.getFrames();
    expect(frames.length).toBeGreaterThanOrEqual(9);

    for (let target = 0; target < frames.length; target += 1) {
      const result = await harness.rewind.replayToFrame(target);
      expect(result.ok, `frame ${target}: ${result.error ?? ""}`).toBe(true);
    }

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  }, 30_000);

  it("rewinds after a running segment then paused stepping", async () => {
    const harness = await createRewindVmHarness({foreverIfGoto: true});
    harness.vm.greenFlag();
    for (let i = 0; i < 6; i += 1) {
      harness.vm.runtime._step?.();
    }
    harness.control.pause();
    for (let i = 0; i < 6; i += 1) {
      harness.control.stepFrame();
      harness.vm.runtime._step?.();
    }
    expect(harness.rewind.getFrames().length).toBeGreaterThanOrEqual(9);

    const result = await harness.rewind.rewindFrame();
    expect(result.ok, result.error ?? undefined).toBe(true);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  }, 20_000);

  it("rewinds forever move + if x>240 goto while paused", async () => {
    const harness = await createRewindVmHarness({foreverIfGoto: true});
    harness.vm.greenFlag();
    harness.control.pause();
    for (let i = 0; i < 12; i += 1) {
      harness.control.stepFrame();
      harness.vm.runtime._step?.();
    }
    expect(harness.rewind.getFrames().length).toBeGreaterThanOrEqual(9);
    expect(harness.trace.trace.size()).toBeGreaterThan(0);

    const result = await harness.rewind.rewindFrame();
    expect(result.ok, result.error ?? undefined).toBe(true);
    expect(harness.rewind.getSnapshot().rewindError).toBeNull();

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  }, 20_000);

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
