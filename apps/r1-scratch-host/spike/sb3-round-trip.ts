import type { AdapterHandle } from "@blocksync/scratch-adapter";
import { createAdapter, loadProjectJson } from "@blocksync/scratch-adapter";
import { attachAssetBytes } from "./storage-bytes.js";
import { vmToDocumentSpikeV0 } from "./vm-to-document-spike-v0.js";
import { materializeRuntimeAssets } from "./materialize-runtime-assets.js";
import { materializeAssetsFromSb3Zip } from "./materialize-from-sb3-zip.js";
import type { DocumentSpikeV0 } from "./schema/document-spike-v0.js";

export async function documentAfterFirstLoad(
  projectJson: Record<string, unknown>,
  assets: Map<string, Uint8Array>,
): Promise<DocumentSpikeV0> {
  const handle = await createAdapter();
  try {
    attachAssetBytes(handle, assets);
    await loadProjectJson(handle, projectJson);
    materializeRuntimeAssets(handle, assets);
    return vmToDocumentSpikeV0(handle);
  } finally {
    handle.dispose();
  }
}

export async function exportSb3Bytes(handle: AdapterHandle): Promise<Uint8Array> {
  const blob = await handle.vm.saveProjectSb3();
  const buffer =
    typeof blob.arrayBuffer === "function"
      ? await blob.arrayBuffer()
      : (blob as unknown as ArrayBuffer);
  return new Uint8Array(buffer);
}

export async function loadSb3IntoFreshAdapter(
  sb3: Uint8Array,
  assets: Map<string, Uint8Array>,
): Promise<AdapterHandle> {
  const handle = await createAdapter();
  attachAssetBytes(handle, assets);
  await handle.vm.loadProject(
    sb3.buffer.slice(sb3.byteOffset, sb3.byteOffset + sb3.byteLength) as ArrayBuffer,
  );
  await materializeAssetsFromSb3Zip(handle, sb3);
  return handle;
}

/** VM A load → saveProjectSb3 → fresh VM B load → document. */
export async function roundTripDocument(
  projectJson: Record<string, unknown>,
  assets: Map<string, Uint8Array>,
): Promise<DocumentSpikeV0> {
  const vmA = await createAdapter();
  try {
    attachAssetBytes(vmA, assets);
    await vmA.vm.loadProject(JSON.stringify(projectJson));
    materializeRuntimeAssets(vmA, assets);
    const sb3 = await exportSb3Bytes(vmA);
    const vmB = await loadSb3IntoFreshAdapter(sb3, assets);
    try {
      return vmToDocumentSpikeV0(vmB);
    } finally {
      vmB.dispose();
    }
  } finally {
    vmA.dispose();
  }
}

const PROCEDURE_MUTATION_KEYS = [
  "tagName",
  "proccode",
  "argumentids",
  "argumentnames",
  "argumentdefaults",
  "warp",
] as const;

export function findProcedurePrototype(
  doc: DocumentSpikeV0,
): import("./schema/document-spike-v0.js").ScratchBlockSpikeV0 | undefined {
  for (const target of doc.targets) {
    if (target.isStage) continue;
    for (const block of Object.values(target.blocks)) {
      if (block.opcode === "procedures_prototype") return block;
    }
  }
  return undefined;
}

export function assertFullProcedureMutation(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
): void {
  if (!actual) throw new Error("Missing procedures_prototype mutation");
  for (const key of PROCEDURE_MUTATION_KEYS) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      throw new Error(`mutation.${key} mismatch`);
    }
  }
}
