import {expect, test, type Page} from "@playwright/test";

/**
 * Gallery extensions must produce real, draggable Scratch blocks.
 *
 * Regression cover for the "extension blocks cannot be placed" class of bugs:
 * the category shows up, the flyout paints something, but the blocks are 0x0
 * husks (initSvg threw) or refuse to leave the flyout.
 */

// A faithful stand-in for a TurboWarp gallery extension: unsandboxed classic
// script, `Scratch.extensions.register`, only `color1`, a menu, and no icon.
// Kept local so the test never depends on extensions.turbowarp.org.
const STRETCH_LIKE_SCRIPT = `(function (Scratch) {
  "use strict";
  const ICON_DATA_URI =
    "data:image/svg+xml;base64," +
    btoa('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#B4A0FF"/></svg>');
  class StretchLike {
    getInfo () {
      return {
        id: "stretch",
        name: "Stretch",
        color1: "#B4A0FF",
        // An icon makes the VM add the \`scratch_extension\` Blockly extension
        // and a field_image to args0 — the path that used to produce
        // icon-only husks.
        blockIconURI: ICON_DATA_URI,
        menuIconURI: ICON_DATA_URI,
        blocks: [
          {
            opcode: "setStretch",
            blockType: Scratch.BlockType.COMMAND,
            text: "set stretch x: [X] y: [Y]",
            arguments: {
              X: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100},
              Y: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100}
            }
          },
          {
            opcode: "changeStretch",
            blockType: Scratch.BlockType.COMMAND,
            text: "change stretch [AXIS] by [AMOUNT]",
            arguments: {
              AXIS: {type: Scratch.ArgumentType.STRING, menu: "axis"},
              AMOUNT: {type: Scratch.ArgumentType.NUMBER, defaultValue: 10}
            }
          },
          {
            opcode: "getStretch",
            blockType: Scratch.BlockType.REPORTER,
            text: "stretch [AXIS]",
            arguments: {
              AXIS: {type: Scratch.ArgumentType.STRING, menu: "axis"}
            }
          }
        ],
        menus: {
          axis: {acceptReporters: true, items: ["x", "y"]}
        }
      };
    }
    setStretch () {}
    changeStretch () {}
    getStretch () { return 100; }
  }
  Scratch.extensions.register(new StretchLike());
})(Scratch);
`;

type BlockProbe = {
  type: string;
  width: number;
  height: number;
  enabled: boolean;
  hasSvg: boolean;
};

type Diagnostics = {
  resolvedScratchBlocks: boolean;
  definedTypes: string[];
  categoryJson: Array<{
    type: unknown;
    style: unknown;
    colour: unknown;
    extensions: unknown;
  }>;
  themeStyle: unknown;
  newBlockError: string | null;
  newBlockSize: {width: number; height: number} | null;
  flyoutBlocks: BlockProbe[];
};

declare global {
  interface Window {
    __syncratchBlockErrors?: string[];
  }
}

/**
 * Same React-fiber walk the app uses; `globalThis.Blockly` is a Msg-only stub
 * and the diagnostic hook does not expose the VM.
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
  const resolveScratchBlocks = () => walkFibers(fiber => {
    const candidate = fiber.stateNode && fiber.stateNode.ScratchBlocks;
    return candidate && typeof candidate.defineBlocksWithJsonArray === 'function'
      ? candidate
      : null;
  });
  const resolveVm = () => walkFibers(fiber => {
    const props = fiber.memoizedProps || (fiber.stateNode && fiber.stateNode.props);
    const candidate = props && props.vm;
    return candidate && candidate.runtime ? candidate : null;
  });
`;

async function bootEditor(page: Page): Promise<void> {
  await page.route("https://extensions.turbowarp.org/**", route =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: STRETCH_LIKE_SCRIPT,
    }),
  );
  await page.addInitScript(() => {
    window.__syncratchBlockErrors = [];
    window.addEventListener("error", event => {
      window.__syncratchBlockErrors?.push(String(event.message));
    });
  });
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

async function addStretchExtension(page: Page): Promise<void> {
  await page
    .locator('[class*="extension-button_extension-button"]')
    .first()
    .click();
  const card = page.locator('[data-extension-key="stretch"]');
  await expect(card).toBeVisible();
  await card.click();
  // Category registered in the VM is the earliest reliable "loaded" signal.
  await page.waitForFunction(
    `(() => { ${FIBER_HELPERS}
      const vm = resolveVm();
      const info = vm && vm.runtime && vm.runtime._blockInfo;
      return Boolean(info && info.some(entry => entry && entry.id === 'stretch'));
    })()`,
    undefined,
    {timeout: 30_000},
  );
  // Let the GUI's setTimeout(0) toolbox refresh and our retries settle.
  await page.waitForTimeout(1500);
}

/**
 * Blocks actually placed on the editing target. Counted on both sides:
 * the Blockly main workspace and the VM target (`Blocks` exposes `_blocks`,
 * not a `getAllBlocks()` method).
 */
