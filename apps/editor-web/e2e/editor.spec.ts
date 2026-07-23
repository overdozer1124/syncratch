import {expect, test, type Page} from "@playwright/test";

const TEST_BLOCK_ID = "task3-test-block";

async function waitUntilReady(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      window.__blocksyncTask3 !== undefined &&
      (
        window.__blocksyncTask3.ready === true ||
        window.__blocksyncTask3.error !== null
      ),
  );
  expect(await page.evaluate(() => window.__blocksyncTask3?.error)).toBeNull();
}

async function openPanel(
  page: Page,
  testId: "file-panel" | "collab-panel" | "drive-panel",
): Promise<void> {
  const panel = page.getByTestId(testId);
  if (await panel.getAttribute("open") === null) {
    await panel.locator("summary").click();
  }
}

test("fresh load mounts the standalone GUI and reports local save ready", async ({
  page,
}) => {
  await waitUntilReady(page);

  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator(".app-brand")).toContainText("Syncratch");
  await expect(page.locator(".app-brand-kana")).toHaveText("シンクラッチ");
  await expect(page.getByLabel("作品の名前")).toHaveValue(/.+/);
  await expect(page.locator('[data-testid="scratch-gui"]')).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  await expect(page.getByText("動き", {exact: true}).first()).toBeVisible();
  await expect(
    page.locator('#scratch-gui [aria-label="設定メニュー"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#scratch-gui [aria-label="Settings menu"]'),
  ).toHaveCount(0);
  await expect(page.getByText("Debug", {exact: true})).toBeHidden();
  await expect(page.getByTestId("file-panel")).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("collab-panel")).not.toHaveAttribute("open", "");
  await openPanel(page, "file-panel");
  await openPanel(page, "collab-panel");
  await expect(page.getByTestId("file-panel")).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("collab-panel")).toHaveAttribute("open", "");
  expect(
    await page.evaluate(() => window.__blocksyncTask3?.getState().revision),
  ).toBe(0);
});

test("narrow screens keep editor height and allow horizontal Scratch scrolling", async ({
  page,
}) => {
  await page.setViewportSize({width: 768, height: 800});
  await waitUntilReady(page);
  const scratch = page.getByTestId("scratch-gui");
  const initialHeight = await scratch.evaluate(element => element.clientHeight);

  await openPanel(page, "collab-panel");
  expect(await scratch.evaluate(element => element.clientHeight)).toBe(
    initialHeight,
  );
  await openPanel(page, "file-panel");
  await expect(page.getByTestId("collab-panel")).not.toHaveAttribute("open", "");
  expect(await scratch.evaluate(element => element.clientHeight)).toBe(
    initialHeight,
  );

  const scroll = await scratch.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
    };
  });
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  expect(scroll.scrollLeft).toBeGreaterThan(0);
});

test("no Google configuration keeps Drive disabled and local editing available", async ({
  page,
}) => {
  const googleRequests: string[] = [];
  page.on("request", request => {
    if (
      request.url().includes("google.com") ||
      request.url().includes("googleapis.com")
    ) {
      googleRequests.push(request.url());
    }
  });
  await waitUntilReady(page);

  await expect(page.getByTestId("drive-status")).toHaveText(
    "このパソコンでは Google ドライブを使えません",
  );
  await openPanel(page, "drive-panel");
  await expect(
    page.getByRole("button", {name: "Google とつなぐ"}),
  ).toBeDisabled();
  await page.evaluate(
    id => window.__blocksyncTask3!.createTestBlock(id),
    "drive-unconfigured-local-block",
  );
  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );

  expect(googleRequests).toEqual([]);
});

test("VM block mutation autosaves and survives reload", async ({page}) => {
  await waitUntilReady(page);

  await page.evaluate(
    id => window.__blocksyncTask3!.createTestBlock(id),
    TEST_BLOCK_ID,
  );
  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );

  await page.reload();
  await page.waitForFunction(() => window.__blocksyncTask3?.ready === true);

  expect(
    await page.evaluate(
      id => window.__blocksyncTask3!.hasBlock(id),
      TEST_BLOCK_ID,
    ),
  ).toBe(true);
});

