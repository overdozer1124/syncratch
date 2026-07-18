import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {loadOpcodeArtifact} from "@blocksync/project-schema";
import {
  artifactsEqual,
  generate,
  stableArtifact,
} from "../../../scripts/generate-scratch-opcodes.mjs";

const artifactPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../vendor/scratch-opcodes-v14.1.0.json",
);

describe("generate-scratch-opcodes --check contract", () => {
  it("committed artifact matches regenerated contract", () => {
    const generated = generate();
    const existing = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(artifactsEqual(generated, existing)).toBe(true);
  });

  it("browser-safe project-schema artifact matches the generated contract", () => {
    expect(artifactsEqual(generate(), loadOpcodeArtifact())).toBe(true);
  });

  it("detects vendorPin tampering", () => {
    const generated = generate();
    const tampered = { ...generated, vendorPin: "deadbeef".repeat(8) };
    expect(artifactsEqual(generated, tampered)).toBe(false);
  });

  it("detects allowedExtensionIds tampering", () => {
    const generated = generate();
    const tampered = {
      ...generated,
      allowedExtensionIds: [...generated.allowedExtensionIds, "wedo2"],
    };
    expect(artifactsEqual(generated, tampered)).toBe(false);
  });

  it("stableArtifact excludes non-contract fields", () => {
    const withMeta = {
      ...generate(),
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(stableArtifact(withMeta)).toEqual(stableArtifact(generate()));
  });
});
