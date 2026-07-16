import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAssetFsStore } from "@blocksync/project-assets-fs";
import { customProcedureFixtureDocument } from "@blocksync/project-envelope";
import {
  AssetNotLiveError,
  AssetRefMismatchError,
  type LiveAssetCatalog,
  type ProjectService,
} from "@blocksync/project-service";
import { exportSb3 } from "@blocksync/sb3-tools";
import { exportSb3ForProject } from "./export-sb3.js";

const userHints = { headers: { "x-user-id": "user-a" } };

async function buildExportFixture() {
  const backdropSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#e0e0ff"/></svg>`,
  );
  const spriteSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="100"><ellipse cx="48" cy="50" rx="40" ry="45" fill="#ffaa00"/></svg>`,
  );
  const backdropId = createHash("md5").update(backdropSvg).digest("hex");
  const spriteId = createHash("md5").update(spriteSvg).digest("hex");
  const backdropSha = createHash("sha256").update(backdropSvg).digest("hex");
  const spriteSha = createHash("sha256").update(spriteSvg).digest("hex");
  const doc = customProcedureFixtureDocument();
  doc.targets[0]!.costumes = [
    {
      kind: "costume",
      name: "backdrop1",
      assetId: backdropId,
      md5ext: `${backdropId}.svg`,
      dataFormat: "svg",
      contentSha256: backdropSha,
      rotationCenterX: 240,
      rotationCenterY: 180,
    },
  ];
  doc.targets[1]!.costumes = [
    {
      kind: "costume",
      name: "costume1",
      assetId: spriteId,
      md5ext: `${spriteId}.svg`,
      dataFormat: "svg",
      contentSha256: spriteSha,
      rotationCenterX: 48,
      rotationCenterY: 50,
    },
  ];
  const assetBytes = new Map([
    [`${backdropId}.svg`, backdropSvg],
    [`${spriteId}.svg`, spriteSvg],
  ]);
  return {
    envelope: {
      format: "blocksync.project/v1" as const,
      projectId: randomUUID(),
      organizationId: "org-demo",
      title: "Export test",
      revision: 0,
      schemaVersion: doc.schemaVersion,
      contentHash: "hash",
      updatedAt: new Date().toISOString(),
      updatedByUserId: "user-a",
      document: doc,
    },
    assets: [
      { sha256: backdropSha, bytes: backdropSvg, md5Hex: backdropId },
      { sha256: spriteSha, bytes: spriteSvg, md5Hex: spriteId },
    ],
    assetBytes,
  };
}

function makeDeps(
  envelope: Awaited<ReturnType<typeof buildExportFixture>>["envelope"],
  assets: Awaited<ReturnType<typeof buildExportFixture>>["assets"],
  catalog: LiveAssetCatalog,
) {
  const dir = mkdtempSync(join(tmpdir(), "r1-export-test-"));
  const assetFs = createAssetFsStore(join(dir, "assets"));
  for (const asset of assets) {
    assetFs.putIfAbsent(asset.sha256, asset.bytes);
  }
  const service = {
    async getProject(_hints: unknown, projectId: string) {
      if (projectId !== envelope.projectId) {
        throw new Error("not found");
      }
      return envelope;
    },
  } as unknown as ProjectService;
  return { service, assetFs, liveCatalog: catalog };
}

describe("exportSb3ForProject metadata checks", () => {
  it("rejects md5_hex mismatch against DB metadata", async () => {
    const { envelope, assets } = await buildExportFixture();
    const catalog: LiveAssetCatalog = {
      getAsset(sha256) {
        const asset = assets.find((row) => row.sha256 === sha256);
        if (!asset) return null;
        return {
          sha256,
          byteLength: asset.bytes.byteLength,
          md5Hex: "0".repeat(32),
          dataFormat: "svg",
          gcState: "live",
        };
      },
      hasOrgGrant: () => true,
      assertLiveGrantsInCommit: () => {},
    };
    await expect(
      exportSb3ForProject(
        makeDeps(envelope, assets, catalog),
        userHints,
        envelope.projectId,
      ),
    ).rejects.toThrow(AssetRefMismatchError);
  });

  it("rejects data_format mismatch against DB metadata", async () => {
    const { envelope, assets } = await buildExportFixture();
    const catalog: LiveAssetCatalog = {
      getAsset(sha256) {
        const asset = assets.find((row) => row.sha256 === sha256);
        if (!asset) return null;
        return {
          sha256,
          byteLength: asset.bytes.byteLength,
          md5Hex: asset.md5Hex,
          dataFormat: "png",
          gcState: "live",
        };
      },
      hasOrgGrant: () => true,
      assertLiveGrantsInCommit: () => {},
    };
    await expect(
      exportSb3ForProject(
        makeDeps(envelope, assets, catalog),
        userHints,
        envelope.projectId,
      ),
    ).rejects.toThrow(AssetRefMismatchError);
  });

  it("rejects byte_length mismatch against DB metadata", async () => {
    const { envelope, assets } = await buildExportFixture();
    const catalog: LiveAssetCatalog = {
      getAsset(sha256) {
        const asset = assets.find((row) => row.sha256 === sha256);
        if (!asset) return null;
        return {
          sha256,
          byteLength: asset.bytes.byteLength + 1,
          md5Hex: asset.md5Hex,
          dataFormat: "svg",
          gcState: "live",
        };
      },
      hasOrgGrant: () => true,
      assertLiveGrantsInCommit: () => {},
    };
    await expect(
      exportSb3ForProject(
        makeDeps(envelope, assets, catalog),
        userHints,
        envelope.projectId,
      ),
    ).rejects.toThrow(AssetRefMismatchError);
  });

  it("rejects quarantined assets", async () => {
    const { envelope, assets } = await buildExportFixture();
    const catalog: LiveAssetCatalog = {
      getAsset(sha256) {
        const asset = assets.find((row) => row.sha256 === sha256);
        if (!asset) return null;
        return {
          sha256,
          byteLength: asset.bytes.byteLength,
          md5Hex: asset.md5Hex,
          dataFormat: "svg",
          gcState: "quarantined",
        };
      },
      hasOrgGrant: () => true,
      assertLiveGrantsInCommit: () => {},
    };
    await expect(
      exportSb3ForProject(
        makeDeps(envelope, assets, catalog),
        userHints,
        envelope.projectId,
      ),
    ).rejects.toThrow(AssetNotLiveError);
  });

  it("exports when DB metadata matches ref and bytes", async () => {
    const { envelope, assets } = await buildExportFixture();
    const catalog: LiveAssetCatalog = {
      getAsset(sha256) {
        const asset = assets.find((row) => row.sha256 === sha256);
        if (!asset) return null;
        return {
          sha256,
          byteLength: asset.bytes.byteLength,
          md5Hex: asset.md5Hex,
          dataFormat: "svg",
          gcState: "live",
        };
      },
      hasOrgGrant: () => true,
      assertLiveGrantsInCommit: () => {},
    };
    const exported = await exportSb3ForProject(
      makeDeps(envelope, assets, catalog),
      userHints,
      envelope.projectId,
    );
    expect(exported.byteLength).toBeGreaterThan(0);
    expect(exportSb3).toBeDefined();
  });
});