test("exports the current project and imports it as a new local project", async ({
  page,
}) => {
  await waitUntilReady(page);
  await page.evaluate(
    id => window.__blocksyncTask3!.createTestBlock(id),
    TEST_BLOCK_ID,
  );
  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  const originalId = await page.evaluate(
    () => window.__blocksyncTask3!.getState().localProjectId,
  );
  const exported = await page.evaluate(async () =>
    Array.from(await window.__blocksyncTask3!.exportSb3()),
  );

  await page.evaluate(
    async ({bytes}) => {
      await window.__blocksyncTask3!.importSb3(
        new Uint8Array(bytes),
        "Imported project",
      );
    },
    {bytes: exported},
  );

  expect(
    await page.evaluate(
      id => window.__blocksyncTask3!.hasBlock(id),
      TEST_BLOCK_ID,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__blocksyncTask3!.getState().localProjectId),
  ).not.toBe(originalId);
});

test("invalid SB3 import is recoverable and preserves retry and export", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  await waitUntilReady(page);
  page.on("pageerror", error => pageErrors.push(error.message));
  const originalId = await page.evaluate(
    () => window.__blocksyncTask3!.getState().localProjectId,
  );
  const validBytes = await page.evaluate(async () =>
    Array.from(await window.__blocksyncTask3!.exportSb3()),
  );

  await page.locator("#open-file").setInputFiles({
    name: "invalid.sb3",
    mimeType: "application/x.scratch.sb3",
    buffer: Buffer.from([1, 2, 3]),
  });

  await expect(page.getByTestId("save-status")).toHaveText(
    "作品ファイルを開けませんでした。今の作品はそのままです。",
  );
  expect(
    await page.evaluate(() => window.__blocksyncTask3!.getState().localProjectId),
  ).toBe(originalId);
  await page.evaluate(() =>
    window.__blocksyncTask3!.configureCollaborationTestGate("import-failure"),
  );
  await expect(page.getByTestId("save-status")).toHaveText(
    "作品ファイルを開けませんでした。今の作品はそのままです。",
  );
  await openPanel(page, "file-panel");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {name: "作品ファイルをダウンロード"}).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.sb3$/);

  await page.locator("#open-file").setInputFiles({
    name: "retry.sb3",
    mimeType: "application/x.scratch.sb3",
    buffer: Buffer.from(validBytes),
  });
  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  expect(
    await page.evaluate(() => window.__blocksyncTask3!.getState().localProjectId),
  ).not.toBe(originalId);
  expect(pageErrors).toEqual([]);
});

test("save failure is recoverable and does not disable SB3 download", async ({
  page,
}) => {
  await waitUntilReady(page);
  await page.evaluate(() => window.__blocksyncTask3!.failNextWrite());
  await page.evaluate(
    id => window.__blocksyncTask3!.createTestBlock(id),
    TEST_BLOCK_ID,
  );

  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存できませんでした",
  );
  await openPanel(page, "file-panel");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {name: "作品ファイルをダウンロード"}).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.sb3$/);
  expect((await download.createReadStream()).readable).toBe(true);
});

test("editing, save, and reload stay local after initial static load", async ({
  page,
}) => {
  const forbiddenRequests: string[] = [];
  await waitUntilReady(page);
  await page.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    const isStaticReload =
      url.origin === "http://127.0.0.1:4173" &&
      ["document", "script", "stylesheet", "image", "font", "media"].includes(
        request.resourceType(),
      );
    if (isStaticReload) {
      return route.continue();
    }
    forbiddenRequests.push(request.url());
    return route.abort();
  });

  await page.evaluate(
    id => window.__blocksyncTask3!.createTestBlock(id),
    TEST_BLOCK_ID,
  );
  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  await page.reload();
  await page.waitForFunction(() => window.__blocksyncTask3?.ready === true);

  expect(
    await page.evaluate(
      id => window.__blocksyncTask3!.hasBlock(id),
      TEST_BLOCK_ID,
    ),
  ).toBe(true);
  expect(forbiddenRequests).toEqual([]);
});

async function connectTwoCollabPeers(
  pageA: Page,
  pageB: Page,
  driveFileId: string,
): Promise<string> {
  await Promise.all([waitUntilReady(pageA), waitUntilReady(pageB)]);
  await Promise.all([
    pageA.evaluate(
      id => window.__blocksyncTask3!.configureCollaborationTestGate(id),
      driveFileId,
    ),
    pageB.evaluate(
      id => window.__blocksyncTask3!.configureCollaborationTestGate(id),
      driveFileId,
    ),
  ]);
  await Promise.all([
    openPanel(pageA, "collab-panel"),
    openPanel(pageB, "collab-panel"),
  ]);
  await pageA.getByRole(
    "button",
    {name: "いっしょに作るリンクを作る"},
  ).click();
  await expect(pageA.getByTestId("collab-status")).toContainText(
    "友だちの参加を待っています",
  );
  const invite = await pageA.getByLabel("いっしょに作るリンク").inputValue();
  expect(invite).not.toContain("driveFileId");
  const inviteUrl = new URL(invite);
  expect(inviteUrl.origin).toBe("http://127.0.0.1:4173");
  await pageB.getByLabel("いっしょに作るリンク").fill(invite);
  await pageB.getByRole("button", {name: "友だちの作品に入る"}).click();
  await expect(pageA.getByTestId("collab-status")).toContainText(
    "1人といっしょに作っています",
  );
  await expect(pageB.getByTestId("collab-status")).toContainText(
    "1人といっしょに作っています",
  );
  return invite;
}

