import {expect, test, type Page} from "@playwright/test";

declare global {
  interface Window {
    __blocksyncTask3?: {
      ready?: boolean;
      error?: string | null;
      blocklyEventLog?: () => Array<{
        type: string;
        syncGeneration: number;
        graphMutating: boolean;
        moveKind?: string;
      }>;
      blocklyVmGraphDiffLog?: () => Array<{
        syncGeneration: number;
        mismatch: boolean;
        eventType: string;
        afterEventSeq: number;
      }>;
      blockEventDropLog?: () => Array<{
        kind: string;
        syncGeneration?: number;
        event: {type?: string; blockId?: string};
      }>;
      armDropNext?: (
        kind: "move" | "delete" | "connection-change",
        count?: number | "all",
      ) => void;
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

async function waitForNewSyncGeneration(
  page: Page,
  previousGeneration: number,
): Promise<void> {
  await page.waitForFunction(
    prev =>
      (window.__blocksyncTask3?.getSyncGeneration?.() ?? 0) > prev,
    previousGeneration,
    {timeout: 15_000},
  );
  await page.waitForTimeout(400);
}

async function dropLogCount(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__blocksyncTask3?.blockEventDropLog?.()?.length ?? 0,
  );
}

async function waitForNewDropLog(page: Page, previousCount: number): Promise<void> {
  await page.waitForFunction(
    prev =>
      (window.__blocksyncTask3?.blockEventDropLog?.()?.length ?? 0) > prev,
    previousCount,
    {timeout: 15_000},
  );
  await page.waitForTimeout(400);
}

async function currentSyncGeneration(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__blocksyncTask3?.getSyncGeneration?.() ?? 0,
  );
}

async function waitForGraphMutatingEvent(
  page: Page,
  previousCount: number,
): Promise<void> {
  await page.waitForFunction(
    prev =>
      (window.__blocksyncTask3?.blocklyEventLog?.().filter(entry => entry.graphMutating)
        .length ?? 0) > prev,
    previousCount,
    {timeout: 15_000},
  );
  await page.waitForTimeout(400);
}

async function graphMutatingEventCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      window.__blocksyncTask3?.blocklyEventLog?.().filter(entry => entry.graphMutating)
        .length ?? 0,
  );
}

async function waitForNewGraphDiff(page: Page, previousCount: number): Promise<void> {
  await page.waitForFunction(
    prev =>
      (window.__blocksyncTask3?.blocklyVmGraphDiffLog?.().length ?? 0) > prev,
    previousCount,
    {timeout: 15_000},
  );
  await page.waitForTimeout(400);
}

async function graphDiffCount(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__blocksyncTask3?.blocklyVmGraphDiffLog?.().length ?? 0,
  );
}

async function createHatBlock(page: Page): Promise<string> {
  return page.evaluate(`(() => { ${FIBER_HELPERS}
    const SB = resolveScratchBlocks();
    if (!SB) throw new Error('ScratchBlocks missing');
    const ws = SB.getMainWorkspace();
    const hat = ws.newBlock('event_whenflagclicked');
    hat.initSvg();
    hat.render();
    hat.moveBy(140, 140);
    return hat.id;
  })()`) as Promise<string>;
}

async function createMoveBlock(page: Page): Promise<string> {
  return page.evaluate(`(() => { ${FIBER_HELPERS}
    const SB = resolveScratchBlocks();
    const ws = SB.getMainWorkspace();
    const move = ws.newBlock('motion_movesteps');
    move.initSvg();
    move.render();
    move.moveBy(220, 220);
    return move.id;
  })()`) as Promise<string>;
}

test("Blockly delete/move/connection changes stay synced with VM", async ({
  page,
}) => {
  await bootEditor(page);
  const hatId = await createHatBlock(page);
  let eventCount = await graphMutatingEventCount(page);
  await waitForGraphMutatingEvent(page, eventCount - 1);
  eventCount = await graphMutatingEventCount(page);
  let diffCount = await graphDiffCount(page);
  await waitForNewGraphDiff(page, diffCount - 1);
  diffCount = await graphDiffCount(page);

  const moveId = await createMoveBlock(page);
  await waitForGraphMutatingEvent(page, eventCount);
  eventCount = await graphMutatingEventCount(page);
  await waitForNewGraphDiff(page, diffCount);
  diffCount = await graphDiffCount(page);

  await page.evaluate(`((hatId, moveId) => { ${FIBER_HELPERS}
    const ws = resolveScratchBlocks().getMainWorkspace();
    const hat = ws.getBlockById(hatId);
    const move = ws.getBlockById(moveId);
    hat.nextConnection.connect(move.previousConnection);
  })(${JSON.stringify(hatId)}, ${JSON.stringify(moveId)})`);
  await waitForGraphMutatingEvent(page, eventCount);
  eventCount = await graphMutatingEventCount(page);
  await waitForNewGraphDiff(page, diffCount);
  diffCount = await graphDiffCount(page);

  await page.evaluate(`((moveId) => { ${FIBER_HELPERS}
    resolveScratchBlocks().getMainWorkspace().getBlockById(moveId).dispose();
  })(${JSON.stringify(moveId)})`);
  await waitForGraphMutatingEvent(page, eventCount);
  await waitForNewGraphDiff(page, diffCount);

  const result = await page.evaluate(() => {
    const events = window.__blocksyncTask3?.blocklyEventLog?.() ?? [];
    const diffs = window.__blocksyncTask3?.blocklyVmGraphDiffLog?.() ?? [];
    return {
      graphMutatingEvents: events.filter(entry => entry.graphMutating).length,
      mismatches: diffs.filter(entry => entry.mismatch),
      lastDiff: diffs.at(-1),
    };
  });

  expect(result.graphMutatingEvents).toBeGreaterThan(0);
  expect(result.mismatches).toHaveLength(0);
  expect(result.lastDiff?.mismatch).toBe(false);
});

