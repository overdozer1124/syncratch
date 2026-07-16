import type {
  CostumeRef,
  ProjectDocument,
  ScratchTarget,
  SoundRef,
} from "@blocksync/project-schema";
import { scriptRootFingerprints, stableJson } from "./block-graph-canonical.js";

export {
  EquivalenceGraphError,
  scriptFingerprint,
  scriptRootFingerprints,
  stableJson,
  topLevelPrimitiveFingerprint,
} from "./block-graph-canonical.js";

function canonicalDataFormat(format: string): string {
  return format === "jpeg" ? "jpg" : format;
}

function targetPreserveKey(t: ScratchTarget): string {
  return t.isStage ? "__stage__" : t.name;
}

function costumeKey(c: CostumeRef): string {
  return [
    c.name,
    c.assetId,
    c.contentSha256,
    canonicalDataFormat(c.dataFormat),
    c.md5ext,
    c.rotationCenterX,
    c.rotationCenterY,
    c.bitmapResolution ?? "",
  ].join(":");
}

function soundKey(s: SoundRef): string {
  return [
    s.name,
    s.assetId,
    s.contentSha256,
    canonicalDataFormat(s.dataFormat),
    s.md5ext,
    s.rate,
    s.sampleCount,
    s.format,
  ].join(":");
}

function compareTargets(a: ScratchTarget, b: ScratchTarget): boolean {
  if (a.isStage !== b.isStage) return false;
  if (a.name !== b.name) return false;
  if (a.currentCostume !== b.currentCostume) return false;
  if (a.volume !== b.volume) return false;
  if (a.layerOrder !== b.layerOrder) return false;
  if (JSON.stringify(a.variables ?? {}) !== JSON.stringify(b.variables ?? {}))
    return false;
  if (JSON.stringify(a.lists ?? {}) !== JSON.stringify(b.lists ?? {}))
    return false;
  if (JSON.stringify(a.broadcasts ?? {}) !== JSON.stringify(b.broadcasts ?? {}))
    return false;

  const costumesA = (a.costumes ?? []).map(costumeKey);
  const costumesB = (b.costumes ?? []).map(costumeKey);
  if (JSON.stringify(costumesA) !== JSON.stringify(costumesB)) return false;

  const soundsA = (a.sounds ?? []).map(soundKey);
  const soundsB = (b.sounds ?? []).map(soundKey);
  if (JSON.stringify(soundsA) !== JSON.stringify(soundsB)) return false;

  if (!a.isStage) {
    if (
      a.visible !== b.visible ||
      a.x !== b.x ||
      a.y !== b.y ||
      a.size !== b.size ||
      a.direction !== b.direction ||
      a.draggable !== b.draggable ||
      a.rotationStyle !== b.rotationStyle
    )
      return false;
  } else {
    if (
      a.tempo !== b.tempo ||
      a.videoTransparency !== b.videoTransparency ||
      a.videoState !== b.videoState ||
      a.textToSpeechLanguage !== b.textToSpeechLanguage
    )
      return false;
  }

  const fpsA = scriptRootFingerprints(a.blocks);
  const fpsB = scriptRootFingerprints(b.blocks);
  return JSON.stringify(fpsA) === JSON.stringify(fpsB);
}

/** Production equivalence (Design §6.7): target pairing + multiset script roots. */
export function equivalenceProduction(
  actual: ProjectDocument,
  expected: ProjectDocument,
): boolean {
  const extA = [...(actual.extensions ?? [])].sort();
  const extB = [...(expected.extensions ?? [])].sort();
  if (JSON.stringify(extA) !== JSON.stringify(extB)) return false;

  if (stableJson(actual.meta ?? {}) !== stableJson(expected.meta ?? {})) return false;

  const expByKey = new Map(expected.targets.map((t) => [targetPreserveKey(t), t]));
  for (const t of actual.targets) {
    const key = targetPreserveKey(t);
    const exp = expByKey.get(key);
    if (!exp || !compareTargets(t, exp)) return false;
    expByKey.delete(key);
  }
  return expByKey.size === 0;
}
