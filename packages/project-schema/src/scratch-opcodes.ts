import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface OpcodeArtifact {
  vendorTag: string;
  vendorPin: string;
  generatedAt: string;
  allowedExtensionIds: string[];
  opcodes: string[];
}

const artifactPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../sb3-tools/vendor/scratch-opcodes-v14.1.0.json",
);

let cached: OpcodeArtifact | null = null;

export function loadOpcodeArtifact(): OpcodeArtifact {
  if (!cached) {
    cached = JSON.parse(readFileSync(artifactPath, "utf8")) as OpcodeArtifact;
  }
  return cached;
}

export function allowedOpcodeSet(): ReadonlySet<string> {
  return new Set(loadOpcodeArtifact().opcodes);
}

export function allowedExtensionIdSet(): ReadonlySet<string> {
  return new Set(loadOpcodeArtifact().allowedExtensionIds);
}

/** Corpus opcodes used in Task 1 regression tests (subset of §6.6.3). */
export const CORPUS_OPCODES = [
  "event_whenflagclicked",
  "motion_movesteps",
  "data_setvariableto",
  "procedures_definition",
  "procedures_prototype",
  "music_playDrumForBeats",
] as const;