async function panBlocklyWorkspace(
  page: Page,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const svg = page.locator('#scratch-gui svg.blocklySvg').first();
  await expect(svg).toBeVisible({timeout: 20_000});
  const box = await svg.boundingBox();
  expect(box).toBeTruthy();
  const startX = box!.x + box!.width * 0.62;
  const startY = box!.y + box!.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, {steps: 8});
  await page.mouse.up();
}

async function zoomBlocklyWorkspace(page: Page, deltaY: number): Promise<void> {
  const svg = page.locator('#scratch-gui svg.blocklySvg').first();
  await expect(svg).toBeVisible({timeout: 20_000});
  const box = await svg.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.55);
  await page.mouse.wheel(0, deltaY);
}

// Real WebRTC rooms contend for CPU/signaling when run in parallel workers.
test.describe("real WebRTC collaboration", () => {
  test.describe.configure({mode: "serial"});

test("opening a shared invite URL auto-joins without clicking join", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await waitUntilReady(pageA);
    await openPanel(pageA, "collab-panel");
    await pageA.getByRole("button", {name: "いっしょに作るリンクを作る"}).click();
    await expect(pageA.getByTestId("collab-status")).toContainText(
      "友だちの参加を待っています",
    );
    const invite = await pageA.getByLabel("いっしょに作るリンク").inputValue();
    expect(invite).toContain("#blocksync-collab=");

    // Guest opens the shared URL directly — boot() must start collaboration.
    await pageB.goto(invite);
    await pageB.waitForFunction(
      () =>
        window.__blocksyncTask3 !== undefined &&
        (
          window.__blocksyncTask3.ready === true ||
          window.__blocksyncTask3.error !== null
        ),
    );
    expect(await pageB.evaluate(() => window.__blocksyncTask3?.error)).toBeNull();
    await expect(pageA.getByTestId("collab-status")).toContainText(
      "1人といっしょに作っています",
      {timeout: 60_000},
    );
    await expect(pageB.getByTestId("collab-status")).toContainText(
      "1人といっしょに作っています",
      {timeout: 60_000},
    );
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("two Chromium contexts keep local editor UI across remote block edits", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    {origin: "http://127.0.0.1:4173"},
  );
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await connectTwoCollabPeers(pageA, pageB, "shared-drive-ui-state");

    await pageA.getByRole("button", {name: "スプライトを選ぶ", exact: true}).first().click();
    await pageA.getByRole("button", {name: "Basketball", exact: true}).click();
    await expect(pageB.getByRole("button", {name: "Basketball", exact: true}))
      .toBeVisible({timeout: 20_000});

    expect(await pageA.evaluate(
      name => window.__blocksyncTask3!.selectTargetByName(name),
      "Basketball",
    )).toBe(true);
    expect(await pageB.evaluate(
      name => window.__blocksyncTask3!.selectTargetByName(name),
      "Basketball",
    )).toBe(true);

    const spriteA = await pageB.evaluate(() => {
      const names = window.__blocksyncTask3!.collaborationDebug().vmTargets
        .filter(target => !target.isStage)
        .map(target => target.name);
      return names.find(name => name !== "Basketball") ?? null;
    });
    expect(spriteA).toBeTruthy();

    // Per-target viewports must not leak across sprites.
    expect(await pageB.evaluate(name => {
      window.__blocksyncTask3!.selectTargetByName(name);
      window.__blocksyncTask3!.setActiveEditorTab(0);
      return window.__blocksyncTask3!.setWorkspaceViewport(0, 0, 0.675);
    }, spriteA)).toBe(true);
    expect(await pageB.evaluate(() => {
      window.__blocksyncTask3!.selectTargetByName("Basketball");
      window.__blocksyncTask3!.setActiveEditorTab(1);
      return window.__blocksyncTask3!.setWorkspaceViewport(48, -36, 1.1);
    })).toBe(true);
    const before = await pageB.evaluate(() =>
      window.__blocksyncTask3!.getLocalEditorUiState());
    expect(before?.activeTabIndex).toBe(1);
    expect(before?.viewport).toMatchObject({scrollX: 48, scrollY: -36, scale: 1.1});

    await pageA.evaluate(() =>
      window.__blocksyncTask3!.createTestBlockOnTarget(
        "ui-state-remote-block",
        "Basketball",
      ));
    await expect.poll(async () => ({
      hasBlock: await pageB.evaluate(() =>
        window.__blocksyncTask3!.hasBlockOnTarget(
          "ui-state-remote-block",
          "Basketball",
        )),
      editing: await pageB.evaluate(() =>
        window.__blocksyncTask3!.editingTargetName()),
      ui: await pageB.evaluate(() =>
        window.__blocksyncTask3!.getLocalEditorUiState()),
    }), {timeout: 30_000}).toMatchObject({
      hasBlock: true,
      editing: "Basketball",
      ui: {
        activeTabIndex: 1,
        viewport: {scrollX: 48, scale: 1.1},
      },
    });
    const afterScrollY = await pageB.evaluate(() =>
      window.__blocksyncTask3!.getLocalEditorUiState()?.viewport?.scrollY);
    // Allow a small Scratch resize nudge, but reject the default 0 reset.
    expect(afterScrollY).toBeLessThan(-10);

    // Sprite A's default viewport must remain default (no leak from Basketball).
    expect(await pageB.evaluate(name => {
      window.__blocksyncTask3!.selectTargetByName(name);
      window.__blocksyncTask3!.setActiveEditorTab(0);
      return window.__blocksyncTask3!.getLocalEditorUiState()?.viewport;
    }, spriteA)).toMatchObject({scrollX: 0, scrollY: 0, scale: 0.675});

    // Intentional return to default on Basketball must stick across remote apply.
    expect(await pageB.evaluate(() => {
      window.__blocksyncTask3!.selectTargetByName("Basketball");
      window.__blocksyncTask3!.setActiveEditorTab(0);
      return window.__blocksyncTask3!.setWorkspaceViewport(0, 0, 0.675);
    })).toBe(true);
    await pageA.evaluate(() =>
      window.__blocksyncTask3!.createTestBlockOnTarget(
        "ui-state-default-viewport-block",
        "Basketball",
      ));
    await expect.poll(async () => ({
      hasBlock: await pageB.evaluate(() =>
        window.__blocksyncTask3!.hasBlockOnTarget(
          "ui-state-default-viewport-block",
          "Basketball",
        )),
      viewport: await pageB.evaluate(() =>
        window.__blocksyncTask3!.getLocalEditorUiState()?.viewport),
    }), {timeout: 30_000}).toMatchObject({
      hasBlock: true,
      viewport: {scrollX: 0, scrollY: 0, scale: 0.675},
    });

    // Peer A keeps its own UI (code tab) — local contexts stay independent.
    await pageA.evaluate(() => window.__blocksyncTask3!.setActiveEditorTab(0));
    expect(await pageA.evaluate(() =>
      window.__blocksyncTask3!.getLocalEditorUiState()?.activeTabIndex)).toBe(0);
    expect(await pageB.evaluate(() => {
      window.__blocksyncTask3!.selectTargetByName("Basketball");
      window.__blocksyncTask3!.setActiveEditorTab(1);
      return window.__blocksyncTask3!.getLocalEditorUiState()?.activeTabIndex;
    })).toBe(1);
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});

test("real Blockly pan/zoom survives remote apply without diagnostic setters", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    {origin: "http://127.0.0.1:4173"},
  );
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await connectTwoCollabPeers(pageA, pageB, "shared-drive-real-viewport");

    await pageA.getByRole("button", {name: "スプライトを選ぶ", exact: true}).first().click();
    await pageA.getByRole("button", {name: "Basketball", exact: true}).click();
    await expect(pageB.getByRole("button", {name: "Basketball", exact: true}))
      .toBeVisible({timeout: 20_000});

    expect(await pageB.evaluate(() => {
      window.__blocksyncTask3!.selectTargetByName("Basketball");
      window.__blocksyncTask3!.setActiveEditorTab(0);
      return window.__blocksyncTask3!.editingTargetName();
    })).toBe("Basketball");

    const before = await pageB.evaluate(() => ({
      live: window.__blocksyncTask3!.getLiveWorkspaceViewport(),
      redux: window.__blocksyncTask3!.getReduxWorkspaceViewport(),
    }));
    expect(before.live).toBeTruthy();

    await panBlocklyWorkspace(pageB, -120, -80);
    await zoomBlocklyWorkspace(pageB, -180);

    let afterGesture!: {
      live: {scrollX: number; scrollY: number; scale: number};
      redux: {scrollX: number; scrollY: number; scale: number} | null;
    };
    await expect.poll(async () => {
      const current = await pageB.evaluate(() => ({
        live: window.__blocksyncTask3!.getLiveWorkspaceViewport(),
        redux: window.__blocksyncTask3!.getReduxWorkspaceViewport(),
      }));
      if (!current.live || !before.live) return null;
      const moved =
        current.live.scrollX !== before.live.scrollX ||
        current.live.scrollY !== before.live.scrollY ||
        current.live.scale !== before.live.scale;
      const reduxMatches = Boolean(
        current.redux &&
          current.redux.scrollX === current.live.scrollX &&
          current.redux.scrollY === current.live.scrollY &&
          current.redux.scale === current.live.scale,
      );
      if (moved && reduxMatches) {
        afterGesture = {
          live: current.live,
          redux: current.redux,
        };
        return true;
      }
      return false;
    }, {timeout: 10_000}).toBe(true);

    await pageA.evaluate(() =>
      window.__blocksyncTask3!.createTestBlockOnTarget(
        "real-viewport-remote-1",
        "Basketball",
      ));
    await expect.poll(async () => ({
      hasBlock: await pageB.evaluate(() =>
        window.__blocksyncTask3!.hasBlockOnTarget(
          "real-viewport-remote-1",
          "Basketball",
        )),
      live: await pageB.evaluate(() =>
        window.__blocksyncTask3!.getLiveWorkspaceViewport()),
      redux: await pageB.evaluate(() =>
        window.__blocksyncTask3!.getReduxWorkspaceViewport()),
    }), {timeout: 30_000}).toMatchObject({
      hasBlock: true,
      live: {
        scrollX: afterGesture.live.scrollX,
        scrollY: afterGesture.live.scrollY,
        scale: afterGesture.live.scale,
      },
      redux: {
        scrollX: afterGesture.live.scrollX,
        scrollY: afterGesture.live.scrollY,
        scale: afterGesture.live.scale,
      },
    });

    // Immediate second gesture (within the old 5s guard window) must win.
    await panBlocklyWorkspace(pageB, 90, 40);
    let secondGesture!: {scrollX: number; scrollY: number; scale: number};
    await expect.poll(async () => {
      const live = await pageB.evaluate(() =>
        window.__blocksyncTask3!.getLiveWorkspaceViewport());
      if (!live) return false;
      if (
        live.scrollX !== afterGesture.live.scrollX ||
        live.scrollY !== afterGesture.live.scrollY
      ) {
        secondGesture = live;
        return true;
      }
      return false;
    }, {timeout: 10_000}).toBe(true);

    await pageA.evaluate(() =>
      window.__blocksyncTask3!.createTestBlockOnTarget(
        "real-viewport-remote-2",
        "Basketball",
      ));
    await expect.poll(async () => ({
      hasBlock: await pageB.evaluate(() =>
        window.__blocksyncTask3!.hasBlockOnTarget(
          "real-viewport-remote-2",
          "Basketball",
        )),
      live: await pageB.evaluate(() =>
        window.__blocksyncTask3!.getLiveWorkspaceViewport()),
    }), {timeout: 30_000}).toMatchObject({
      hasBlock: true,
      live: {
        scrollX: secondGesture.scrollX,
        scrollY: secondGesture.scrollY,
        scale: secondGesture.scale,
      },
    });
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});