test("dropped delete/move/connection events correlate mismatch with syncGeneration", async ({
  page,
}) => {
  await bootEditor(page);

  async function assertDropCase(
    kind: "delete" | "move" | "connection-change",
    action: string,
  ): Promise<void> {
    const beforeDiffCount = await graphDiffCount(page);
    const beforeDropCount = await dropLogCount(page);
    await page.evaluate(
      ({dropKind, countArg}) => {
        window.__blocksyncTask3?.armDropNext?.(dropKind, countArg);
      },
      {dropKind: kind, countArg: 1},
    );

    await page.evaluate(actionScript => {
      eval(actionScript);
    }, action);

    await waitForNewDropLog(page, beforeDropCount);
    if (kind !== "move" && kind !== "connection-change") {
      await waitForNewGraphDiff(page, beforeDiffCount);
    } else {
      await page.waitForTimeout(400);
    }

    const snapshot = await page.evaluate(expectedKind => {
      const events = window.__blocksyncTask3?.blocklyEventLog?.() ?? [];
      const diffs = window.__blocksyncTask3?.blocklyVmGraphDiffLog?.() ?? [];
      const drops = window.__blocksyncTask3?.blockEventDropLog?.() ?? [];
      const lastDrop = drops.at(-1);
      const lastEvent = lastDrop
        ? events.find(entry => entry.syncGeneration === lastDrop.syncGeneration)
        : [...events].reverse().find(entry => entry.graphMutating);
      const matchingDiff = lastDrop
        ? [...diffs].reverse().find(
            entry => entry.syncGeneration === lastDrop.syncGeneration,
          )
        : undefined;
      return {
        lastEvent,
        matchingDiff,
        lastDrop,
        expectedKind,
      };
    }, kind);

    if (kind === "connection-change") {
      expect(snapshot.lastDrop?.kind).toBe("connection-change");
      expect(snapshot.matchingDiff?.mismatch).toBe(false);
    } else if (kind === "move" || kind === "delete") {
      expect(snapshot.lastDrop?.kind).toBe(kind);
      expect(snapshot.matchingDiff?.mismatch).toBe(false);
    } else {
      expect(snapshot.lastDrop?.kind).toBe(kind);
      expect(snapshot.matchingDiff?.mismatch).toBe(true);
    }
    expect(snapshot.lastEvent?.syncGeneration).toBeDefined();
    expect(snapshot.lastDrop?.syncGeneration).toBe(
      snapshot.lastEvent?.syncGeneration,
    );
    if (snapshot.matchingDiff) {
      expect(snapshot.matchingDiff.syncGeneration).toBe(
        snapshot.lastEvent?.syncGeneration,
      );
    }
  }

  let diffCount = await graphDiffCount(page);
  let eventCount = await graphMutatingEventCount(page);
  const hatId = await createHatBlock(page);
  await waitForGraphMutatingEvent(page, eventCount);
  eventCount = await graphMutatingEventCount(page);
  await waitForNewGraphDiff(page, diffCount);
  diffCount = await graphDiffCount(page);

  await assertDropCase(
    "move",
    `(() => { ${FIBER_HELPERS}
      const vm = resolveVm();
      vm.blockListener({
        type: 'move',
        blockId: ${JSON.stringify(hatId)},
        newCoordinate: {x: 240, y: 240},
      });
    })()`,
  );

  const moveId = await createMoveBlock(page);
  await waitForGraphMutatingEvent(page, eventCount);
  eventCount = await graphMutatingEventCount(page);
  await waitForNewGraphDiff(page, diffCount);
  diffCount = await graphDiffCount(page);

  await assertDropCase(
    "connection-change",
    `(() => { ${FIBER_HELPERS}
      const vm = resolveVm();
      vm.blockListener({
        type: 'move',
        blockId: ${JSON.stringify(moveId)},
        oldParentId: null,
        newParentId: ${JSON.stringify(hatId)},
      });
    })()`,
  );

  const soloId = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const ws = resolveScratchBlocks().getMainWorkspace();
    const solo = ws.newBlock('event_whenflagclicked');
    solo.initSvg();
    solo.render();
    solo.moveBy(360, 360);
    return solo.id;
  })()`) as string;
  await waitForGraphMutatingEvent(page, eventCount);
  eventCount = await graphMutatingEventCount(page);
  await waitForNewGraphDiff(page, diffCount);
  diffCount = await graphDiffCount(page);

  await assertDropCase(
    "delete",
    `(() => { ${FIBER_HELPERS}
      resolveVm().blockListener({
        type: 'delete',
        blockId: ${JSON.stringify(soloId)},
      });
    })()`,
  );
});
