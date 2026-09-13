/**
 * Broadcast send/receive graph rules.
 *
 * Matching resolves BROADCAST_OPTION through menu shadow blocks under
 * BROADCAST_INPUT — parent send-block fields alone are not used.
 *
 * False-positive notes:
 * - send-without-receive: dynamic message names / runtime-created receivers
 *   are invisible in the static graph; confidence is certain about the
 *   observed graph only.
 * - receive-without-send: another sprite or stage may send via a menu we
 *   failed to resolve; confidence is likely.
 */

import type {DiagnosticFinding} from "../contracts.js";
import {
  inputOccupantBlockId,
  type DiagnosticBlockIR,
  type DiagnosticProjectIR,
  type DiagnosticTargetIR,
} from "../ir.js";
import type {DiagnosticRule} from "./types.js";

const SEND_OPCODES = new Set(["event_broadcast", "event_broadcastandwait"]);
const RECV_OPCODE = "event_whenbroadcastreceived";

export interface BroadcastRef {
  targetId: string;
  blockId: string;
  /** Stable key: prefer broadcast id, else lowercase name. */
  key: string;
  name: string | null;
  broadcastId: string | null;
}

function broadcastKey(id: string | null, name: string | null): string | null {
  if (id && id.length > 0) return `id:${id}`;
  if (name && name.length > 0) return `name:${name.toLowerCase()}`;
  return null;
}

function fieldBroadcast(
  block: DiagnosticBlockIR,
): {name: string | null; id: string | null} | null {
  const field = block.fields.get("BROADCAST_OPTION");
  if (!field) return null;
  const name = typeof field.value === "string" ? field.value : null;
  const id = typeof field.id === "string" ? field.id : null;
  if (!name && !id) return null;
  return {name, id};
}

/**
 * Resolve broadcast identity for a send block via its menu shadow.
 */
export function resolveSendBroadcast(
  target: DiagnosticTargetIR,
  send: DiagnosticBlockIR,
): BroadcastRef | null {
  const input = send.inputs.get("BROADCAST_INPUT");
  if (!input) return null;
  const menuId = inputOccupantBlockId(input);
  if (!menuId) return null;
  const menu = target.blocksById.get(menuId);
  if (!menu) return null;
  const field = fieldBroadcast(menu);
  if (!field) return null;
  const key = broadcastKey(field.id, field.name);
  if (!key) return null;
  return {
    targetId: target.id,
    blockId: send.id,
    key,
    name: field.name,
    broadcastId: field.id,
  };
}

export function resolveReceiveBroadcast(
  target: DiagnosticTargetIR,
  recv: DiagnosticBlockIR,
): BroadcastRef | null {
  const field = fieldBroadcast(recv);
  if (!field) return null;
  const key = broadcastKey(field.id, field.name);
  if (!key) return null;
  return {
    targetId: target.id,
    blockId: recv.id,
    key,
    name: field.name,
    broadcastId: field.id,
  };
}

function collectBroadcastGraph(ir: DiagnosticProjectIR): {
  sends: BroadcastRef[];
  receives: BroadcastRef[];
} {
  const sends: BroadcastRef[] = [];
  const receives: BroadcastRef[] = [];
  for (const target of ir.targets) {
    for (const block of target.blocksById.values()) {
      if (block.shadow) continue;
      if (SEND_OPCODES.has(block.opcode)) {
        const ref = resolveSendBroadcast(target, block);
        if (ref) sends.push(ref);
      } else if (block.opcode === RECV_OPCODE) {
        const ref = resolveReceiveBroadcast(target, block);
        if (ref) receives.push(ref);
      }
    }
  }
  return {sends, receives};
}

export const broadcastSendWithoutReceiveRule: DiagnosticRule = {
  id: "broadcast.send-without-receive",
  run(ir: DiagnosticProjectIR): DiagnosticFinding[] {
    const {sends, receives} = collectBroadcastGraph(ir);
    const receiveKeys = new Set(receives.map(r => r.key));
    const findings: DiagnosticFinding[] = [];
    for (const send of sends) {
      if (receiveKeys.has(send.key)) continue;
      findings.push({
        ruleId: "broadcast.send-without-receive",
        category: "broadcast",
        severity: "warning",
        confidence: "certain",
        targetIds: [send.targetId],
        blockIds: [send.blockId],
        evidence: [
          {
            kind: "broadcast-send",
            targetId: send.targetId,
            blockIds: [send.blockId],
            detail: send.key,
          },
        ],
        rootCauseGroup: `broadcast:${send.key}`,
        hintId: "hint.broadcast.send-without-receive",
      });
    }
    return findings;
  },
};

export const broadcastReceiveWithoutSendRule: DiagnosticRule = {
  id: "broadcast.receive-without-send",
  run(ir: DiagnosticProjectIR): DiagnosticFinding[] {
    const {sends, receives} = collectBroadcastGraph(ir);
    const sendKeys = new Set(sends.map(s => s.key));
    const findings: DiagnosticFinding[] = [];
    for (const recv of receives) {
      if (sendKeys.has(recv.key)) continue;
      findings.push({
        ruleId: "broadcast.receive-without-send",
        category: "broadcast",
        severity: "suggestion",
        confidence: "likely",
        targetIds: [recv.targetId],
        blockIds: [recv.blockId],
        evidence: [
          {
            kind: "broadcast-receive",
            targetId: recv.targetId,
            blockIds: [recv.blockId],
            detail: recv.key,
          },
        ],
        rootCauseGroup: `broadcast:${recv.key}`,
        hintId: "hint.broadcast.receive-without-send",
      });
    }
    return findings;
  },
};
