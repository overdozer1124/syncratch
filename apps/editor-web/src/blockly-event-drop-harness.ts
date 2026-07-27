/**
 * E2E-only harness to drop selected Blockly events before they reach the VM.
 */

import type {BlocklyEventLike} from "./blockly-vm-event-instrumentation.js";

export type BlockEventDropKind = import("./blockly-vm-event-instrumentation.js").BlockEventDropKind;

export type BlockEventDropLogEntry = {
  at: number;
  kind: BlockEventDropKind;
  event: BlocklyEventLike;
  syncGeneration?: number;
};

export type VmBlockListenerLike = {
  blockListener: (event: BlocklyEventLike) => void;
};

let armedDrop: BlockEventDropKind | null = null;
let armedDropRemaining = 0;
const dropLog: BlockEventDropLogEntry[] = [];

const MAX_DROP_LOG = 30;

function classifyMoveEvent(
  event: BlocklyEventLike,
): "move" | "connection-change" | "other" {
  if (event.type !== "move") return "other";
  const hasConnection = Boolean(
    event.oldParentId ||
      event.newParentId ||
      event.oldInputName ||
      event.newInputName,
  );
  if (hasConnection) return "connection-change";
  if (event.newCoordinate != null) return "move";
  return "other";
}

export function matchesDropKind(
  event: BlocklyEventLike,
  kind: BlockEventDropKind,
): boolean {
  if (kind === "delete") return event.type === "delete";
  if (kind === "any-move") return event.type === "move";
  if (kind === "connection-change") {
    return event.type === "move" && classifyMoveEvent(event) === "connection-change";
  }
  return event.type === "move" && classifyMoveEvent(event) === "move";
}

export function armBlockEventDropNext(
  kind: BlockEventDropKind,
  count = 1,
): void {
  armedDrop = kind;
  armedDropRemaining = Math.max(1, count);
}

export function armBlockEventDropAll(kind: BlockEventDropKind): void {
  armedDrop = kind;
  armedDropRemaining = Number.POSITIVE_INFINITY;
}

export function disarmBlockEventDrop(): void {
  armedDrop = null;
  armedDropRemaining = 0;
}

export function getBlockEventDropLog(): readonly BlockEventDropLogEntry[] {
  return dropLog;
}

export function clearBlockEventDropHarness(): void {
  dropLog.length = 0;
  armedDrop = null;
  armedDropRemaining = 0;
}

export function peekArmedBlockEventDrop(): BlockEventDropKind | null {
  return armedDrop;
}

export function logBlockEventDrop(entry: BlockEventDropLogEntry): void {
  dropLog.push(entry);
  if (dropLog.length > MAX_DROP_LOG) dropLog.shift();
  if (Number.isFinite(armedDropRemaining)) {
    armedDropRemaining = Math.max(0, armedDropRemaining - 1);
    if (armedDropRemaining === 0) armedDrop = null;
  }
}
