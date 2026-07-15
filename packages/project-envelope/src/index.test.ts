import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateProject, type ProjectDocument } from "@blocksync/project-schema";
import {
  PROJECT_FORMAT,
  assertEnvelope,
  canonicalizeDocument,
  contentHash,
  emptyDocument,
  requestHash,
  richFixtureDocument,
} from "./index.js";

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
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
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