test("two Chromium contexts keep independent sprite selection across remote edits", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    {origin: "http://127.0.0.1:4173"},
  );
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await connectTwoCollabPeers(pageA, pageB, "shared-drive-selection");

    await pageA.getByRole("button", {name: "スプライトを選ぶ", exact: true}).first().click();
    await pageA.getByRole("button", {name: "Basketball", exact: true}).click();
    await expect(pageA.getByRole("button", {name: "Basketball", exact: true}))
      .toBeVisible();
    await expect(pageA.getByTestId("save-status")).toHaveText(
      "このパソコンに保存しました",
    );
    await expect(pageB.getByRole("button", {name: "Basketball", exact: true}))
      .toBeVisible({timeout: 20_000});
    await expect(pageB.getByTestId("save-status")).toHaveText(
      "このパソコンに保存しました",
    );

    const spriteA = await pageA.evaluate(() => {
      const names = window.__blocksyncTask3!.collaborationDebug().vmTargets
        .filter(target => !target.isStage)
        .map(target => target.name);
      return names.find(name => name !== "Basketball") ?? null;
    });
    expect(spriteA).toBeTruthy();

    expect(await pageA.evaluate(
      name => window.__blocksyncTask3!.selectTargetByName(name),
      "Basketball",
    )).toBe(true);
    expect(await pageB.evaluate(
      name => window.__blocksyncTask3!.selectTargetByName(name),
      "Basketball",
    )).toBe(true);
    expect(await pageA.evaluate(() =>
      window.__blocksyncTask3!.editingTargetName())).toBe("Basketball");
    expect(await pageB.evaluate(() =>
      window.__blocksyncTask3!.editingTargetName())).toBe("Basketball");

    await pageA.evaluate(() =>
      window.__blocksyncTask3!.createTestBlockOnTarget(
        "basketball-owned-by-a",
        "Basketball",
      ));
    await expect.poll(async () => ({
      bEditing: await pageB.evaluate(() =>
        window.__blocksyncTask3!.editingTargetName()),
      bHasBlock: await pageB.evaluate(() =>
        window.__blocksyncTask3!.hasBlockOnTarget(
          "basketball-owned-by-a",
          "Basketball",
        )),
      aEditing: await pageA.evaluate(() =>
        window.__blocksyncTask3!.editingTargetName()),
    }), {timeout: 20_000}).toEqual({
      bEditing: "Basketball",
      bHasBlock: true,
      aEditing: "Basketball",
    });
    await expect(pageB.getByTestId("save-status")).toHaveText(
      "このパソコンに保存しました",
    );

    expect(await pageB.evaluate(
      name => window.__blocksyncTask3!.selectTargetByName(name),
      spriteA,
    )).toBe(true);
    expect(await pageB.evaluate(() =>
      window.__blocksyncTask3!.editingTargetName())).toBe(spriteA);
    await pageB.evaluate(
      ({blockId, name}) =>
        window.__blocksyncTask3!.createTestBlockOnTarget(blockId, name),
      {blockId: "sprite-a-owned-by-b", name: spriteA!},
    );
    await expect.poll(async () => ({
      aEditing: await pageA.evaluate(() =>
        window.__blocksyncTask3!.editingTargetName()),
      aHasBlock: await pageA.evaluate(
        ({blockId, name}) =>
          window.__blocksyncTask3!.hasBlockOnTarget(blockId, name),
        {blockId: "sprite-a-owned-by-b", name: spriteA!},
      ),
      bEditing: await pageB.evaluate(() =>
        window.__blocksyncTask3!.editingTargetName()),
    }), {timeout: 20_000}).toEqual({
      aEditing: "Basketball",
      aHasBlock: true,
      bEditing: spriteA,
    });
    await expect(pageA.getByTestId("save-status")).toHaveText(
      "このパソコンに保存しました",
    );
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});