async function countWorkspaceBlocks(
  page: Page,
): Promise<{blockly: number; vm: number}> {
  return page.evaluate(`(() => { ${FIBER_HELPERS}
    const SB = resolveScratchBlocks();
    const vm = resolveVm();
    const target = vm && vm.editingTarget;
    return {
      blockly: SB ? SB.getMainWorkspace().getAllBlocks(false).length : -1,
      vm: target && target.blocks && target.blocks._blocks
        ? Object.keys(target.blocks._blocks).length
        : -1,
    };
  })()`) as Promise<{blockly: number; vm: number}>;
}

/**
 * Grab the flyout block whose type starts with `typePrefix` and drag it onto the
 * workspace. Coordinates come from Blockly itself so we never grab the wrong
 * block. Returns what was actually grabbed, for diagnosis.
 */
async function dragFlyoutBlockToWorkspace(
  page: Page,
  typePrefix: string,
): Promise<{type: string | null; x: number; y: number} | null> {
  // The continuous flyout is one long shared list: a category far down the
  // list sits thousands of pixels below the viewport until it is scrolled in.
  await page.evaluate(`(() => { ${FIBER_HELPERS}
    const SB = resolveScratchBlocks();
    if (!SB) return;
    const ws = SB.getMainWorkspace();
    const flyoutWs = ws.getFlyout().getWorkspace();
    const block = flyoutWs.getAllBlocks(false).find(
      b => b.type && b.type.indexOf(${JSON.stringify(typePrefix)}) === 0,
    );
    if (!block) return;
    const top = block.getRelativeToSurfaceXY().y * flyoutWs.scale;
    flyoutWs.scrollbar.setY(Math.max(0, top - 24));
  })()`);
  await page.waitForTimeout(400);

  const target = (await page.evaluate(`(() => { ${FIBER_HELPERS}
    const SB = resolveScratchBlocks();
    if (!SB) return null;
    const flyoutWs = SB.getMainWorkspace().getFlyout().getWorkspace();
    const block = flyoutWs.getAllBlocks(false).find(
      b => b.type && b.type.indexOf(${JSON.stringify(typePrefix)}) === 0,
    );
    const root = block && block.getSvgRoot && block.getSvgRoot();
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    return {
      type: block.type,
      x: rect.left + Math.min(30, rect.width / 2),
      y: rect.top + rect.height / 2,
      onScreen: rect.top >= 0 && rect.bottom <= window.innerHeight,
    };
  })()`)) as {type: string; x: number; y: number; onScreen: boolean} | null;
  if (!target) return null;
  expect(
    target.onScreen,
    `${target.type} is not scrolled into view (y=${target.y})`,
  ).toBe(true);

  const canvasBox = await page.locator("svg.blocklySvg").first().boundingBox();
  if (!canvasBox) return target;

  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  // One small move first so Blockly clears its flyout drag radius.
  await page.mouse.move(target.x + 12, target.y + 12, {steps: 4});
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.6,
    canvasBox.y + canvasBox.height * 0.5,
    {steps: 25},
  );
  await page.mouse.up();
  await page.waitForTimeout(600);
  return target;
}

async function collectDiagnostics(page: Page): Promise<Diagnostics> {
  return page.evaluate(`(() => {
    ${FIBER_HELPERS}
    const SB = resolveScratchBlocks();
    const out = {
      resolvedScratchBlocks: Boolean(SB),
      definedTypes: [],
      categoryJson: [],
      themeStyle: null,
      newBlockError: null,
      newBlockSize: null,
      flyoutBlocks: [],
    };
    if (!SB) return out;
    out.definedTypes = Object.keys(SB.Blocks || {}).filter(k => k.startsWith('stretch_'));

    const vm = resolveVm();
    const cat = vm && vm.runtime && vm.runtime._blockInfo
      ? vm.runtime._blockInfo.find(c => c && c.id === 'stretch')
      : null;
    out.categoryJson = ((cat && cat.blocks) || []).map(b => ({
      type: b.json && b.json.type,
      style: b.json && b.json.style,
      colour: b.json && b.json.colour,
      extensions: b.json && b.json.extensions,
    }));

    const ws = SB.getMainWorkspace();
    try {
      const theme = ws.getTheme();
      out.themeStyle = theme && theme.blockStyles ? theme.blockStyles['stretch'] : null;
    } catch (e) { out.themeStyle = 'ERROR: ' + e.message; }

    const type = out.definedTypes.find(t => t === 'stretch_setStretch') || out.definedTypes[0];
    if (type) {
      let probe = null;
      try {
        probe = ws.newBlock(type);
        probe.initSvg();
        probe.render && probe.render();
        const size = probe.getHeightWidth ? probe.getHeightWidth() : null;
        out.newBlockSize = size ? {width: size.width, height: size.height} : null;
      } catch (e) {
        out.newBlockError = String(e && e.message ? e.message : e);
      }
      try { probe && probe.dispose(false); } catch (e) { /* ignore */ }
    }

    const flyoutWs = ws.getFlyout && ws.getFlyout() ? ws.getFlyout().getWorkspace() : null;
    if (flyoutWs) {
      out.flyoutBlocks = flyoutWs.getAllBlocks(false)
        .filter(b => b.type && b.type.indexOf('stretch_') === 0)
        .map(b => {
          const size = b.getHeightWidth ? b.getHeightWidth() : {width: 0, height: 0};
          return {
            type: b.type,
            width: size.width,
            height: size.height,
            enabled: typeof b.isEnabled === 'function' ? b.isEnabled() : true,
            hasSvg: Boolean(b.getSvgRoot && b.getSvgRoot()),
          };
        });
    }
    return out;
  })()`) as Promise<Diagnostics>;
}

