/**
 * First-party ProjectDocument fixtures for diagnostics rules (no scraped projects).
 */

import type {ProjectDocument, ScratchBlock} from "@blocksync/project-schema";

export function block(
  id: string,
  opcode: string,
  overrides: Partial<ScratchBlock> = {},
): ScratchBlock {
  return {
    id,
    opcode,
    next: overrides.next ?? null,
    parent: overrides.parent ?? null,
    inputs: overrides.inputs ?? {},
    fields: overrides.fields ?? {},
    ...(overrides.shadow !== undefined ? {shadow: overrides.shadow} : {}),
    ...(overrides.topLevel !== undefined ? {topLevel: overrides.topLevel} : {}),
    ...(overrides.mutation !== undefined ? {mutation: overrides.mutation} : {}),
  };
}

export function normalGreenFlagMove(): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
      },
      {
        id: "s1",
        name: "Sprite1",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: "move",
            parent: null,
            topLevel: true,
          }),
          move: block("move", "motion_movesteps", {
            next: null,
            parent: "hat",
            inputs: {STEPS: [1, [4, "10"]]},
          }),
        },
      },
    ],
    extensions: [],
  };
}

export function emptyForeverBody(): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "s1",
        name: "Sprite1",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: "loop",
            parent: null,
            topLevel: true,
          }),
          loop: block("loop", "control_forever", {
            next: null,
            parent: "hat",
            inputs: {SUBSTACK: [2, null]},
          }),
        },
      },
    ],
    extensions: [],
  };
}

export function filledForeverBody(): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "s1",
        name: "Sprite1",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: "loop",
            parent: null,
            topLevel: true,
          }),
          loop: block("loop", "control_forever", {
            next: null,
            parent: "hat",
            inputs: {SUBSTACK: [2, "body"]},
          }),
          body: block("body", "motion_movesteps", {
            next: null,
            parent: "loop",
            inputs: {STEPS: [1, [4, "10"]]},
          }),
        },
      },
    ],
    extensions: [],
  };
}

export function broadcastMatched(): ProjectDocument {
  const bcastId = "bcast-start";
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        broadcasts: {[bcastId]: "start"},
        blocks: {},
      },
      {
        id: "s1",
        name: "Sender",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: "send",
            parent: null,
            topLevel: true,
          }),
          send: block("send", "event_broadcast", {
            next: null,
            parent: "hat",
            inputs: {BROADCAST_INPUT: [1, "menu"]},
          }),
          menu: block("menu", "event_broadcast_menu", {
            shadow: true,
            parent: "send",
            fields: {BROADCAST_OPTION: ["start", bcastId]},
          }),
        },
      },
      {
        id: "s2",
        name: "Receiver",
        isStage: false,
        blocks: {
          recv: block("recv", "event_whenbroadcastreceived", {
            next: "say",
            parent: null,
            topLevel: true,
            fields: {BROADCAST_OPTION: ["start", bcastId]},
          }),
          say: block("say", "looks_say", {
            next: null,
            parent: "recv",
            inputs: {MESSAGE: [1, [10, "hi"]]},
          }),
        },
      },
    ],
    extensions: [],
  };
}

export function broadcastSendOnly(): ProjectDocument {
  const bcastId = "bcast-alone";
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        broadcasts: {[bcastId]: "alone"},
        blocks: {},
      },
      {
        id: "s1",
        name: "Sender",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: "send",
            parent: null,
            topLevel: true,
          }),
          send: block("send", "event_broadcast", {
            next: null,
            parent: "hat",
            inputs: {BROADCAST_INPUT: [1, "menu"]},
          }),
          menu: block("menu", "event_broadcast_menu", {
            shadow: true,
            parent: "send",
            fields: {BROADCAST_OPTION: ["alone", bcastId]},
          }),
        },
      },
    ],
    extensions: [],
  };
}

export function broadcastReceiveOnly(): ProjectDocument {
  const bcastId = "bcast-wait";
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        broadcasts: {[bcastId]: "wait"},
        blocks: {},
      },
      {
        id: "s1",
        name: "Receiver",
        isStage: false,
        blocks: {
          recv: block("recv", "event_whenbroadcastreceived", {
            next: "say",
            parent: null,
            topLevel: true,
            fields: {BROADCAST_OPTION: ["wait", bcastId]},
          }),
          say: block("say", "looks_say", {
            next: null,
            parent: "recv",
            inputs: {MESSAGE: [1, [10, "ok"]]},
          }),
        },
      },
    ],
    extensions: [],
  };
}

/** Near-miss: send-block has BROADCAST_OPTION on itself (invalid for matching). */
export function broadcastNearMissParentFieldOnly(): ProjectDocument {
  const bcastId = "bcast-near";
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        broadcasts: {[bcastId]: "near"},
        blocks: {},
      },
      {
        id: "s1",
        name: "Sender",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: "send",
            parent: null,
            topLevel: true,
          }),
          send: block("send", "event_broadcast", {
            next: null,
            parent: "hat",
            // Intentionally no BROADCAST_INPUT menu — only a misleading field.
            fields: {BROADCAST_OPTION: ["near", bcastId]},
            inputs: {},
          }),
        },
      },
      {
        id: "s2",
        name: "Receiver",
        isStage: false,
        blocks: {
          recv: block("recv", "event_whenbroadcastreceived", {
            next: null,
            parent: null,
            topLevel: true,
            fields: {BROADCAST_OPTION: ["near", bcastId]},
          }),
        },
      },
    ],
    extensions: [],
  };
}

export function emptyFlagHat(): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "s1",
        name: "Sprite1",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: null,
            parent: null,
            topLevel: true,
          }),
        },
      },
    ],
    extensions: [],
  };
}

/** Creative normal variant: if/else with both branches filled. */
export function normalIfElse(): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [
      {
        id: "s1",
        name: "Sprite1",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: "iff",
            parent: null,
            topLevel: true,
          }),
          iff: block("iff", "control_if_else", {
            next: null,
            parent: "hat",
            inputs: {
              CONDITION: [2, "cond"],
              SUBSTACK: [2, "thenBody"],
              SUBSTACK2: [2, "elseBody"],
            },
          }),
          cond: block("cond", "sensing_touchingobject", {parent: "iff"}),
          thenBody: block("thenBody", "motion_movesteps", {
            parent: "iff",
            inputs: {STEPS: [1, [4, "10"]]},
          }),
          elseBody: block("elseBody", "looks_say", {
            parent: "iff",
            inputs: {MESSAGE: [1, [10, "no"]]},
          }),
        },
      },
    ],
    extensions: [],
  };
}
