import { afterEach, describe, expect, it } from "vitest";
import { createAdapter } from "@blocksync/scratch-adapter";
import { equivalenceProduction } from "@blocksync/sb3-tools";
import { createPersistClient, openProjectSession } from "./index.js";
import { makeNarrowHostApp } from "./test-harness/persist-app.js";

const dirs: Array<() => void> = [];

afterEach(() => {
  while (dirs.length > 0) {
    dirs.pop()!();
  }
});

describe("narrow Scratch host (Task 10)", () => {
  it("open → §7.3 assets → edit+autosave → persist reload → export/re-import equivalence", async () => {
    const { app, close, buildImportSb3Bytes } = makeNarrowHostApp();
    dirs.push(close);

    const client = createPersistClient({
      fetch: (path: string, init?: RequestInit) => app.request(path, init),
      baseHeaders: { "x-user-id": "user-a" },
    });

    const sb3 = await buildImportSb3Bytes();
    const imported = await client.importSb3("Base", sb3);
    expect(imported.schemaVersion).toBe(2);
    expect(imported.revision).toBe(0);

    const handle = await createAdapter();
    const session = await openProjectSession({
      client,
      projectId: imported.projectId,
      handle,
    });
    expect(session.revision).toBe(0);

    const sprite = handle.vm.runtime.targets.find(
      (t: { isStage: boolean }) => !t.isStage,
    );
    expect(sprite?.sprite?.costumes?.[0]?.asset?.data).toBeInstanceOf(Uint8Array);

    const blocks = sprite.blocks;
    blocks.createBlock({
      id: "hat",
      opcode: "event_whenflagclicked",
      next: null,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 40,
      y: 60,
    });

    session.notifyEdit(handle);
    await session.flush();
    expect(session.autosave.getState()).toBe("clean");

    // Persist-side reload: GET head must retain the edit (process-restart equivalent).
    const afterSave = await client.getProject(imported.projectId);
    expect(afterSave.revision).toBe(1);
    const spriteDoc = afterSave.document.targets.find((t) => !t.isStage)!;
    const hat = spriteDoc.blocks.hat;
    expect(hat && !Array.isArray(hat) && hat.opcode).toBe("event_whenflagclicked");

    const editedDoc = afterSave.document;
    const zip = await client.exportSb3(imported.projectId);
    const reimported = await client.importSb3("Reimport", zip);
    const reDoc = await client.getProject(reimported.projectId);
    expect(equivalenceProduction(reDoc.document, editedDoc)).toBe(true);

    session.dispose();
    handle.dispose();
  });
});