test("two Chromium contexts converge different-target edits over WebRTC and recover locally", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    {origin: "http://127.0.0.1:4173"},
  );
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await connectTwoCollabPeers(pageA, pageB, "shared-drive-converge");
  await expect(pageA.getByTestId("project-status-details")).toContainText(
    "1人といっしょに作っています",
  );
  await expect(pageB.getByTestId("project-status-details")).toContainText(
    "1人といっしょに作っています",
  );
  await openPanel(pageA, "collab-panel");
  await pageA.getByRole("button", {name: "リンクをコピー"}).click();
  await expect(pageA.locator("#collab-feedback")).toHaveText(
    "コピーしました。いっしょに作りたい友だちに送ってね。",
  );

  // Exercise the real Scratch library path, not a synthetic target with
  // pre-injected bytes. The collaboration memory helper must fall through to
  // Scratch's CDN before the new target can be saved and published.
  await pageA.getByRole("button", {name: "スプライトを選ぶ", exact: true}).first().click();
  await pageA.getByRole("button", {name: "Basketball", exact: true}).click();
  await expect(pageA.getByRole("button", {name: "Basketball", exact: true}))
    .toBeVisible();
  await expect(pageA.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  await expect(pageB.getByRole("button", {name: "Basketball", exact: true}))
    .toBeVisible({timeout: 20_000});
  await expect(pageB.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );

  const defaultSprite = await pageA.evaluate(() => {
    const names = window.__blocksyncTask3!.collaborationDebug().vmTargets
      .filter(target => !target.isStage)
      .map(target => target.name);
    return names.find(name => name !== "Basketball") ?? names[0] ?? null;
  });
  expect(defaultSprite).toBeTruthy();

  await Promise.all([
    pageA.evaluate(() =>
      window.__blocksyncTask3!.createTestBlock("stage-collab-block", true)),
    pageB.evaluate(
      name => window.__blocksyncTask3!.createTestBlockOnTarget(
        "sprite-collab-block",
        name,
      ),
      defaultSprite,
    ),
  ]);
  await expect.poll(async () => ({
    aSeesSpriteBlock: await pageA.evaluate(
      name => window.__blocksyncTask3!.hasBlockOnTarget(
        "sprite-collab-block",
        name,
      ),
      defaultSprite,
    ),
    bSeesStageBlock: await pageB.evaluate(() =>
      window.__blocksyncTask3!.hasBlock("stage-collab-block", true)),
    aDebug: await pageA.evaluate(() =>
      window.__blocksyncTask3!.collaborationDebug()),
    bDebug: await pageB.evaluate(() =>
      window.__blocksyncTask3!.collaborationDebug()),
  }), {timeout: 60_000}).toMatchObject({
    aSeesSpriteBlock: true,
    bSeesStageBlock: true,
  });
  // Blockly only renders the editing target. Adding Basketball leaves that sprite
  // selected, so switch back to the sprite that received the remote block.
  expect(await pageA.evaluate(
    name => window.__blocksyncTask3!.selectTargetByName(name),
    defaultSprite,
  )).toBe(true);
  // The receiving VM and the actual Scratch Blockly workspace must both move.
  // This distinguishes transport/domain convergence from a stale GUI surface.
  await expect(pageA.locator('[data-id="sprite-collab-block"]')).toHaveCount(1);

  await expect(pageA.getByTestId("status-icon-collab")).toContainText("online");
  await expect(pageA.getByTestId("status-icon-collab")).toHaveAttribute(
    "title",
    /ホスト/,
  );
  await expect(pageB.getByTestId("status-icon-avatar")).toHaveAttribute(
    "title",
    /ゲスト/,
  );
  await expect(pageA.getByTestId("status-icon-avatar")).toContainText("2");
  await openPanel(pageA, "collab-panel");
  await expect(pageA.getByTestId("collab-status")).toContainText("ホスト");
  await openPanel(pageB, "collab-panel");
  await expect(pageB.getByTestId("collab-status")).toContainText("ゲスト");
  await expect(pageB.getByTestId("collab-status")).not.toContainText("リーダー");
  await expect(pageB.getByTestId("drive-status")).toContainText(
    "ゲストのあいだは Google ドライブに保存できません",
  );
  await expect(pageB.locator("#save-drive")).toBeDisabled();
  await pageA.getByRole("button", {name: "いっしょに作るのをやめる"}).click();
  await pageB.evaluate(() =>
    window.__blocksyncTask3!.createTestBlock("handoff-block"));
  await expect(pageB.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  expect(await pageB.evaluate(async () =>
    (await window.__blocksyncTask3!.exportSb3()).length)).toBeGreaterThan(0);
  await openPanel(pageB, "collab-panel");
  await pageB.getByRole("button", {name: "いっしょに作るのをやめる"}).click();

  await Promise.all([
    pageA.waitForFunction(() => window.__blocksyncTask3!.getState().saveState === "clean"),
    pageB.waitForFunction(() => window.__blocksyncTask3!.getState().saveState === "clean"),
  ]);
  await Promise.all([pageA.reload(), pageB.reload()]);
  await Promise.all([
    pageA.waitForFunction(() => window.__blocksyncTask3?.ready === true),
    pageB.waitForFunction(() => window.__blocksyncTask3?.ready === true),
  ]);
  expect(await pageA.evaluate(
    name => window.__blocksyncTask3!.hasBlockOnTarget("sprite-collab-block", name),
    defaultSprite,
  )).toBe(true);
  expect(await pageB.evaluate(() =>
    window.__blocksyncTask3!.hasBlock("stage-collab-block", true))).toBe(true);
  expect(await pageA.evaluate(async () => (await window.__blocksyncTask3!.exportSb3()).length)).toBeGreaterThan(0);
  expect(await pageB.evaluate(async () => (await window.__blocksyncTask3!.exportSb3()).length)).toBeGreaterThan(0);
  await Promise.all([contextA.close(), contextB.close()]);
});
});

