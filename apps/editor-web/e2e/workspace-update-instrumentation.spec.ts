import {expect, test, type Page} from "@playwright/test";

declare global {
  interface Window {
    __blocksyncTask3?: {
      workspaceUpdateLog?: () => Array<{
        phase: string;
        partialFailureLikely?: boolean;
        vmBlockCount?: number;
        blocklyTopBlocks?: number | null;
        saveDirtyGeneration?: number;
      }>;
      suppressedDirtyLog?: () => unknown[];
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
}

async function startForeverScript(page: Page): Promise<void> {
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
    vm.greenFlag();
  })()`);
}

test("partial clearWorkspaceAndLoadFromXml failure is recorded without autosave side effects", async ({
  page,
}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.waitForTimeout(400);

  const before = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    const log = window.__blocksyncTask3?.workspaceUpdateLog?.() ?? [];
    const startGen = log.at(-1)?.saveDirtyGeneration ?? 0;
    return {
      vmBlocks: Object.keys(vm.editingTarget.blocks._blocks).length,
      startGen,
    };
  })()`);

  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const ScratchBlocks = walkFibers(fiber => fiber.stateNode && fiber.stateNode.ScratchBlocks);
    if (!ScratchBlocks || !ScratchBlocks.clearWorkspaceAndLoadFromXml) {
      throw new Error('ScratchBlocks API missing');
    }
    const original = ScratchBlocks.clearWorkspaceAndLoadFromXml;
    ScratchBlocks.clearWorkspaceAndLoadFromXml = function(dom, workspace) {
      workspace.clear();
      throw new Error('simulated partial workspace reload failure');
    };
    try {
      resolveVm().emitWorkspaceUpdate();
    } finally {
      ScratchBlocks.clearWorkspaceAndLoadFromXml = original;
    }
  })()`);

  await page.waitForTimeout(750);

  const after = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    const log = window.__blocksyncTask3?.workspaceUpdateLog?.() ?? [];
    const settled = log.filter(entry => entry.phase === 'settled').at(-1);
    const start = log.filter(entry => entry.phase === 'start').at(-1);
    return {
      vmBlocks: Object.keys(vm.editingTarget.blocks._blocks).length,
      settled,
      startGen: start?.saveDirtyGeneration,
      settledGen: settled?.saveDirtyGeneration,
      suppressedDirty: window.__blocksyncTask3?.suppressedDirtyLog?.() ?? [],
    };
  })()`);

  expect(after.vmBlocks, "VM blocks must survive partial Blockly reload").toBe(
    before.vmBlocks,
  );
  expect(after.settled?.partialFailureLikely).toBe(true);
  expect(after.settled?.blocklyTopBlocks).toBe(0);
  expect(after.settledGen).toBe(before.startGen);
  expect(after.suppressedDirty).toHaveLength(0);
});
