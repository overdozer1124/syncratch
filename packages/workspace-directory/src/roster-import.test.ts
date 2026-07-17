import {describe, expect, it} from "vitest";
import {
  parseDirectoryRevision,
  parseRosterImportId,
} from "./ids.js";
import {
  parsePreviewHash,
  validateRosterImportApplyRequest,
  type RosterImportApplyRequest,
  type RosterPreviewCategory,
} from "./roster-import.js";

const VALID_HASH =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("roster import contracts", () => {
  it("exposes the closed preview category union from the design", () => {
    const categories: RosterPreviewCategory[] = [
      "add_person",
      "update_display_fields",
      "new_enrollment",
      "class_move",
      "end_enrollment",
      "duplicate_candidate",
      "attendance_collision",
      "ambiguous_account_link",
      "rejected_row",
    ];
    expect(categories).toHaveLength(9);
  });

  it("accepts lowercase hex SHA-256 preview hashes", () => {
    expect(parsePreviewHash(VALID_HASH)).toEqual({
      ok: true,
      value: VALID_HASH,
    });
  });

  it("rejects missing or malformed preview hashes without throwing", () => {
    expect(parsePreviewHash("")).toMatchObject({ok: false});
    expect(parsePreviewHash("ABCDEF")).toMatchObject({ok: false});
    expect(
      parsePreviewHash(
        "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
      ),
    ).toMatchObject({ok: false});
    expect(parsePreviewHash(VALID_HASH.slice(0, 63))).toMatchObject({
      ok: false,
    });
    expect(parsePreviewHash(`${VALID_HASH}0`)).toMatchObject({ok: false});
    expect(parsePreviewHash(`${VALID_HASH.slice(0, 63)}g`)).toMatchObject({
      ok: false,
    });
  });

  it("validates a structurally complete apply request", () => {
    const importId = parseRosterImportId("import-1");
    const revision = parseDirectoryRevision(3);
    if (!importId.ok || !revision.ok) throw new Error("fixture");

    const request: RosterImportApplyRequest = {
      importId: importId.value,
      previewHash: VALID_HASH,
      baseDirectoryRevision: revision.value,
    };

    expect(validateRosterImportApplyRequest(request)).toEqual({
      ok: true,
      value: request,
    });
  });

  it("rejects apply requests with invalid import id, hash, or revision", () => {
    const importId = parseRosterImportId("import-1");
    const revision = parseDirectoryRevision(0);
    if (!importId.ok || !revision.ok) throw new Error("fixture");

    expect(
      validateRosterImportApplyRequest({
        importId: "" as RosterImportApplyRequest["importId"],
        previewHash: VALID_HASH,
        baseDirectoryRevision: revision.value,
      }),
    ).toMatchObject({ok: false});

    expect(
      validateRosterImportApplyRequest({
        importId: importId.value,
        previewHash: "not-a-hash",
        baseDirectoryRevision: revision.value,
      }),
    ).toMatchObject({ok: false});

    expect(
      validateRosterImportApplyRequest({
        importId: importId.value,
        previewHash: VALID_HASH,
        baseDirectoryRevision: -1 as RosterImportApplyRequest["baseDirectoryRevision"],
      }),
    ).toMatchObject({ok: false});

    expect(
      validateRosterImportApplyRequest({
        importId: importId.value,
        previewHash: VALID_HASH,
        baseDirectoryRevision: 1.5 as RosterImportApplyRequest["baseDirectoryRevision"],
      }),
    ).toMatchObject({ok: false});
  });

  it("does not throw for ordinary invalid apply input", () => {
    expect(() =>
      validateRosterImportApplyRequest({
        importId: "   " as RosterImportApplyRequest["importId"],
        previewHash: "",
        baseDirectoryRevision: Number.NaN as RosterImportApplyRequest["baseDirectoryRevision"],
      }),
    ).not.toThrow();
  });
});
