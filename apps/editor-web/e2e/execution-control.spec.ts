import {expect, test, type Page} from "@playwright/test";

declare global {
  interface Window {
    __syncratchDraws?: number;
  }
}

/**
 * Pause / single-frame step must actually stop the VM and highlight the block
 * the project is sitting on. Unit tests cover the gate logic against a fake
 * runtime; this checks it against the real scratch-vm inside the editor.
 */

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

/**
 * Build a forever-loop script on the editing target and start it, so there is
 * a running thread to pause. Uses the VM's own block API rather than dragging.
 */
async function startForeverScript(page: Page): Promise<void> {
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    const target = vm.editingTarget;
    const blocks = target.blocks;
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
    // Push the new script into Blockly so the workspace has blocks to glow.
    vm.emitWorkspaceUpdate();
    vm.greenFlag();
  })()`);
  await page.waitForFunction(
    `(() => { ${FIBER_HELPERS}
      const vm = resolveVm();
      return vm.runtime.threads.filter(t => !t.updateMonitor).length > 0;
    })()`,
    undefined,
    {timeout: 10_000},
  );
}

/** Sprite x position: a cheap proxy for "the VM is advancing". */
async function readSpriteX(page: Page): Promise<number> {
  return page.evaluate(`(() => { ${FIBER_HELPERS}
    return resolveVm().editingTarget.x;
  })()`) as Promise<number>;
}

test("pause stops the VM and resume restarts it", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);

  // Running: the sprite keeps moving.
  const first = await readSpriteX(page);
  await page.waitForTimeout(300);
  expect(await readSpriteX(page), "sprite should move while running").not.toBe(
    first,
  );

  await page.getByTestId("exec-pause").click();
  await expect(page.getByTestId("exec-status")).toHaveText("止まっています");
  await expect(page.getByTestId("exec-pause-label")).toHaveText("再開");

  const paused = await readSpriteX(page);
  await page.waitForTimeout(400);
  expect(await readSpriteX(page), "sprite must not move while paused").toBe(
    paused,
  );

  await page.getByTestId("exec-pause").click();
  await expect(page.getByTestId("exec-status")).toHaveText("動いています");
  await page.waitForTimeout(300);
  expect(await readSpriteX(page), "sprite should move again after resume").not.toBe(
    paused,
  );
});

test("step advances exactly one frame and highlights the running block", async ({
  page,
}) => {
  await bootEditor(page);
  await startForeverScript(page);

  await page.getByTestId("exec-pause").click();
  await expect(page.getByTestId("exec-status")).toHaveText("止まっています");

  // scratch-blocks paints a glow via an SVG filter (src/glows.ts), not a class.
  await expect(
    page.locator('.blocklyWorkspace [filter="url(#blocklyStackGlowFilter)"]').first(),
  ).toBeAttached();

  const before = await readSpriteX(page);
  await page.getByTestId("exec-step").click();
  await page.waitForTimeout(250);
  const afterOneStep = await readSpriteX(page);
  expect(afterOneStep, "one step should advance the project").not.toBe(before);

  // ...and then stop again, rather than free-running.
  await page.waitForTimeout(400);
  expect(await readSpriteX(page), "step must not resume the VM").toBe(
    afterOneStep,
  );
  await expect(page.getByTestId("exec-status")).toHaveText("止まっています");
});

test("the trace panel records what actually ran", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);

  await page.getByTestId("trace-panel").locator("summary").click();
  const lines = page.getByTestId("trace-list").locator(".trace-line");
  await expect(lines.first()).toBeVisible();

  // The forever loop runs "move 1 steps" over and over, under the green flag hat.
  const labels = await lines.allTextContents();
  expect(labels.join("\n")).toContain("歩いた");
  expect(labels.join("\n")).toContain("緑の旗が押された");

  // A forever loop genuinely alternates forever/move, so consecutive-run
  // coalescing does not apply here; the buffer cap is what bounds the list.
  expect(await lines.count(), "a forever loop must not flood the trace").toBeLessThan(
    600,
  );

  await page.getByTestId("trace-clear").click();
  await expect(page.getByTestId("trace-list").locator(".trace-empty")).toBeVisible();
});

/**
 * The toolbar is a single nowrap row. Adding the run controls made it wider
 * than the window, which pushed the trace dropdown off the right edge and
 * clipped the sprite names. Check both the row and the panel stay inside the
 * window, at a narrow laptop width and a wide one.
 */
for (const size of [
  {width: 1280, height: 800},
  {width: 1920, height: 1000},
]) {
  test(`toolbar and trace panel fit at ${size.width}px`, async ({page}) => {
    await page.setViewportSize(size);
    await bootEditor(page);

    await page.getByTestId("trace-panel").locator("summary").click();
    const panel = page.getByTestId("trace-panel").locator(".panel-content");
    await expect(panel).toBeVisible();

    const box = (await panel.boundingBox())!;
    expect(box.x, "panel starts inside the window").toBeGreaterThanOrEqual(0);
    expect(
      box.x + box.width,
      "panel must not overflow the right edge",
    ).toBeLessThanOrEqual(size.width);
    expect(
      box.y + box.height,
      "panel must not overflow the bottom",
    ).toBeLessThanOrEqual(size.height);

    // Worst case: every optional panel (AI on, collab warnings, ...) visible.
    const toolbar = await page.evaluate(() => {
      const row = document.querySelector(".primary-controls");
      const hidden = Array.from(
        row?.querySelectorAll<HTMLElement>("[hidden]") ?? [],
      );
      for (const el of hidden) el.hidden = false;
      let content = 0;
      for (const child of Array.from(row?.children ?? [])) {
        content += child.getBoundingClientRect().width;
      }
      for (const el of hidden) el.hidden = true;
      return {content, available: row?.clientWidth ?? 0};
    });
    expect(
      toolbar.content,
      "toolbar must fit even with every panel shown",
    ).toBeLessThanOrEqual(toolbar.available);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      "the page must not scroll sideways",
    ).toBeLessThanOrEqual(size.width);
  });
}

/**
 * Reported after shipping: history full of blocks the learner never wrote, and
 * a green flag that appeared to do nothing. Both come from state surviving
 * across runs — the log kept entries from an earlier version of the program,
 * and a paused VM stayed paused when the flag was pressed.
 */
test("the green flag resumes a paused project and starts a fresh log", async ({
  page,
}) => {
  await bootEditor(page);
  await startForeverScript(page);

  await page.getByTestId("exec-pause").click();
  await expect(page.getByTestId("exec-status")).toHaveText("止まっています");
  const paused = await readSpriteX(page);

  // The history panel must survive clicking the run controls beside it.
  await page.getByTestId("trace-panel").locator("summary").click();
  await expect(
    page.getByTestId("trace-panel").locator(".panel-content"),
  ).toBeVisible();
  await page.getByTestId("exec-step").click();
  await expect(
    page.getByTestId("trace-panel").locator(".panel-content"),
    "stepping must not close the history panel",
  ).toBeVisible();

  // Pressing the green flag has to actually start the project.
  await page.evaluate(`(() => { ${FIBER_HELPERS} resolveVm().greenFlag(); })()`);
  await expect(page.getByTestId("exec-status")).toHaveText("動いています");
  await page.waitForTimeout(500);
  expect(
    await readSpriteX(page),
    "the green flag must run the project even when paused",
  ).not.toBe(paused);

  // ...and the log it produced belongs to this run only. The panel repaints on
  // an interval, so wait for the new run's first entry instead of guessing.
  await expect(
    page.getByTestId("trace-list").locator(".trace-line").first(),
  ).toBeVisible();
  const labels = (
    await page.getByTestId("trace-list").locator(".trace-line").allTextContents()
  ).join("\n");
  expect(labels).toContain("緑の旗が押された");
  expect(
    labels.match(/緑の旗が押された/g)?.length,
    "one green-flag entry, not one per run ever made",
  ).toBe(1);
});

/**
 * Reported after shipping: "the sprite stops moving but the history keeps
 * going". Two independent causes, both checked here against the real VM.
 */
test("a paused project neither runs nor logs", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);

  await page.getByTestId("exec-pause").click();
  await page.getByTestId("trace-panel").locator("summary").click();
  await expect(
    page.getByTestId("trace-panel").locator(".panel-content"),
  ).toBeVisible();
  await page.getByTestId("trace-clear").click();

  // Starting scripts while paused must not grow the log: a log that moves
  // while the stage is frozen is what made this look broken.
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    vm.runtime.startHats('event_whenflagclicked');
  })()`);
  await page.waitForTimeout(900);

  await expect(
    page.getByTestId("trace-list").locator(".trace-empty"),
    "the log must stay empty while execution is paused",
  ).toBeVisible();
});

