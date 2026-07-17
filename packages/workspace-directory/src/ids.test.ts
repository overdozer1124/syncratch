import {describe, expect, it} from "vitest";
import {
  parseDirectoryRevision,
  parseIsoDate,
  parsePersonId,
  parseUtcDateTime,
  parseWorkspaceId,
} from "./ids.js";

describe("workspace-directory ids", () => {
  it("accepts non-empty trimmed ids", () => {
    expect(parsePersonId("person-1")).toEqual({
      ok: true,
      value: "person-1",
    });
    expect(parseWorkspaceId("ws-1")).toEqual({ok: true, value: "ws-1"});
    expect(parsePersonId("  person-1  ")).toEqual({
      ok: true,
      value: "person-1",
    });
  });

  it("rejects empty and whitespace-only ids without throwing", () => {
    expect(parsePersonId("")).toMatchObject({ok: false});
    expect(parsePersonId("   ")).toMatchObject({ok: false});
  });

  it("parses strict, real IsoDate values", () => {
    expect(parseIsoDate("2026-07-17")).toEqual({
      ok: true,
      value: "2026-07-17",
    });
    expect(parseIsoDate("2026-7-17")).toMatchObject({ok: false});
    expect(parseIsoDate("2026-02-30")).toMatchObject({ok: false});
  });

  it("requires valid UTC date-times with a Z suffix", () => {
    expect(parseUtcDateTime("2026-07-17T12:00:00.000Z")).toEqual({
      ok: true,
      value: "2026-07-17T12:00:00.000Z",
    });
    expect(parseUtcDateTime("2026-07-17T12:00:00+09:00")).toMatchObject({
      ok: false,
    });
    expect(parseUtcDateTime("2026-02-30T12:00:00.000Z")).toMatchObject({
      ok: false,
    });
  });

  it("parses non-negative safe integer directory revisions", () => {
    expect(parseDirectoryRevision(0)).toEqual({ok: true, value: 0});
    expect(parseDirectoryRevision(12)).toEqual({ok: true, value: 12});
    expect(parseDirectoryRevision(-1)).toMatchObject({ok: false});
    expect(parseDirectoryRevision(1.5)).toMatchObject({ok: false});
    expect(parseDirectoryRevision(Number.NaN)).toMatchObject({ok: false});
    expect(parseDirectoryRevision(Number.MAX_SAFE_INTEGER + 1)).toMatchObject({
      ok: false,
    });
  });
});
