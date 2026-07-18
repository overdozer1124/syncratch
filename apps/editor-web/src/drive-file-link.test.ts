import {describe, expect, it, vi} from "vitest";
import {
  LOCAL_PROJECT_FORMAT,
  type LocalProjectRecord,
} from "@blocksync/project-local-core";
import {ProjectStoreRevisionConflictError} from "@blocksync/project-store-idb";
import {emptyProject} from "@blocksync/project-schema";
import {persistDriveFileLink} from "./drive-file-link.js";

function record(revision: number, title: string): LocalProjectRecord {
  return {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId: "local-1",
    title,
    revision,
    updatedAt: "2026-07-19T00:00:00.000Z",
    document: emptyProject(),
    assets: [],
    saveState: "clean",
  };
}

describe("persistDriveFileLink", () => {
  it("retries a local revision conflict and preserves the latest record", async () => {
    const first = record(1, "before concurrent save");
    const latest = record(2, "after concurrent save");
    const get = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(latest);
    const createOrReplace = vi.fn()
      .mockRejectedValueOnce(new ProjectStoreRevisionConflictError(
        1,
        2,
      ))
      .mockImplementationOnce(async (next: LocalProjectRecord) => next);

    const saved = await persistDriveFileLink(
      {get, createOrReplace},
      "local-1",
      "drive-1",
      () => "2026-07-19T01:00:00.000Z",
    );

    expect(saved).toMatchObject({
      title: "after concurrent save",
      revision: 3,
      driveFileId: "drive-1",
    });
    expect(createOrReplace).toHaveBeenCalledTimes(2);
  });

  it("does not start the IDB write when aborted after reading", async () => {
    const controller = new AbortController();
    const get = vi.fn(async () => {
      controller.abort();
      return record(1, "current");
    });
    const createOrReplace = vi.fn();

    await expect(persistDriveFileLink(
      {get, createOrReplace},
      "local-1",
      "reserved-id",
      () => "2026-07-19T01:00:00.000Z",
      controller.signal,
    )).rejects.toMatchObject({name: "AbortError"});
    expect(createOrReplace).not.toHaveBeenCalled();
  });
});