test("deleting a running script does not freeze the stage", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.waitForTimeout(400);

  // Count real draws so we measure painting, not just execution.
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const renderer = resolveVm().runtime.renderer;
    const original = renderer.draw.bind(renderer);
    window.__syncratchDraws = 0;
    renderer.draw = (...args) => {
      window.__syncratchDraws += 1;
      return original(...args);
    };
  })()`);

  // Upstream scratch-gui throws "Tried to glow block that does not exist."
  // here; Runtime._step draws only after the glow update, so an unguarded
  // throw would stop the stage repainting.
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    for (const id of ['steps', 'move', 'loop', 'hat']) {
      vm.editingTarget.blocks.deleteBlock(id);
    }
    vm.emitWorkspaceUpdate();
  })()`);
  await page.waitForTimeout(400);

  const before = await page.evaluate(() => window.__syncratchDraws ?? 0);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.__syncratchDraws ?? 0);
  expect(after - before, "the stage must keep repainting").toBeGreaterThan(5);
});

/**
 * Reported after #121/#123: pressing the green flag with an empty workspace
 * still makes the sprite move — leftover threads or hats must not survive.
 */
async function deleteAllScripts(page: Page): Promise<void> {
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    for (const id of ['steps', 'move', 'loop', 'hat']) {
      vm.editingTarget.blocks.deleteBlock(id);
    }
    // Also wipe anything else so the workspace is truly empty.
    vm.editingTarget.blocks.deleteAllBlocks();
    vm.emitWorkspaceUpdate();
  })()`);
}

test("green flag with no blocks must not move the sprite", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.waitForTimeout(400);

  // Pause mid-run (the path that previously left stale execution state).
  await page.getByTestId("exec-pause").click();
  await expect(page.getByTestId("exec-status")).toHaveText("止まっています");
  await page.getByTestId("exec-step").click();
  await page.waitForTimeout(200);

  await deleteAllScripts(page);
  const blockCount = await page.evaluate(`(() => { ${FIBER_HELPERS}
    return Object.keys(resolveVm().editingTarget.blocks._blocks).length;
  })()`);
  expect(blockCount, "workspace scripts must be gone").toBe(0);

  await page.evaluate(`(() => { ${FIBER_HELPERS} resolveVm().greenFlag(); })()`);
  await expect(page.getByTestId("exec-status")).toHaveText("動いています");

  const atFlag = await readSpriteX(page);
  await page.waitForTimeout(800);
  expect(
    await readSpriteX(page),
    "an empty project must not move after the green flag",
  ).toBe(atFlag);

  const threads = await page.evaluate(`(() => { ${FIBER_HELPERS}
    return resolveVm().runtime.threads.filter(t => !t.updateMonitor).length;
  })()`);
  expect(threads, "no script threads should remain").toBe(0);
});

test("green flag after deleting a running script must not move the sprite", async ({
  page,
}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.waitForTimeout(400);

  // Delete while still running (glow-guard path).
  await deleteAllScripts(page);
  await page.waitForTimeout(400);

  await page.evaluate(`(() => { ${FIBER_HELPERS} resolveVm().greenFlag(); })()`);
  const atFlag = await readSpriteX(page);
  await page.waitForTimeout(800);
  expect(
    await readSpriteX(page),
    "deleting scripts then green-flagging must not revive motion",
  ).toBe(atFlag);
});

/**
 * #126 guard must stop execution when Blockly is empty but VM scripts remain,
 * without deleting VM blocks (recoverable partial-sync failure).
 */
test("empty Blockly with VM scripts stops execution but keeps VM blocks", async ({
  page,
}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.waitForTimeout(400);

  const before = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    return {
      vmBlocks: Object.keys(vm.editingTarget.blocks._blocks).length,
      x: vm.runtime.targets.find(t => !t.isStage).x,
    };
  })()`);

  // Simulate partial VM→Blockly sync failure: Blockly cleared, VM untouched.
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const Blockly = globalThis.Blockly;
    const ws = Blockly && Blockly.getMainWorkspace && Blockly.getMainWorkspace();
    if (!ws || typeof ws.clear !== 'function') throw new Error('Blockly workspace missing');
    ws.clear();
  })()`);

  await page.waitForTimeout(750);

  const after = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    const Blockly = globalThis.Blockly;
    const ws = Blockly && Blockly.getMainWorkspace && Blockly.getMainWorkspace();
    const tops = ws && ws.getTopBlocks ? ws.getTopBlocks(false) : [];
    return {
      vmBlocks: Object.keys(vm.editingTarget.blocks._blocks).length,
      workspaceTops: tops.length,
      x: vm.runtime.targets.find(t => !t.isStage).x,
      desyncLog: window.__blocksyncTask3?.workspaceVmDesyncLog?.() ?? [],
      runningThreads: vm.runtime.threads.filter(t => !t.updateMonitor && !t.isKilled).length,
    };
  })()`);

  expect(after.workspaceTops, "Blockly workspace should look empty").toBe(0);
  expect(after.vmBlocks, "VM blocks must not be auto-deleted").toBe(before.vmBlocks);
  expect(after.vmBlocks).toBeGreaterThan(0);
  expect(after.desyncLog.length, "desync should be recorded").toBeGreaterThan(0);
  expect(
    Math.abs(after.x - before.x),
    "motion should stop after desync guard",
  ).toBeLessThan(5);
  expect(after.runningThreads, "active threads should be stopped").toBe(0);
});
