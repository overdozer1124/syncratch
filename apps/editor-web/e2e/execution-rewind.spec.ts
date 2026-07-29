import {expect, test, type Page} from "@playwright/test";

declare global {
  interface Window {
    __blocksyncTask3?: {
      error?: string | null;
      ready?: boolean;
      getExecutionRewindSnapshot?: () => {
        canRewind: boolean;
        rewindDepth: number;
        isReplaying: boolean;
        rewindError: string | null;
      } | null;
      resetE2eSideEffectCounters?: () => void;
      getE2eSideEffectCounters?: () => {
        persistAttempts: number;
        collabOutboundAttempts: number;
      };
    };
  }
}

const FIBER_HELPERS = `
  const walkFibers = (pick) => {
    const starts = [
      document.querySelector('[class*="blocks_blocks"]'),
      document.querySelector('.injectionDiv'),
      document.querySelector('svg.blocklySvg'),
    ].filter(Boolean);
    for (const start of starts) {
      const key = Object.getOwnPropertyNames(start).find(
        k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
      );
      let fiber = key ? start[key] : null;
      for (let depth = 0; fiber && depth < 80; depth += 1) {
        const found = pick(fiber);
        if (found) return found;
        fiber = fiber.return;
      }
    }
    return null;
  };
  const resolveVm = () => walkFibers(fiber => {
    const props = fiber.memoizedProps || (fiber.stateNode && fiber.stateNode.props);
    const candidate = props && props.vm;
    return candidate && candidate.runtime ? candidate : null;
  });
`;

async function bootEditor(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      window.__blocksyncTask3 !== undefined &&
      (window.__blocksyncTask3.ready === true ||
        window.__blocksyncTask3.error !== null),
  );
  expect(await page.evaluate(() => window.__blocksyncTask3?.error)).toBeNull();
  await expect(page.locator('[data-testid="scratch-gui"]')).toBeVisible();
  await expect(page.getByTestId("exec-control")).toBeVisible();
}

