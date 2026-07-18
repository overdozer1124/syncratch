import {describe, expect, it, vi} from "vitest";
import {
  LocalDriveSaveError,
  LocalProjectChangedDuringDriveSaveError,
  prepareCommittedDriveExport,
} from "./drive-export.js";

describe("prepareCommittedDriveExport", () => {
  it.each(["dirty", "saving", "error", "conflict"] as const)(
    "rejects %s local state before exporting bytes",
    async state => {
      const exportCommitted = vi.fn(async () => new Uint8Array([1]));

      await expect(prepareCommittedDriveExport({
        localProjectId: "local-1",
        flush: async () => undefined,
        getSaveState: () => state,
        getCurrentProjectId: () => "local-1",
        exportCommitted,
      })).rejects.toMatchObject({
        name: "LocalDriveSaveError",
        state,
      });
      expect(exportCommitted).not.toHaveBeenCalled();
    },
  );

  it("exports committed bytes only after a clean flush", async () => {
    const order: string[] = [];
    const result = await prepareCommittedDriveExport({
      localProjectId: "local-1",
      flush: async () => {
        order.push("flush");
      },
      getSaveState: () => "clean",
      getCurrentProjectId: () => "local-1",
      exportCommitted: async () => {
        order.push("export");
        return new Uint8Array([1, 2, 3]);
      },
    });

    expect(result).toEqual(new Uint8Array([1, 2, 3]));
    expect(order).toEqual(["flush", "export"]);
  });

  it("rejects when the active project changes during committed export", async () => {
    let projectId = "local-1";

    await expect(prepareCommittedDriveExport({
      localProjectId: "local-1",
      flush: async () => undefined,
      getSaveState: () => "clean",
      getCurrentProjectId: () => projectId,
      exportCommitted: async () => {
        projectId = "local-2";
        return new Uint8Array([1]);
      },
    })).rejects.toBeInstanceOf(LocalProjectChangedDuringDriveSaveError);
  });

  it("uses a typed local save error", () => {
    expect(new LocalDriveSaveError("conflict").state).toBe("conflict");
  });
});
