import {expect, test, type Page} from "@playwright/test";

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
}

async function openTracePanel(page: Page): Promise<void> {
  await page.getByTestId("trace-panel").locator("summary").click();
  await expect(page.getByTestId("trace-list")).toBeVisible();
}

async function traceLabels(page: Page): Promise<string[]> {
  return page
    .getByTestId("trace-list")
    .locator(".trace-label")
    .allTextContents();
}

async function startBounceForeverScript(page: Page, steps = 10): Promise<void> {
  await page.evaluate(`((steps) => { ${FIBER_HELPERS}
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
      id: 'move', opcode: 'motion_movesteps', next: 'bounce', parent: 'loop',
      inputs: {STEPS: {name: 'STEPS', block: 'steps', shadow: 'steps'}},
      fields: {}, shadow: false, topLevel: false,
    });
    blocks.createBlock({
      id: 'steps', opcode: 'math_number', next: null, parent: 'move',
      inputs: {}, fields: {NUM: {name: 'NUM', value: String(steps)}}, shadow: true, topLevel: false,
    });
    blocks.createBlock({
      id: 'bounce', opcode: 'motion_ifonedgebounce', next: null, parent: 'loop',
      inputs: {}, fields: {}, shadow: false, topLevel: false,
    });
    vm.emitWorkspaceUpdate();
    vm.greenFlag();
  })(${JSON.stringify(steps)})`);
  await page.waitForTimeout(800);
}

async function waitForTraceLabel(page: Page, pattern: RegExp | string): Promise<void> {
  const locator =
    typeof pattern === "string"
      ? page.getByTestId("trace-list").locator(".trace-label", {hasText: pattern})
      : page.getByTestId("trace-list").locator(".trace-label").filter({hasText: pattern});
  await expect(locator.first()).toBeVisible({timeout: 15_000});
}

test("semantic trace lists forever, move, and bounce in execution order", async ({
  page,
}) => {
  await bootEditor(page);
  await startBounceForeverScript(page, 10);
  await openTracePanel(page);

  await waitForTraceLabel(page, "緑の旗でスクリプトを開始した");
  await waitForTraceLabel(page, "「ずっと」を開始した");
  await waitForTraceLabel(page, "10歩動いた");
  await waitForTraceLabel(page, /端で跳ね返った？ → いいえ/);

  const labels = await traceLabels(page);
  const flagIndex = labels.findIndex(label =>
    label.includes("緑の旗でスクリプトを開始した"),
  );
  const foreverIndex = labels.findIndex(label => label.includes("「ずっと」を開始した"));
  const moveIndex = labels.findIndex(label => label.includes("10歩動いた"));
  const bounceIndex = labels.findIndex(label => label.includes("端で跳ね返った"));
  expect(flagIndex).toBeLessThan(foreverIndex);
  expect(foreverIndex).toBeLessThan(moveIndex);
  expect(moveIndex).toBeLessThan(bounceIndex);
});

test("bounce at stage edge is reported as はい with direction change", async ({
  page,
}) => {
  await bootEditor(page);
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    vm.editingTarget.setDirection(90);
    vm.editingTarget.setXY(220, 0);
  })()`);
  await startBounceForeverScript(page, 1);
  await openTracePanel(page);
  await page.waitForTimeout(1200);

  const labels = await traceLabels(page);
  expect(labels.some(label => /端で跳ね返った？ → はい/.test(label))).toBe(true);
});

test("step mode appends one semantic entry per frame without changing motion state", async ({
  page,
}) => {
  await bootEditor(page);
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
      inputs: {}, fields: {NUM: {name: 'NUM', value: '10'}}, shadow: true, topLevel: false,
    });
    vm.emitWorkspaceUpdate();
    vm.greenFlag();
  })()`);
  await page.getByTestId("exec-pause").click();
  await openTracePanel(page);
  await page.getByTestId("trace-clear").click();
  await expect(page.getByTestId("trace-list").locator(".trace-empty")).toBeVisible();

  const before = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const t = resolveVm().editingTarget;
    return {x: t.x, y: t.y, direction: t.direction};
  })()`);

  const countBefore = await page.getByTestId("trace-list").locator(".trace-line").count();
  await page.getByTestId("exec-step").click();
  await waitForTraceLabel(page, /歩動いた|ずっと/);
  const countAfterOne = await page.getByTestId("trace-list").locator(".trace-line").count();
  expect(countAfterOne).toBeGreaterThan(countBefore);

  await page.getByTestId("exec-step").click();
  await expect
    .poll(async () => page.getByTestId("trace-list").locator(".trace-line").count())
    .toBeGreaterThan(countAfterOne);

  const labels = await traceLabels(page);
  expect(labels.length).toBeGreaterThanOrEqual(2);

  const after = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const t = resolveVm().editingTarget;
    return {x: t.x, y: t.y, direction: t.direction};
  })()`);
  expect(after.x).not.toBe(before.x);
  expect(labels.some(label => label.includes("10歩動いた") || label.includes("1歩動いた"))).toBe(
    true,
  );
});

test("paused project does not append semantic trace entries", async ({page}) => {
  await bootEditor(page);
  await startBounceForeverScript(page, 10);
  await page.getByTestId("exec-pause").click();
  await openTracePanel(page);
  await page.getByTestId("trace-clear").click();
  await page.waitForTimeout(900);
  await expect(page.getByTestId("trace-list").locator(".trace-empty")).toBeVisible();
});