// Control: proves the drag simulation itself works, so a failure in the
// extension test below is the product's bug and not the harness's.
test("built-in motion blocks can be dragged out of the flyout", async ({page}) => {
  await bootEditor(page);
  const before = await countWorkspaceBlocks(page);
  const dragged = await dragFlyoutBlockToWorkspace(page, "motion_");
  expect(dragged, "no motion block found in the flyout").not.toBeNull();
  const after = await countWorkspaceBlocks(page);
  console.log("motion control", JSON.stringify({before, after, dragged}));
  expect(
    after.blockly,
    `dragging ${dragged?.type} added no block`,
  ).toBeGreaterThan(before.blockly);
  expect(after.vm, `dragging ${dragged?.type} did not reach the VM`).toBeGreaterThan(
    before.vm,
  );
});

test("gallery extension blocks render with real geometry and can be dragged out", async ({
  page,
}) => {
  await bootEditor(page);
  await addStretchExtension(page);

  const diagnostics = await collectDiagnostics(page);
  // Surfaces the actual failure mode when this test regresses.
  console.log("extension diagnostics", JSON.stringify(diagnostics, null, 2));

  expect(diagnostics.resolvedScratchBlocks).toBe(true);
  expect(diagnostics.definedTypes).toContain("stretch_setStretch");

  // Blockly throws on JSON that carries a style *and* a colour; the VM always
  // emits `style`, so nothing downstream may add colour fields.
  for (const json of diagnostics.categoryJson) {
    if (json.style) expect(json.colour).toBeUndefined();
  }

  expect(diagnostics.newBlockError).toBeNull();
  expect(diagnostics.newBlockSize?.width ?? 0).toBeGreaterThan(0);
  expect(diagnostics.newBlockSize?.height ?? 0).toBeGreaterThan(0);

  expect(diagnostics.flyoutBlocks.length).toBeGreaterThan(0);
  for (const block of diagnostics.flyoutBlocks) {
    expect(block.hasSvg, `${block.type} has no SVG root`).toBe(true);
    expect(block.enabled, `${block.type} is disabled in the flyout`).toBe(true);
    expect(block.width, `${block.type} width`).toBeGreaterThan(0);
    expect(block.height, `${block.type} height`).toBeGreaterThan(0);
  }

  // The real test: drag the block from the flyout onto the workspace.
  const before = await countWorkspaceBlocks(page);

  // Run exactly what Gesture.updateIsDraggingFromFlyout does, so a failure
  // reports its own reason instead of looking like "the drag did nothing".
  const createProbe = await page.evaluate(`(() => { ${FIBER_HELPERS}
    const SB = resolveScratchBlocks();
    const ws = SB.getMainWorkspace();
    const flyout = ws.getFlyout();
    const block = flyout.getWorkspace().getAllBlocks(false)
      .find(b => b.type === 'stretch_setStretch');
    if (!block) return {found: false};
    const out = {
      found: true,
      creatable: flyout.isBlockCreatable(block),
      enabled: block.isEnabled(),
      isInFlyout: block.isInFlyout,
      hasSvgRoot: Boolean(block.getSvgRoot()),
      createError: null,
    };
    try {
      const created = flyout.createBlock(block);
      out.createdType = created && created.type;
      created && created.dispose(false);
    } catch (e) {
      out.createError = String(e && e.stack ? e.stack : e).slice(0, 800);
    }
    return out;
  })()`);
  console.log("createBlock probe", JSON.stringify(createProbe, null, 2));

  const dragged = await dragFlyoutBlockToWorkspace(page, "stretch_setStretch");
  console.log("drag result", JSON.stringify(dragged));

  const after = await countWorkspaceBlocks(page);

  console.log("extension drag", JSON.stringify({before, after}));
  expect(
    await page.evaluate(() => window.__syncratchBlockErrors ?? []),
  ).toEqual([]);
  expect(
    after.blockly,
    "dragging the extension block from the flyout added no block",
  ).toBeGreaterThan(before.blockly);
  expect(
    after.vm,
    "the dragged extension block never reached the VM",
  ).toBeGreaterThan(before.vm);
});
