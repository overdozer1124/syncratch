import type {ProjectDocument} from "@blocksync/project-schema";
import {
  broadcastReceiveOnly,
  broadcastSendOnly,
  emptyFlagHat,
  emptyForeverBody,
  normalGreenFlagMove,
} from "./project-fixtures.js";

export type MutationId =
  | "empty-c-block"
  | "broadcast-send-only"
  | "broadcast-receive-only"
  | "empty-event-script"
  | "none";

export interface MutationCase {
  id: MutationId;
  document: ProjectDocument;
  expectedRuleIds: string[];
}

/** Single-mutation oracle cases for the release corpus. */
export const SINGLE_MUTATIONS: MutationCase[] = [
  {
    id: "none",
    document: normalGreenFlagMove(),
    expectedRuleIds: [],
  },
  {
    id: "empty-c-block",
    document: emptyForeverBody(),
    expectedRuleIds: ["empty-c-block"],
  },
  {
    id: "broadcast-send-only",
    document: broadcastSendOnly(),
    expectedRuleIds: ["broadcast.send-without-receive"],
  },
  {
    id: "broadcast-receive-only",
    document: broadcastReceiveOnly(),
    expectedRuleIds: ["broadcast.receive-without-send"],
  },
  {
    id: "empty-event-script",
    document: emptyFlagHat(),
    expectedRuleIds: ["empty-event-script"],
  },
];

/** Pairwise: empty forever under green flag also has empty-c-block (not empty hat). */
export function pairwiseEmptyForever(): MutationCase {
  return {
    id: "empty-c-block",
    document: emptyForeverBody(),
    expectedRuleIds: ["empty-c-block"],
  };
}
