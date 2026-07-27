import {expect, test, type Page} from "@playwright/test";

declare global {
  interface Window {
    __blocksyncTask3?: {
      ready?: boolean;
      error?: string | null;
      workspaceUpdateLog?: () => Array<{
        phase: string;
        loadEpoch?: number;
        partialFailureLikely?: boolean;
        vmBlockCount?: number;
        blocklyTopBlocks?: number | null;
        saveDirtyGeneration?: number;
      }>;
      loadBoundaryLog?: () => Array<{
        loadEpoch: number;
        kind: string;
        suppressed: boolean;
      }>;
      suppressedDirtyLog?: () => unknown[];
      resetE2eSideEffectCounters?: () => void;
      getE2eSideEffectCounters?: () => {
        persistAttempts: number;
        collabOutboundAttempts: number;
      };
      reloadCurrentProject?: () => Promise<number>;
      installE2ePublishableCollabSession?: () => Promise<void>;
      publishE2eCollabLocalChange?: () => Promise<void>;
      flushE2eLocalSave?: () => Promise<void>;
      createTestBlock?: (id: string) => void;
    };
    __syncratchTestPatch?: {
      ScratchBlocks: {clearWorkspaceAndLoadFromXml: (...args: unknown[]) => unknown};
      original: (...args: unknown[]) => unknown;
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
  const resolveScratchBlocks = () => walkFibers(fiber => fiber.stateNode && fiber.stateNode.ScratchBlocks);
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
  })()`);
  await page.waitForTimeout(750);
}

function installPartialReloadFailurePatch(page: Page): Promise<void> {
  return page.evaluate(`(() => { ${FIBER_HELPERS}
    const ScratchBlocks = resolveScratchBlocks();
    if (!ScratchBlocks?.clearWorkspaceAndLoadFromXml) {
      throw new Error('ScratchBlocks API missing');
    }
    const original = ScratchBlocks.clearWorkspaceAndLoadFromXml;
    ScratchBlocks.clearWorkspaceAndLoadFromXml = function(dom, workspace) {
      workspace.clear();
      throw new Error('simulated partial workspace reload failure');
    };
    window.__syncratchTestPatch = { ScratchBlocks, original };
  })()`);
}

test("synced workspace with numeric shadow is not flagged as partial failure", async ({
  page,
}) => {
  await bootEditor(page);
  await startForeverScript(page);

  const result = await page.evaluate(`(() => {
    const log = window.__blocksyncTask3?.workspaceUpdateLog?.() ?? [];
    const settled = log.filter(entry => entry.phase === 'settled').at(-1);
    return {
      partialFailureLikely: settled?.partialFailureLikely,
      vmBlockCount: settled?.vmBlockCount,
      blocklyTopBlocks: settled?.blocklyTopBlocks,
    };
  })()`);

  expect(result.partialFailureLikely).toBe(false);
  expect(result.vmBlockCount).toBeGreaterThan(0);
  expect(result.blocklyTopBlocks).toBeGreaterThan(0);
});

test("load-path partial reload failure suppresses save/collab and records load epoch", async ({
  page,
}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await page.evaluate(async () => {
    await window.__blocksyncTask3?.installE2ePublishableCollabSession?.();
  });

  const control = await page.evaluate(async () => {
    window.__blocksyncTask3?.resetE2eSideEffectCounters?.();
    await window.__blocksyncTask3?.publishE2eCollabLocalChange?.();
    const afterPublish = window.__blocksyncTask3?.getE2eSideEffectCounters?.();
    window.__blocksyncTask3?.createTestBlock?.("collab-control-block");
    await window.__blocksyncTask3?.flushE2eLocalSave?.();
    const afterPersist = window.__blocksyncTask3?.getE2eSideEffectCounters?.();
    return {afterPublish, afterPersist};
  });
  expect(control.afterPublish?.collabOutboundAttempts).toBeGreaterThan(0);
  expect(control.afterPersist?.persistAttempts).toBeGreaterThan(0);

  await page.evaluate(() => window.__blocksyncTask3?.resetE2eSideEffectCounters?.());
  await installPartialReloadFailurePatch(page);

  const before = await page.evaluate(`(async () => { ${FIBER_HELPERS}
    const vm = resolveVm();
    const log = window.__blocksyncTask3?.workspaceUpdateLog?.() ?? [];
    const dirtyGen = log.at(-1)?.saveDirtyGeneration ?? 0;
    const vmBlocks = Object.keys(vm.editingTarget.blocks._blocks).length;
    const epochBefore = await window.__blocksyncTask3?.reloadCurrentProject?.();
    return { vmBlocks, dirtyGen, epochBefore };
  })()`);

  await page.waitForTimeout(900);

  const after = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const vm = resolveVm();
    const patch = window.__syncratchTestPatch;
    if (patch) {
      patch.ScratchBlocks.clearWorkspaceAndLoadFromXml = patch.original;
      delete window.__syncratchTestPatch;
    }
    const updateLog = window.__blocksyncTask3?.workspaceUpdateLog?.() ?? [];
    const boundaryLog = window.__blocksyncTask3?.loadBoundaryLog?.() ?? [];
    const settled = updateLog.filter(entry => entry.phase === 'settled').at(-1);
    const loadEpoch = settled?.loadEpoch;
    const boundaries = boundaryLog.filter(entry => entry.loadEpoch === loadEpoch);
    return {
      vmBlocks: Object.keys(vm.editingTarget.blocks._blocks).length,
      settled,
      boundaries,
      sideEffects: window.__blocksyncTask3?.getE2eSideEffectCounters?.(),
      suppressedDirty: window.__blocksyncTask3?.suppressedDirtyLog?.() ?? [],
      dirtyGen: settled?.saveDirtyGeneration,
    };
  })()`);

  expect(after.vmBlocks).toBe(before.vmBlocks);
  expect(after.settled?.partialFailureLikely).toBe(true);
  expect(after.settled?.blocklyTopBlocks).toBe(0);
  expect(after.dirtyGen).toBe(before.dirtyGen);
  expect(after.sideEffects?.persistAttempts).toBe(0);
  expect(after.sideEffects?.collabOutboundAttempts).toBe(0);
  expect(after.suppressedDirty.length).toBeGreaterThan(0);
  expect(after.boundaries.some(entry => entry.suppressed === true)).toBe(true);
  expect(after.boundaries.some(entry => entry.suppressed === false)).toBe(true);
  expect(after.boundaries.every(entry => entry.kind === "load")).toBe(true);
});
