import type {
  DocumentSpikeV0,
  ScratchTargetSpikeV0,
} from "./schema/document-spike-v0.js";
import {
  md5Hex,
  sha256Hex,
  SPIKE_BACKDROP_SVG,
  SPIKE_CAT_SVG,
  minimalWavBytes,
} from "./assets.js";
import { scriptRootFingerprints } from "./block-graph-canonical.js";

export { EquivalenceGraphError, scriptFingerprint, scriptRootFingerprints } from "./block-graph-canonical.js";

function targetPreserveKey(t: ScratchTargetSpikeV0): string {
  return t.isStage ? "__stage__" : t.name;
}

function compareTargets(a: ScratchTargetSpikeV0, b: ScratchTargetSpikeV0): boolean {
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

  const costumeKey = (c: (typeof a.costumes)[0]) =>
    `${c.assetId}:${c.contentSha256}:${c.dataFormat}:${c.md5ext}:${c.rotationCenterX}:${c.rotationCenterY}`;
  if (
    JSON.stringify(a.costumes.map(costumeKey).sort()) !==
    JSON.stringify(b.costumes.map(costumeKey).sort())
  )
    return false;

  const soundKey = (s: (typeof a.sounds)[0]) =>
    `${s.assetId}:${s.contentSha256}:${s.rate}:${s.sampleCount}:${s.format}`;
  if (
    JSON.stringify(a.sounds.map(soundKey).sort()) !==
    JSON.stringify(b.sounds.map(soundKey).sort())
  )
    return false;

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

export function equivalenceSpikeV0(
  actual: DocumentSpikeV0,
  expected: DocumentSpikeV0,
): boolean {
  const extA = [...actual.extensions].sort();
  const extB = [...expected.extensions].sort();
  if (JSON.stringify(extA) !== JSON.stringify(extB)) return false;

  const expByKey = new Map(expected.targets.map((t) => [targetPreserveKey(t), t]));
  for (const t of actual.targets) {
    const key = targetPreserveKey(t);
    const exp = expByKey.get(key);
    if (!exp || !compareTargets(t, exp)) return false;
    expByKey.delete(key);
  }
  return expByKey.size === 0;
}

export function buildExpectedCustomProcedureDocument(): DocumentSpikeV0 {
  const cat = new TextEncoder().encode(SPIKE_CAT_SVG);
  const catId = md5Hex(cat);

  return {
    schemaVersion: 0,
    extensions: [],
    meta: { semver: "3.0.0" },
    targets: [
      {
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "backdrop1",
            assetId: catId,
            md5ext: `${catId}.svg`,
            dataFormat: "svg",
            contentSha256: sha256Hex(cat),
            rotationCenterX: 240,
            rotationCenterY: 180,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null,
      },
      {
        name: "Sprite1",
        isStage: false,
        blocks: {
          define_id: {
            opcode: "procedures_definition",
            next: "attached_id",
            parent: null,
            inputs: { custom_block: [2, "proto_id"] },
            fields: {},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 0,
          },
          proto_id: {
            opcode: "procedures_prototype",
            next: null,
            parent: "define_id",
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false,
            mutation: {
              tagName: "mutation",
              children: [],
              proccode: "my block %s",
              argumentids: '["arg_id"]',
              argumentnames: '["x"]',
              argumentdefaults: '[""]',
              warp: "false",
            },
          },
          attached_id: {
            opcode: "motion_movesteps",
            next: null,
            parent: "define_id",
            inputs: { STEPS: [1, [4, "10"]] },
            fields: {},
            shadow: false,
            topLevel: false,
          },
        },
        variables: {},
        lists: {},
        broadcasts: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "costume1",
            assetId: catId,
            md5ext: `${catId}.svg`,
            dataFormat: "svg",
            contentSha256: sha256Hex(cat),
            rotationCenterX: 48,
            rotationCenterY: 50,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: "all around",
      },
    ],
  };
}

export function buildExpectedCatDocument(): DocumentSpikeV0 {
  const backdrop = new TextEncoder().encode(SPIKE_BACKDROP_SVG);
  const cat = new TextEncoder().encode(SPIKE_CAT_SVG);
  const pop = minimalWavBytes({ sampleCount: 1032 });
  const meow = minimalWavBytes({ sampleCount: 37376 });
  const backdropId = md5Hex(backdrop);
  const catId = md5Hex(cat);
  const popId = md5Hex(pop);
  const meowId = md5Hex(meow);

  return {
    schemaVersion: 0,
    extensions: [],
    meta: { semver: "3.0.0" },
    targets: [
      {
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: { "var:my variable": ["my variable", 0] },
        lists: {},
        broadcasts: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "backdrop1",
            assetId: backdropId,
            md5ext: `${backdropId}.svg`,
            dataFormat: "svg",
            contentSha256: sha256Hex(backdrop),
            rotationCenterX: 240,
            rotationCenterY: 180,
          },
        ],
        sounds: [
          {
            kind: "sound",
            name: "pop",
            assetId: popId,
            md5ext: `${popId}.wav`,
            dataFormat: "wav",
            contentSha256: sha256Hex(pop),
            rate: 44100,
            sampleCount: 1032,
            format: "",
          },
        ],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null,
      },
      {
        name: "Sprite1",
        isStage: false,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
        currentCostume: 0,
        costumes: [
          {
            kind: "costume",
            name: "costume1",
            assetId: catId,
            md5ext: `${catId}.svg`,
            dataFormat: "svg",
            contentSha256: sha256Hex(cat),
            rotationCenterX: 48,
            rotationCenterY: 50,
            bitmapResolution: 1,
          },
        ],
        sounds: [
          {
            kind: "sound",
            name: "Meow",
            assetId: meowId,
            md5ext: `${meowId}.wav`,
            dataFormat: "wav",
            contentSha256: sha256Hex(meow),
            rate: 44100,
            sampleCount: 37376,
            format: "",
          },
        ],
        volume: 100,
        layerOrder: 0,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: "all around",
      },
    ],
  };
}
