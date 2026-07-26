import {expect, test, type Page} from "@playwright/test";

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
  await expect(page.getByTestId("exec-pause")).toHaveText("再開");

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
