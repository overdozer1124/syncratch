import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateProject, type ProjectDocument } from "@blocksync/project-schema";
import {
  PROJECT_FORMAT,
  assertEnvelope,
  canonicalizeDocument,
  contentHash,
  customProcedureFixtureDocument,
  emptyDocument,
  requestHash,
  richFixtureDocument,
} from "./index.js";

/** Pinned V1 golden hashes (Design §5.2 — must not change). */
const V1_EMPTY_HASH =
  "0cc517f62f40c66b669ccb7c6c3bf49ec257a12cfc3eea4d74a82315181a5475";
const V1_RICH_HASH =
  "082c3d00ac85531a4e88689c13d1088137569a4fc5bc591b1797871c9cf13128";

describe("project-envelope", () => {
  it("emptyDocument validates", () => {
    expect(validateProject(emptyDocument()).ok).toBe(true);
  });

  it("canonicalize is stable under key reorder", () => {
    const a: ProjectDocument = {
      schemaVersion: 1,
      extensions: ["pen", "music"],
      meta: { b: 2, a: 1 },
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            z: {
              id: "z",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
            a: {
              id: "a",
              opcode: "motion_movesteps",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
          },
          variables: { v2: ["b", 1], v1: ["a", 0] },
          lists: {},
          broadcasts: {},
        },
        {
          id: "stage",
          name: "Stage",
          isStage: true,
          blocks: {},
          variables: {},
          lists: {},
          broadcasts: {},
        },
      ],
    };
    const b: ProjectDocument = {
      targets: [...a.targets].reverse(),
      meta: { a: 1, b: 2 },
      extensions: ["music", "pen"],
      schemaVersion: 1,
    };
    expect(canonicalizeDocument(a)).toBe(canonicalizeDocument(b));
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("contentHash changes when lists / broadcasts / extensions / meta change", () => {
    const base = richFixtureDocument();
    const baseHash = contentHash(base);

    const withList: ProjectDocument = structuredClone(base);
    withList.targets[0]!.lists = { l1: ["買い物", ["りんご"]] };
    expect(contentHash(withList)).not.toBe(baseHash);

    const withBroadcast: ProjectDocument = structuredClone(base);
    withBroadcast.targets[0]!.broadcasts = { b1: "開始" };
    expect(contentHash(withBroadcast)).not.toBe(baseHash);

    const withExt: ProjectDocument = structuredClone(base);
    withExt.extensions = [...(withExt.extensions ?? []), "text"];
    expect(contentHash(withExt)).not.toBe(baseHash);

    const withMeta: ProjectDocument = structuredClone(base);
    withMeta.meta = { ...(withMeta.meta ?? {}), note: "changed" };
    expect(contentHash(withMeta)).not.toBe(baseHash);
  });

  it("richFixtureDocument validates and includes required richness", () => {
    const doc = richFixtureDocument();
    expect(validateProject(doc).ok).toBe(true);
    expect(doc.targets.length).toBeGreaterThanOrEqual(2);
    expect(doc.extensions?.length).toBeGreaterThan(0);
    const hasVars = doc.targets.some((t) => Object.keys(t.variables ?? {}).length > 0);
    const hasLists = doc.targets.some((t) => Object.keys(t.lists ?? {}).length > 0);
    const hasBroadcasts = doc.targets.some(
      (t) => Object.keys(t.broadcasts ?? {}).length > 0,
    );
    expect(hasVars && hasLists && hasBroadcasts).toBe(true);
    const json = JSON.stringify(doc);
    expect(json).toMatch(/[\u3040-\u30ff\u4e00-\u9faf]/);
  });

  it("assertEnvelope rejects schemaVersion mismatch", () => {
    const doc = emptyDocument();
    expect(() =>
      assertEnvelope({
        format: PROJECT_FORMAT,
        projectId: "p1",
        organizationId: "org-demo",
        title: "t",
        revision: 1,
        schemaVersion: 2,
        contentHash: contentHash(doc),
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedByUserId: "user-a",
        document: doc,
      }),
    ).toThrow(/SCHEMA_VERSION_MISMATCH|schemaVersion/i);
  });

  it("assertEnvelope accepts matching envelope", () => {
    const doc = emptyDocument();
    const env = assertEnvelope({
      format: PROJECT_FORMAT,
      projectId: "p1",
      organizationId: "org-demo",
      title: "t",
      revision: 1,
      schemaVersion: doc.schemaVersion,
      contentHash: contentHash(doc),
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByUserId: "user-a",
      document: doc,
    });
    expect(env.format).toBe(PROJECT_FORMAT);
  });

  it("preserves V1 golden content hashes (§5.2)", () => {
    expect(contentHash(emptyDocument())).toBe(V1_EMPTY_HASH);
    expect(contentHash(richFixtureDocument())).toBe(V1_RICH_HASH);
  });

  it("V1 canonicalize ignores block mutation but schema rejects it", () => {
    const doc = richFixtureDocument();
    const withMutation = structuredClone(doc);
    const block = withMutation.targets[1]!.blocks.hat!;
    block.mutation = { proccode: "ignored on v1 canonicalize" };
    expect(contentHash(withMutation)).toBe(contentHash(doc));
    expect(validateProject(withMutation).ok).toBe(false);
    expect(
      validateProject(withMutation).issues.some(
        (i) => i.code === "DISALLOWED_V1_FIELD",
      ),
    ).toBe(true);
  });

  it("V2 contentHash changes when costume array order changes", () => {
    const base = customProcedureFixtureDocument();
    const baseHash = contentHash(base);
    const swapped = structuredClone(base);
    const sprite = swapped.targets[1]!;
    const [first, second] = sprite.costumes!;
    sprite.costumes = [second!, first!];
    expect(contentHash(swapped)).not.toBe(baseHash);
  });

  it("V2 contentHash changes when sound array order changes", () => {
    const doc = customProcedureFixtureDocument();
    const soundA = {
      kind: "sound" as const,
      name: "pop",
      assetId: "11111111111111111111111111111111",
      md5ext: "11111111111111111111111111111111.wav",
      dataFormat: "wav",
      contentSha256: "d".repeat(64),
      rate: 44100,
      sampleCount: 1000,
      format: "",
    };
    const soundB = {
      ...soundA,
      name: "meow",
      assetId: "22222222222222222222222222222222",
      md5ext: "22222222222222222222222222222222.wav",
    };
    doc.targets[1]!.sounds = [soundA, soundB];
    const hashA = contentHash(doc);
    doc.targets[1]!.sounds = [soundB, soundA];
    expect(contentHash(doc)).not.toBe(hashA);
  });

  it("V2 costume reorder with same currentCostume index changes hash", () => {
    const doc = customProcedureFixtureDocument();
    const sprite = doc.targets[1]!;
    sprite.currentCostume = 0;
    sprite.costumes = [
      {
        kind: "costume",
        name: "first",
        assetId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        md5ext: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
        dataFormat: "svg",
        contentSha256: "e".repeat(64),
        rotationCenterX: 0,
        rotationCenterY: 0,
      },
      {
        kind: "costume",
        name: "second",
        assetId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        md5ext: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.svg",
        dataFormat: "svg",
        contentSha256: "f".repeat(64),
        rotationCenterX: 0,
        rotationCenterY: 0,
      },
    ];
    const hashFirst = contentHash(doc);
    sprite.costumes = [sprite.costumes[1]!, sprite.costumes[0]!];
    expect(sprite.currentCostume).toBe(0);
    expect(contentHash(doc)).not.toBe(hashFirst);
  });

  it("V2 canonicalize includes mutation with stable key order", () => {
    const doc = customProcedureFixtureDocument();
    const a = canonicalizeDocument(doc);
    const reordered = structuredClone(doc);
    const proto = reordered.targets[1]!.blocks.proto_id!;
    proto.mutation = {
      warp: "false",
      proccode: "my block %s",
      tagName: "mutation",
      children: [],
      argumentdefaults: '[""]',
      argumentids: '["arg_id"]',
      argumentnames: '["x"]',
    };
    expect(canonicalizeDocument(reordered)).toBe(a);
    expect(contentHash(reordered)).toBe(contentHash(doc));
  });

  it("V2 contentHash changes when mutation value changes", () => {
    const base = customProcedureFixtureDocument();
    const baseHash = contentHash(base);
    const changed = structuredClone(base);
    changed.targets[1]!.blocks.proto_id!.mutation!.proccode = "other block %s";
    expect(contentHash(changed)).not.toBe(baseHash);
  });

  it("customProcedureFixtureDocument validates under SB3 policy", () => {
    expect(validateProject(customProcedureFixtureDocument()).ok).toBe(true);
  });

  it("requestHash changes when schemaVersion or op changes", () => {
    const ch = contentHash(emptyDocument());
    const a = requestHash({
      op: "save_document",
      schemaVersion: 1,
      contentHash: ch,
    });
    const b = requestHash({
      op: "save_document",
      schemaVersion: 2,
      contentHash: ch,
    });
    const c = requestHash({
      op: "restore",
      schemaVersion: 1,
      contentHash: ch,
      snapshotId: "snap-1",
    });
    const d = requestHash({
      op: "restore",
      schemaVersion: 1,
      contentHash: ch,
      snapshotId: "snap-2",
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(c).not.toBe(d);
    expect(a).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            contentHash: ch,
            op: "save_document",
            schemaVersion: 1,
          }),
        )
        .digest("hex"),
    );
  });
});
