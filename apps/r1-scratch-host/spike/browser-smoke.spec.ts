import { test, expect } from "@playwright/test";

test("§7.3 browser smoke: GUI mounts, renders costume, GUI vm block edits", async ({
  page,
}) => {
  await page.goto("/");

  await page.waitForFunction(
    () =>
      window.__blocksyncTask0?.ready === true || window.__blocksyncTask0?.error,
    { timeout: 90_000 },
  );

  const bootError = await page.evaluate(() => window.__blocksyncTask0?.error);
  expect(bootError, bootError ?? "bootstrap failed").toBeNull();

  const hasOrange = await page.evaluate(() => {
    return window.__blocksyncTask0?.stageHasOrangeCat?.() === true;
  });
  expect(hasOrange).toBe(true);

  const blockSmoke = await page.evaluate(() => {
    try {
      return window.__blocksyncTask0.runBlockMutationSmoke();
    } catch (e) {
      return String((e as Error)?.message ?? e);
    }
  });
  expect(blockSmoke).toBe(true);
});

declare global {
  interface Window {
    __blocksyncTask0?: {
      ready: boolean;
      error: string | null;
      vm: unknown;
      runBlockMutationSmoke: () => boolean;
      stageHasOrangeCat: () => boolean;
    };
  }
}
