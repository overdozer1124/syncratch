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
  await page.getByRole("button", {name: "Download .sb3"}).click();
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
  await page.getByRole("button", {name: "Download .sb3"}).click();
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

declare global {
  interface Window {
    __blocksyncTask3?: {
      ready: boolean;
      error: string | null;
      createTestBlock(id: string): void;
      hasBlock(id: string): boolean;
      getState(): {
        localProjectId: string;
        revision: number;
        saveState: string;
      };
      exportSb3(): Promise<Uint8Array>;
      importSb3(bytes: Uint8Array, title: string): Promise<void>;
      failNextWrite(): void;
    };
  }
}