test("corrupt stored assets recover automatically on save", async ({page}) => {
  await waitUntilReady(page);
  const originalId = await page.evaluate(
    () => window.__blocksyncTask3!.getState().localProjectId,
  );
  await page.evaluate(async () => {
    await window.__blocksyncTask3!.corruptStoredAssets();
    window.__blocksyncTask3!.createTestBlock("recovered-after-corrupt");
  });

  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  const recoveredId = await page.evaluate(
    () => window.__blocksyncTask3!.getState().localProjectId,
  );
  expect(recoveredId).not.toBe(originalId);
  expect(await page.evaluate(
    () => window.__blocksyncTask3!.localProjectIds(),
  )).toEqual(expect.arrayContaining([originalId, recoveredId]));

  await page.reload();
  await page.waitForFunction(() => window.__blocksyncTask3?.ready === true);
  expect(await page.evaluate(
    () => window.__blocksyncTask3!.getState().localProjectId,
  )).toBe(recoveredId);
  expect(await page.evaluate(
    () => window.__blocksyncTask3!.hasBlock("recovered-after-corrupt"),
  )).toBe(true);
});

test("unified status shows local save as primary with optional secondary details", async ({
  page,
}) => {
  await waitUntilReady(page);
  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  await expect(page.getByTestId("project-status-details")).toBeHidden();
  await expect(page.getByTestId("status-icon-local")).toBeVisible();
  await expect(page.getByTestId("status-icon-local")).toHaveAttribute(
    "title",
    "このパソコンに保存しました",
  );
  await expect(page.getByTestId("status-icon-drive")).toHaveCount(0);
});

