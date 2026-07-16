import { createHash } from "node:crypto";
import type { AdapterHandle } from "@blocksync/scratch-adapter";
import type {
  DocumentSpikeV0,
  CostumeRefSpikeV0,
  SoundRefSpikeV0,
  ScratchBlockSpikeV0,
  ScratchTargetSpikeV0,
} from "./schema/document-spike-v0.js";
import { sha256Hex } from "./assets.js";

function sha256OfAsset(asset: { data?: Uint8Array | ArrayBuffer } | null | undefined): string {
  if (!asset?.data) return "";
  const bytes =
    asset.data instanceof Uint8Array ? asset.data : new Uint8Array(asset.data);
  return sha256Hex(bytes);
}

function sb3BlockToSpike(
  blocks: Record<string, unknown>,
  id: string,
): ScratchBlockSpikeV0 | null {
  const raw = blocks[id];
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.opcode !== "string") return null;
  return {
    opcode: b.opcode,
    next: (b.next as string | null) ?? null,
    parent: (b.parent as string | null) ?? null,
    inputs: (b.inputs as Record<string, unknown>) ?? {},
    fields: (b.fields as Record<string, unknown>) ?? {},
    shadow: Boolean(b.shadow),
    topLevel: Boolean(b.topLevel),
    x: typeof b.x === "number" ? b.x : undefined,
    y: typeof b.y === "number" ? b.y : undefined,
    mutation:
      b.mutation && typeof b.mutation === "object"
        ? (b.mutation as Record<string, unknown>)
        : undefined,
  };
}

export function vmToDocumentSpikeV0(handle: AdapterHandle): DocumentSpikeV0 {
  const parsed = JSON.parse(handle.vm.toJSON()) as {
    targets?: Array<Record<string, unknown>>;
    extensions?: string[];
    meta?: Record<string, unknown>;
  };

  const targets: ScratchTargetSpikeV0[] = (parsed.targets ?? []).map((t) => {
    const blocksRaw = (t.blocks as Record<string, unknown>) ?? {};
    const blocks: Record<string, ScratchBlockSpikeV0> = {};
    for (const id of Object.keys(blocksRaw)) {
      const b = sb3BlockToSpike(blocksRaw, id);
      if (b) blocks[id] = b;
    }

    const rtTarget = (handle.vm.runtime.targets ?? []).find(
      (rt: { getName?: () => string; isStage?: boolean }) =>
        (rt.getName?.() ?? "") === t.name && Boolean(rt.isStage) === Boolean(t.isStage),
    );

    const costumes: CostumeRefSpikeV0[] = [];
    const spriteCostumes =
      rtTarget?.sprite?.costumes ??
      (rtTarget as { costumes?: unknown[] })?.costumes ??
      [];
    for (const c of spriteCostumes as Array<Record<string, unknown>>) {
      const asset = c.asset as { data?: Uint8Array } | undefined;
      costumes.push({
        kind: "costume",
        name: String(c.name ?? ""),
        assetId: String(c.assetId ?? ""),
        md5ext: String(c.md5 ?? c.md5ext ?? ""),
        dataFormat: String(c.dataFormat ?? "svg").toLowerCase(),
        contentSha256: sha256OfAsset(asset),
        rotationCenterX: Number(c.rotationCenterX ?? 0),
        rotationCenterY: Number(c.rotationCenterY ?? 0),
        bitmapResolution:
          typeof c.bitmapResolution === "number" ? c.bitmapResolution : undefined,
      });
    }

    const sounds: SoundRefSpikeV0[] = [];
    const spriteSounds =
      rtTarget?.sprite?.sounds ??
      (rtTarget as { sounds?: unknown[] })?.sounds ??
      [];
    for (const s of spriteSounds as Array<Record<string, unknown>>) {
      const asset = s.asset as { data?: Uint8Array } | undefined;
      sounds.push({
        kind: "sound",
        name: String(s.name ?? ""),
        assetId: String(s.assetId ?? ""),
        md5ext: String(s.md5 ?? s.md5ext ?? ""),
        dataFormat: String(s.dataFormat ?? "wav").toLowerCase(),
        contentSha256: sha256OfAsset(asset),
        rate: Number(s.rate ?? 0),
        sampleCount: Number(s.sampleCount ?? 0),
        format: String(s.format ?? ""),
      });
    }

    const base: ScratchTargetSpikeV0 = {
      name: String(t.name ?? ""),
      isStage: Boolean(t.isStage),
      blocks,
      variables: (t.variables as ScratchTargetSpikeV0["variables"]) ?? {},
      lists: (t.lists as ScratchTargetSpikeV0["lists"]) ?? {},
      broadcasts: (t.broadcasts as ScratchTargetSpikeV0["broadcasts"]) ?? {},
      currentCostume: Number(t.currentCostume ?? 0),
      costumes,
      sounds,
      volume: Number(t.volume ?? 100),
      layerOrder: Number(t.layerOrder ?? 0),
    };

    if (base.isStage) {
      return {
        ...base,
        tempo: Number(t.tempo ?? 60),
        videoTransparency: Number(t.videoTransparency ?? 50),
        videoState: String(t.videoState ?? "on"),
        textToSpeechLanguage:
          t.textToSpeechLanguage === undefined
            ? null
            : (t.textToSpeechLanguage as string | null),
      };
    }

    return {
      ...base,
      visible: Boolean(t.visible ?? true),
      x: Number(t.x ?? 0),
      y: Number(t.y ?? 0),
      size: Number(t.size ?? 100),
      direction: Number(t.direction ?? 90),
      draggable: Boolean(t.draggable ?? false),
      rotationStyle: String(t.rotationStyle ?? "all around"),
    };
  });

  targets.sort((a, b) => {
    if (a.isStage !== b.isStage) return a.isStage ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    schemaVersion: 0,
    targets,
    extensions: [...(parsed.extensions ?? [])].sort(),
    meta: parsed.meta,
  };
}

/** Stable id for spike fixtures (not used in equivalence). */
export function stableTargetId(name: string, isStage: boolean): string {
  return createHash("sha256")
    .update(`${isStage}:${name}`)
    .digest("hex")
    .slice(0, 16);
}
