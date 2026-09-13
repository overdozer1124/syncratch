/**
 * Neutral live-project snapshot for standard diagnostics.
 * Does not silently fall back to a stale persisted document.
 */

import type {ProjectDocument} from "@blocksync/project-schema";
import {projectJsonToDocument} from "@blocksync/sb3-tools/browser";
import {preserveTargetIds} from "./target-identity.js";

export interface LiveProjectSnapshot {
  document: ProjectDocument;
  rawProjectJson: unknown;
}

export type LiveSnapshotFailureReason =
  | "no-vm"
  | "invalid-json"
  | "conversion-failed";

export type LiveSnapshotResult =
  | {ok: true; snapshot: LiveProjectSnapshot}
  | {
      ok: false;
      reason: LiveSnapshotFailureReason;
      message: string;
    };

export interface CaptureLiveProjectSnapshotInput {
  /** Null/undefined when the Scratch VM is not ready. */
  readVmJson: (() => string) | null | undefined;
  /**
   * Optional previous document used only to preserve target IDs.
   * Never returned as the snapshot body on its own.
   */
  previousDocument?: ProjectDocument | null;
  assetHashes?: Map<string, string>;
  convert?: (
    raw: unknown,
    hashes: Map<string, string>,
  ) => ProjectDocument;
}

const USER_MESSAGES: Record<LiveSnapshotFailureReason, string> = {
  "no-vm": "作品がまだ読み込まれていないため、ヒントを確認できません。",
  "invalid-json": "作品データを読めなかったため、ヒントを確認できません。",
  "conversion-failed":
    "作品データの変換に失敗したため、ヒントを確認できません。",
};

export function liveSnapshotUnavailableMessage(
  reason: LiveSnapshotFailureReason,
): string {
  return USER_MESSAGES[reason];
}

/**
 * Capture a live VM project snapshot for diagnostics.
 */
export function captureLiveProjectSnapshot(
  input: CaptureLiveProjectSnapshotInput,
): LiveSnapshotResult {
  if (!input.readVmJson) {
    return {
      ok: false,
      reason: "no-vm",
      message: USER_MESSAGES["no-vm"],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(input.readVmJson());
  } catch {
    return {
      ok: false,
      reason: "invalid-json",
      message: USER_MESSAGES["invalid-json"],
    };
  }

  const hashes = input.assetHashes ?? new Map<string, string>();
  const convert = input.convert ?? projectJsonToDocument;
  try {
    let document = convert(raw, hashes);
    if (input.previousDocument) {
      document = preserveTargetIds(input.previousDocument, document);
    }
    return {
      ok: true,
      snapshot: {document, rawProjectJson: raw},
    };
  } catch {
    return {
      ok: false,
      reason: "conversion-failed",
      message: USER_MESSAGES["conversion-failed"],
    };
  }
}