test("signaling outage leaves local editing and SB3 export available", async ({
  context,
  page,
}) => {
  await waitUntilReady(page);
  await page.evaluate(() =>
    window.__blocksyncTask3!.configureCollaborationTestGate("offline-drive"),
  );
  await openPanel(page, "collab-panel");
  await context.setOffline(true);
  await page.getByRole(
    "button",
    {name: "いっしょに作るリンクを作る"},
  ).click();
  await expect(page.getByTestId("collab-status")).toContainText(
    "友だちとのつながりが切れました",
  );

  await page.evaluate(() => window.__blocksyncTask3!.renameTarget(false, "Offline edit"));
  expect(await page.evaluate(async () => (await window.__blocksyncTask3!.exportSb3()).length)).toBeGreaterThan(0);
  await context.setOffline(false);
  await expect(page.getByTestId("save-status")).toHaveText(
    "このパソコンに保存しました",
  );
  await page.reload();
  await page.waitForFunction(() => window.__blocksyncTask3?.ready === true);
  expect(await page.evaluate(() =>
    window.__blocksyncTask3!.targetName(false))).toBe("Offline edit");
});

declare global {
  interface Window {
    __blocksyncTask3?: {
      ready: boolean;
      error: string | null;
      createTestBlock(id: string, isStage?: boolean): void;
      createTestBlockOnTarget(id: string, targetName: string): void;
      hasBlock(id: string, isStage?: boolean): boolean;
      hasBlockOnTarget(id: string, targetName: string): boolean;
      selectTargetByName(targetName: string): boolean;
      editingTargetName(): string | null;
      getLocalEditorUiState(): {
        activeTabIndex: number;
        viewport: {scrollX: number; scrollY: number; scale: number} | null;
        toolboxCategoryId: string | null;
      } | null;
      getReduxWorkspaceViewport(): {
        scrollX: number;
        scrollY: number;
        scale: number;
      } | null;
      getLiveWorkspaceViewport(): {
        scrollX: number;
        scrollY: number;
        scale: number;
      } | null;
      setActiveEditorTab(activeTabIndex: number): void;
      setWorkspaceViewport(scrollX: number, scrollY: number, scale: number): boolean;
      selectToolboxCategory(categoryId: string): boolean;
      getState(): {
        localProjectId: string;
        revision: number;
        saveState: string;
      };
      exportSb3(): Promise<Uint8Array>;
      importSb3(bytes: Uint8Array, title: string): Promise<void>;
      failNextWrite(): void;
      corruptStoredAssets(): Promise<void>;
      localProjectIds(): Promise<string[]>;
      configureCollaborationTestGate(driveFileId: string): Promise<void>;
      renameTarget(isStage: boolean, name: string): void;
      targetName(isStage: boolean): string | undefined;
      collaborationDebug(): {
        state: {role: "solo" | "leader" | "follower"} | null;
        vmTargets: Array<{isStage: boolean; name: string}>;
      };
    };
  }
}
