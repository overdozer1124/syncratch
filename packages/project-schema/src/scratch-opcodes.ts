import {scratchOpcodeArtifact} from "./scratch-opcodes-v14.1.0.js";

export interface OpcodeArtifact {
  vendorTag: string;
  vendorPin: string;
  allowedExtensionIds: string[];
  opcodes: string[];
}

export function loadOpcodeArtifact(): OpcodeArtifact {
  return {
    vendorTag: scratchOpcodeArtifact.vendorTag,
    vendorPin: scratchOpcodeArtifact.vendorPin,
    allowedExtensionIds: [...scratchOpcodeArtifact.allowedExtensionIds],
    opcodes: [...scratchOpcodeArtifact.opcodes],
  };
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
