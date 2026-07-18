import {describe, expect, it} from "vitest";
import {emptyProject} from "@blocksync/project-schema";
import {
  LOCAL_PROJECT_FORMAT,
  validateLocalProjectRecord,
  type LocalProjectRecord,
} from "./index.js";

function validRecord(): LocalProjectRecord {
  return {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId: "local-project-1",
    title: "My project",
    revision: 2,
    updatedAt: "2026-07-19T00:00:00.000Z",
    document: emptyProject(),
    assets: [
      {
        md5ext: "d41d8cd98f00b204e9800998ecf8427e.svg",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
    saveState: "dirty",
    driveFileId: "drive-file-1",
  };
}

describe("validateLocalProjectRecord", () => {
  it("accepts a complete v1 record and preserves typed-array bytes", () => {
    const candidate = validRecord();

    const result = validateLocalProjectRecord(candidate);

    expect(result).toEqual({ok: true, value: candidate});
    if (result.ok) {
      expect(result.value.assets[0]!.bytes).toBe(candidate.assets[0]!.bytes);
      expect(result.value.assets[0]!.bytes).toBeInstanceOf(Uint8Array);
    }
  });

  it("accepts a record without a Drive file ID", () => {
    const {driveFileId: _driveFileId, ...candidate} = validRecord();

    expect(validateLocalProjectRecord(candidate).ok).toBe(true);
  });

  it.each([
    ["unknown format", {format: "blocksync.local-project/v2"}],
    ["negative revision", {revision: -1}],
    ["fractional revision", {revision: 1.5}],
    ["invalid updatedAt", {updatedAt: "not-a-date"}],
    ["invalid save state", {saveState: "saved"}],
    ["malformed assets collection", {assets: {}}],
    [
      "malformed asset bytes",
      {
        assets: [
          {
            md5ext: "d41d8cd98f00b204e9800998ecf8427e.svg",
            bytes: [1, 2, 3],
          },
        ],
      },
    ],
    [
      "malformed asset key",
      {assets: [{md5ext: "", bytes: new Uint8Array()}]},
    ],
    ["invalid ProjectDocument", {document: {schemaVersion: 1, targets: null}}],
  ])("rejects %s", (_label, patch) => {
    expect(
      validateLocalProjectRecord({...validRecord(), ...patch}),
    ).toMatchObject({ok: false});
  });

  it.each(["organizationId", "updatedByUserId"])(
    "rejects server identity field %s",
    field => {
      expect(
        validateLocalProjectRecord({...validRecord(), [field]: "fake"}),
      ).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({path: field}),
        ]),
      });
    },
  );
});
