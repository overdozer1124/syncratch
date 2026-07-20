import {expect, test, type Page} from "@playwright/test";

const TEST_BLOCK_ID = "task3-test-block";

async function waitUntilReady(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      window.__blocksyncTask3?.ready === true ||
      window.__blocksyncTask3?.error !== null,
  );
  expect(await page.evaluate(() => window.__blocksyncTask3?.error)).toBeNull();
}

test("fresh load mounts the standalone GUI and reports local save ready", async ({
  page,
}) => {
  await waitUntilReady(page);

  await expect(page.locator('[data-testid="scratch-gui"]')).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  expect(
    await page.evaluate(() => window.__blocksyncTask3?.getState().revision),
  ).toBe(0);
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

  await expect(page.getByTestId("drive-status")).toHaveText("Not configured");
  await expect(
    page.getByRole("button", {name: "Connect Google"}),
  ).toBeDisabled();
  await page.evaluate(
    id => window.__blocksyncTask3!.createTestBlock(id),
    "drive-unconfigured-local-block",
  );
  await expect(page.getByTestId("save-status")).toHaveText("Saved");

  expect(googleRequests).toEqual([]);
});

test("VM block mutation autosaves and survives reload", async ({page}) => {
  await waitUntilReady(page);

  await page.evaluate(
    id => window.__blocksyncTask3!.createTestBlock(id),
    TEST_BLOCK_ID,
  );
  await expect(page.getByTestId("save-status")).toHaveText("Saved");

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
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
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

  await expect(page.getByTestId("save-status")).toHaveText("Import failed");
  expect(
    await page.evaluate(() => window.__blocksyncTask3!.getState().localProjectId),
  ).toBe(originalId);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download to this device"}).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.sb3$/);

  await page.locator("#open-file").setInputFiles({
    name: "retry.sb3",
    mimeType: "application/x.scratch.sb3",
    buffer: Buffer.from(validBytes),
  });
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
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

  await expect(page.getByTestId("save-status")).toHaveText("Save failed");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download to this device"}).click();
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
      ["document", "script", "stylesheet"].includes(request.resourceType());
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
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
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

test("two Chromium contexts converge different-target edits over WebRTC and recover locally", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([waitUntilReady(pageA), waitUntilReady(pageB)]);
  await Promise.all([
    pageA.evaluate(() =>
      window.__blocksyncTask3!.configureCollaborationTestGate("shared-drive"),
    ),
    pageB.evaluate(() =>
      window.__blocksyncTask3!.configureCollaborationTestGate("shared-drive"),
    ),
  ]);

  await pageA.getByRole("button", {name: "Create room"}).click();
  await expect(pageA.getByTestId("collab-status")).toContainText("leader");
  const invite = await pageA.getByLabel("Collaboration invite").inputValue();
  await pageB.getByLabel("Collaboration invite").fill(invite);
  await pageB.getByRole("button", {name: "Join invite"}).click();
  await expect(pageA.getByTestId("collab-status")).toContainText("1 peer");
  await expect(pageB.getByTestId("collab-status")).toContainText("1 peer");

  await Promise.all([
    pageA.evaluate(() =>
      window.__blocksyncTask3!.createTestBlock("stage-collab-block", true)),
    pageB.evaluate(() =>
      window.__blocksyncTask3!.createTestBlock("sprite-collab-block")),
  ]);
  await expect.poll(async () => ({
    aSeesSpriteBlock: await pageA.evaluate(() =>
      window.__blocksyncTask3!.hasBlock("sprite-collab-block")),
    bSeesStageBlock: await pageB.evaluate(() =>
      window.__blocksyncTask3!.hasBlock("stage-collab-block", true)),
    aDebug: await pageA.evaluate(() =>
      window.__blocksyncTask3!.collaborationDebug()),
    bDebug: await pageB.evaluate(() =>
      window.__blocksyncTask3!.collaborationDebug()),
  }), {timeout: 20_000}).toMatchObject({
    aSeesSpriteBlock: true,
    bSeesStageBlock: true,
  });

  const roleA = await pageA.evaluate(() =>
    window.__blocksyncTask3!.collaborationDebug().state?.role);
  const leaderPage = roleA === "leader" ? pageA : pageB;
  const followerPage = roleA === "leader" ? pageB : pageA;
  await leaderPage.getByRole("button", {name: "Leave room"}).click();
  await expect(followerPage.getByTestId("collab-status")).toContainText("leader");
  await followerPage.evaluate(() =>
    window.__blocksyncTask3!.createTestBlock("handoff-block"));
  await expect(followerPage.getByTestId("save-status")).toHaveText("Saved");
  expect(await followerPage.evaluate(async () =>
    (await window.__blocksyncTask3!.exportSb3()).length)).toBeGreaterThan(0);
  await followerPage.getByRole("button", {name: "Leave room"}).click();

  await Promise.all([
    pageA.waitForFunction(() => window.__blocksyncTask3!.getState().saveState === "clean"),
    pageB.waitForFunction(() => window.__blocksyncTask3!.getState().saveState === "clean"),
  ]);
  await Promise.all([pageA.reload(), pageB.reload()]);
  await Promise.all([
    pageA.waitForFunction(() => window.__blocksyncTask3?.ready === true),
    pageB.waitForFunction(() => window.__blocksyncTask3?.ready === true),
  ]);
  expect(await pageA.evaluate(() =>
    window.__blocksyncTask3!.hasBlock("sprite-collab-block"))).toBe(true);
  expect(await pageB.evaluate(() =>
    window.__blocksyncTask3!.hasBlock("stage-collab-block", true))).toBe(true);
  expect(await pageA.evaluate(async () => (await window.__blocksyncTask3!.exportSb3()).length)).toBeGreaterThan(0);
  expect(await pageB.evaluate(async () => (await window.__blocksyncTask3!.exportSb3()).length)).toBeGreaterThan(0);
  await Promise.all([contextA.close(), contextB.close()]);
});

test("signaling outage leaves local editing and SB3 export available", async ({
  context,
  page,
}) => {
  await waitUntilReady(page);
  await page.evaluate(() =>
    window.__blocksyncTask3!.configureCollaborationTestGate("offline-drive"),
  );
  await context.setOffline(true);
  await page.getByRole("button", {name: "Create room"}).click();
  await expect(page.getByTestId("collab-status")).toContainText("disconnected");

  await page.evaluate(() => window.__blocksyncTask3!.renameTarget(false, "Offline edit"));
  expect(await page.evaluate(async () => (await window.__blocksyncTask3!.exportSb3()).length)).toBeGreaterThan(0);
  await context.setOffline(false);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
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
      hasBlock(id: string, isStage?: boolean): boolean;
      getState(): {
        localProjectId: string;
        revision: number;
        saveState: string;
      };
      exportSb3(): Promise<Uint8Array>;
      importSb3(bytes: Uint8Array, title: string): Promise<void>;
      failNextWrite(): void;
      configureCollaborationTestGate(driveFileId: string): Promise<void>;
      renameTarget(isStage: boolean, name: string): void;
      targetName(isStage: boolean): string | undefined;
      collaborationDebug(): {
        state: {role: "solo" | "leader" | "follower"} | null;
      };
    };
  }
}
