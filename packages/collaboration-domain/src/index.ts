/**
 * @experimental Gate 0 collaboration domain.
 * Materializes project structure from Yjs and requires project-schema validation
 * before accepting structural commits.
 */

import * as Y from "yjs";
import {
  validateProject,
  type ProjectDocument,
  type ScratchBlock,
  type ScratchTarget,
  type ValidationResult,
} from "@blocksync/project-schema";

export interface SpriteBlockOp {
  transactionId: string;
  spriteId: string;
  /** Full blocks map for that sprite after the op (Gate 0 prototype simplicity). */
  blocks: Record<string, ScratchBlock>;
  variables?: Record<string, [string, string | number]>;
}

export interface ApplyResult {
  accepted: boolean;
  validation: ValidationResult;
  duplicate?: boolean;
}

export class CollaborationDocument {
  readonly ydoc: Y.Doc;
  private readonly applied = new Set<string>();
  private readonly sprites: Y.Map<Y.Map<unknown>>;
  private readonly stageMeta: Y.Map<unknown>;

  constructor(ydoc = new Y.Doc()) {
    this.ydoc = ydoc;
    this.sprites = ydoc.getMap("sprites");
    this.stageMeta = ydoc.getMap("stage");
    if (!this.stageMeta.has("initialized")) {
      this.ydoc.transact(() => {
        this.stageMeta.set("initialized", true);
        this.stageMeta.set(
          "target",
          JSON.stringify({
            id: "stage",
            name: "Stage",
            isStage: true,
            blocks: {},
            variables: {},
            lists: {},
            broadcasts: {},
          } satisfies ScratchTarget),
        );
      });
    }
  }

  /** Snapshot current shared state as ProjectDocument. */
  materialize(): ProjectDocument {
    const targets: ScratchTarget[] = [];
    const stageRaw = this.stageMeta.get("target");
    if (typeof stageRaw === "string") {
      targets.push(JSON.parse(stageRaw) as ScratchTarget);
    }
    this.sprites.forEach((spriteMap, spriteId) => {
      const blocksJson = spriteMap.get("blocks");
      const varsJson = spriteMap.get("variables");
      const name = String(spriteMap.get("name") ?? spriteId);
      targets.push({
        id: spriteId,
        name,
        isStage: false,
        blocks:
          typeof blocksJson === "string"
            ? (JSON.parse(blocksJson) as Record<string, ScratchBlock>)
            : {},
        variables:
          typeof varsJson === "string"
            ? (JSON.parse(varsJson) as ScratchTarget["variables"])
            : {},
        lists: {},
        broadcasts: {},
      });
    });
    return { schemaVersion: 1, targets, extensions: [] };
  }

  ensureSprite(spriteId: string, name: string): void {
    if (this.sprites.has(spriteId)) return;
    this.ydoc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set("name", name);
      m.set("blocks", JSON.stringify({}));
      m.set("variables", JSON.stringify({}));
      this.sprites.set(spriteId, m);
    });
  }

  /**
   * Apply sprite block update. Validates full project structure BEFORE committing
   * via a tentative materialization against a cloned JSON candidate.
   */
  applySpriteBlocks(op: SpriteBlockOp): ApplyResult {
    if (this.applied.has(op.transactionId)) {
      return {
        accepted: true,
        duplicate: true,
        validation: { ok: true, issues: [] },
      };
    }

    this.ensureSprite(op.spriteId, op.spriteId);

    // Build candidate document without mutating Yjs yet
    const candidate = this.materialize();
    const idx = candidate.targets.findIndex((t) => t.id === op.spriteId);
    const nextTarget: ScratchTarget = {
      id: op.spriteId,
      name: op.spriteId,
      isStage: false,
      blocks: op.blocks,
      variables: op.variables ?? {},
      lists: {},
      broadcasts: {},
    };
    if (idx >= 0) candidate.targets[idx] = nextTarget;
    else candidate.targets.push(nextTarget);

    const validation = validateProject(candidate);
    if (!validation.ok) {
      return { accepted: false, validation };
    }

    this.ydoc.transact(() => {
      const m = this.sprites.get(op.spriteId)!;
      m.set("blocks", JSON.stringify(op.blocks));
      if (op.variables) m.set("variables", JSON.stringify(op.variables));
    });
    this.applied.add(op.transactionId);
    return { accepted: true, validation };
  }
}

export function encodeState(doc: CollaborationDocument): Uint8Array {
  return Y.encodeStateAsUpdate(doc.ydoc);
}

export function applyUpdate(doc: CollaborationDocument, update: Uint8Array): void {
  Y.applyUpdate(doc.ydoc, update);
}

export {
  DEFAULT_PROJECT_COLLAB_LIMITS,
  LOCAL_ORIGIN,
  ProjectCollaborationDocument,
  REMOTE_ORIGIN,
  type ApplyRemoteResult,
  type MaterializeFailure,
  type MaterializeResult,
  type MaterializeSuccess,
  type ProjectCollabLimits,
} from "./project-collab.js";

export {
  COLLAB_FALLBACK_TITLE,
  MAX_DECODED_UPDATE_BYTES,
  MAX_PROJECT_TITLE_CODE_POINTS,
  base64UrlFromBytes,
  buildAssetManifest,
  bytesFromBase64Url,
  collectReferencedMd5exts,
  encodeStateVectorBase64,
  newBootstrapId,
  normalizeProjectTitle,
  readBootstrapCheckpoint,
  runHostPreflight,
  sha256Hex,
  stateVectorContains,
  summarizePreflightIssues,
  updateExceedsHardLimit,
  validateSealedCheckpoint,
  writeBootstrapSealed,
  writeBootstrapSeeding,
  type BootstrapAsset,
  type BootstrapCheckpoint,
  type BootstrapState,
  type CheckpointValidationResult,
  type CheckpointValidationStatus,
  type HostPreflightResult,
  type PreflightIssue,
  type PreflightIssueCode,
} from "./bootstrap.js";
