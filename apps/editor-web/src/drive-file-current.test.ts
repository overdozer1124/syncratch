import {describe, expect, it, vi} from "vitest";
import {
  LOCAL_PROJECT_FORMAT,
  type LocalProjectRecord,
} from "@blocksync/project-local-core";
import {emptyProject} from "@blocksync/project-schema";
import {persistDriveFileIdAndSyncCurrent} from "./drive-file-current.js";

function record(revision: number, driveFileId?: string): LocalProjectRecord {
  return {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId: "local-1",
    title: "Local",
    revision,
    updatedAt: "2026-07-19T00:00:00.000Z",
    document: emptyProject(),
    assets: [],
    saveState: "clean",
    ...(driveFileId ? {driveFileId} : {}),
  };
}

describe("persistDriveFileIdAndSyncCurrent", () => {
  it("updates matching global current before surfacing a post-commit abort", async () => {
    const controller = new AbortController();
    let current = record(0);
    const saved = record(1, "reserved-id");

    await expect(persistDriveFileIdAndSyncCurrent({
      store: {
        get: async () => record(0),
        createOrReplace: async () => {
          controller.abort();
          return saved;
        },
      },
      driveFileId: "reserved-id",
      localProjectId: "local-1",
      signal: controller.signal,
      getCurrent: () => current,
      setCurrent: next => {
        current = next;
      },
    })).rejects.toMatchObject({name: "AbortError"});

    expect(current).toEqual(saved);
  });

  it("surfaces a post-commit abort safely when no project is active", async () => {
    const controller = new AbortController();
    const setCurrent = vi.fn();

    await expect(persistDriveFileIdAndSyncCurrent({
      store: {
        get: async () => record(0),
        createOrReplace: async () => {
          controller.abort();
          return record(1, "reserved-id");
        },
      },
      driveFileId: "reserved-id",
      localProjectId: "local-1",
      signal: controller.signal,
      getCurrent: () => undefined,
      setCurrent,
    })).rejects.toMatchObject({name: "AbortError"});

    expect(setCurrent).not.toHaveBeenCalled();
  });
});
