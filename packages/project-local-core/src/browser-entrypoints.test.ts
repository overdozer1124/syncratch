import {build} from "esbuild";
import {describe, expect, it} from "vitest";

describe("browser entry points", () => {
  it("bundle without Node built-ins and execute project/SB3 hashing smoke", async () => {
    const result = await build({
      stdin: {
        contents: `
          import {
            contentHash,
            emptyDocument,
            requestHash,
          } from "@blocksync/project-envelope";
          import {
            exportSb3,
            loadSb3,
            sha256Hex,
            stableTargetId,
          } from "@blocksync/sb3-tools/browser";

          export function smoke() {
            const document = emptyDocument();
            const hash = contentHash(document);
            return {
              hash,
              request: requestHash({
                op: "save_document",
                schemaVersion: document.schemaVersion,
                contentHash: hash,
              }),
              bytesHash: sha256Hex(new TextEncoder().encode("abc")),
              targetId: stableTargetId("Stage", true),
              sb3Exports: [typeof loadSb3, typeof exportSb3],
            };
          }
        `,
        resolveDir: process.cwd(),
        sourcefile: "browser-smoke.ts",
        loader: "ts",
      },
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      write: false,
    });

    const bundled = result.outputFiles[0]!.text;
    expect(bundled).not.toMatch(/(?:from\s*|import\()["']node:/);
    expect(bundled).not.toContain("__browser_external");

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`;
    const browserModule = (await import(moduleUrl)) as {
      smoke(): {
        hash: string;
        request: string;
        bytesHash: string;
        targetId: string;
        sb3Exports: string[];
      };
    };

    expect(browserModule.smoke()).toEqual({
      hash: "0cc517f62f40c66b669ccb7c6c3bf49ec257a12cfc3eea4d74a82315181a5475",
      request:
        "c8e19ff19f43d2d3786cd59af2b0aefe3d236e0919de208d7865112cb48f8d4b",
      bytesHash:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      targetId: "84cc668768e9d392",
      sb3Exports: ["function", "function"],
    });
  });
});