async function createForeverScript(page: Page): Promise<void> {
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    const blocks = vm.editingTarget.blocks;
    blocks.createBlock({
      id: 'hat', opcode: 'event_whenflagclicked', next: 'loop',
      parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 20, y: 20,
    });
    blocks.createBlock({
      id: 'loop', opcode: 'control_forever', next: null, parent: 'hat',
      inputs: {SUBSTACK: {name: 'SUBSTACK', block: 'move', shadow: null}},
      fields: {}, shadow: false, topLevel: false,
    });
    blocks.createBlock({
      id: 'move', opcode: 'motion_movesteps', next: null, parent: 'loop',
      inputs: {STEPS: {name: 'STEPS', block: 'steps', shadow: 'steps'}},
      fields: {}, shadow: false, topLevel: false,
    });
    blocks.createBlock({
      id: 'steps', opcode: 'math_number', next: null, parent: 'move',
      inputs: {}, fields: {NUM: {name: 'NUM', value: '1'}}, shadow: true, topLevel: false,
    });
    vm.emitWorkspaceUpdate();
  })()`);
}

async function startForeverScript(page: Page): Promise<void> {
  await createForeverScript(page);
  await page.evaluate(`(() => { ${FIBER_HELPERS} resolveVm().greenFlag(); })()`);
  await page.waitForFunction(
    `(() => { ${FIBER_HELPERS}
      const vm = resolveVm();
      return vm.runtime.threads.filter(t => !t.updateMonitor).length > 0;
    })()`,
    undefined,
    {timeout: 10_000},
  );
}

async function readSpriteX(page: Page): Promise<number> {
  return page.evaluate(`(() => { ${FIBER_HELPERS}
    return resolveVm().editingTarget.x;
  })()`) as Promise<number>;
}

async function stepOnce(page: Page): Promise<void> {
  await page.getByTestId("exec-step").click();
  await page.waitForTimeout(250);
}

async function waitForRewindIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const snapshot = window.__blocksyncTask3?.getExecutionRewindSnapshot?.();
    return snapshot !== undefined && snapshot !== null && !snapshot.isReplaying;
  });
}

async function countNonWhiteCanvasSamples(page: Page): Promise<number> {
  return page.evaluate(`(() => { ${FIBER_HELPERS}
    const canvas = document.querySelector('canvas');
    if (!canvas) return 0;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 0;
    let count = 0;
    const px = new Uint8Array(4);
    const xs = [0.2, 0.35, 0.5, 0.65, 0.8];
    const ys = [0.2, 0.35, 0.5, 0.65, 0.8];
    for (const xRatio of xs) {
      for (const yRatio of ys) {
        const x = Math.floor(canvas.width * xRatio);
        const y = Math.floor(canvas.height * yRatio);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (px[3] > 0 && px[0] + px[1] + px[2] < 740) count += 1;
      }
    }
    return count;
  })()`) as Promise<number>;
}

test("rewind is unavailable before execution history exists", async ({page}) => {
  await bootEditor(page);
  await createForeverScript(page);

  await expect(page.getByTestId("exec-rewind")).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.__blocksyncTask3?.getExecutionRewindSnapshot?.()?.canRewind,
    ),
  ).toBe(false);

  await startForeverScript(page);
  await page.getByTestId("exec-debug-toggle").click();
  await page.waitForFunction(
    () => window.__blocksyncTask3?.getExecutionRewindSnapshot?.()?.canRewind === true,
  );
  await expect(page.getByTestId("exec-rewind")).toBeEnabled();
});

test("rewind undoes one scheduler frame while paused", async ({page}) => {
  await bootEditor(page);
  await createForeverScript(page);
  await page.getByTestId("exec-debug-toggle").click();
  await page.evaluate(`(() => { ${FIBER_HELPERS} resolveVm().greenFlag(); })()`);
  await page.waitForFunction(
    `(() => { ${FIBER_HELPERS}
      const vm = resolveVm();
      return vm.runtime.threads.filter(t => !t.updateMonitor).length > 0;
    })()`,
    undefined,
    {timeout: 10_000},
  );

  const origin = await readSpriteX(page);
  await stepOnce(page);
  const afterOne = await readSpriteX(page);
  await stepOnce(page);
  const afterTwo = await readSpriteX(page);

  expect(afterOne, "each step should move the sprite").not.toBe(origin);
  expect(afterTwo, "two steps should move further").not.toBe(afterOne);

  await page.getByTestId("exec-rewind").click();
  await waitForRewindIdle(page);

  expect(await readSpriteX(page)).toBe(afterOne);
  const snapshot = await page.evaluate(() =>
    window.__blocksyncTask3?.getExecutionRewindSnapshot?.(),
  );
  expect(snapshot?.canRewind).toBe(true);
  expect(snapshot?.rewindError).toBeNull();
});

test("rewind truncates the execution trace", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.getByTestId("exec-debug-toggle").click();
  await expect(page.getByTestId("exec-debug-panel")).toBeVisible();

  await stepOnce(page);
  await stepOnce(page);
  await stepOnce(page);

  const lines = page.getByTestId("trace-list").locator(".trace-line");
  const countBefore = await lines.count();
  expect(countBefore).toBeGreaterThan(1);

  await page.getByTestId("exec-rewind").click();
  await waitForRewindIdle(page);

  expect(await lines.count()).toBeLessThan(countBefore);
});

test("rewind does not trigger autosave side effects", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.evaluate(() => window.__blocksyncTask3?.resetE2eSideEffectCounters?.());
  await page.getByTestId("exec-debug-toggle").click();
  await stepOnce(page);
  await stepOnce(page);

  const before = await page.evaluate(() =>
    window.__blocksyncTask3?.getE2eSideEffectCounters?.(),
  );
  await page.getByTestId("exec-rewind").click();
  await waitForRewindIdle(page);
  const after = await page.evaluate(() =>
    window.__blocksyncTask3?.getE2eSideEffectCounters?.(),
  );

  expect(after?.persistAttempts).toBe(before?.persistAttempts ?? 0);
  expect(after?.collabOutboundAttempts).toBe(before?.collabOutboundAttempts ?? 0);
});

test("rewind auto-pauses while running", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await expect(page.getByTestId("exec-status")).toHaveText("動いています");
  await page.getByTestId("exec-debug-toggle").click();
  await page.getByTestId("exec-debug-pause-resume").click();
  await expect(page.getByTestId("exec-status")).toHaveText("動いています");

  await page.getByTestId("exec-rewind").click();
  await waitForRewindIdle(page);
  await expect(page.getByTestId("exec-status")).toHaveText("止まっています");
  expect(
    await page.evaluate(
      () => window.__blocksyncTask3?.getExecutionRewindSnapshot?.()?.rewindError,
    ),
  ).toBeNull();
});

test("timeline scrub moves sprite forward again after rewinding", async ({page}) => {
  await bootEditor(page);
  await createForeverScript(page);
  await page.getByTestId("exec-debug-toggle").click();
  await page.evaluate(`(() => { ${FIBER_HELPERS} resolveVm().greenFlag(); })()`);
  await page.waitForFunction(
    `(() => { ${FIBER_HELPERS}
      const vm = resolveVm();
      return vm.runtime.threads.filter(t => !t.updateMonitor).length > 0;
    })()`,
    undefined,
    {timeout: 10_000},
  );

  await stepOnce(page);
  await stepOnce(page);
  await stepOnce(page);
  const xAtThree = await readSpriteX(page);

  await page.getByTestId("exec-rewind").click();
  await waitForRewindIdle(page);
  const xAtTwo = await readSpriteX(page);
  expect(xAtTwo).not.toBe(xAtThree);

  const scrub = page.getByTestId("exec-scrub");
  await expect(scrub).toBeEnabled();
  await scrub.fill("3");
  await scrub.dispatchEvent("change");
  await waitForRewindIdle(page);
  expect(await readSpriteX(page)).toBe(xAtThree);
});

test("stage stays visible after canvas resize while paused", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.waitForTimeout(500);
  await page.getByTestId("exec-debug-toggle").click();

  expect(await countNonWhiteCanvasSamples(page)).toBeGreaterThan(0);

  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const renderer = resolveVm().runtime.renderer;
    renderer.resize(renderer.canvas.width, renderer.canvas.height);
  })()`);
  await page.waitForTimeout(250);

  expect(await countNonWhiteCanvasSamples(page)).toBeGreaterThan(0);

  await page.getByTestId("exec-rewind").click();
  await waitForRewindIdle(page);
  expect(await countNonWhiteCanvasSamples(page)).toBeGreaterThan(0);
});
