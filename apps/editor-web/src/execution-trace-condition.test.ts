import {describe, expect, it} from "vitest";
import {
  describeBlockExpression,
  describeConditionExpression,
} from "./execution-trace-condition.js";
import {createTraceDescriptorContext, getTraceDescriptor} from "./execution-trace-format.js";
import type {TraceBlockLike} from "./execution-trace-types.js";

function blockMap(blocks: Record<string, TraceBlockLike>) {
  return (id: string) => blocks[id] ?? null;
}

describe("describeBlockExpression", () => {
  it("describes x座標 > 50 comparisons", () => {
    const blocks: Record<string, TraceBlockLike> = {
      gt: {
        opcode: "operator_gt",
        inputs: {
          OPERAND1: {name: "OPERAND1", block: "x", shadow: "n1"},
          OPERAND2: {name: "OPERAND2", block: "n2", shadow: "n2"},
        },
      },
      x: {opcode: "motion_xposition", inputs: {}, fields: {}},
      n1: {opcode: "math_number", fields: {NUM: {name: "NUM", value: ""}}},
      n2: {opcode: "math_number", fields: {NUM: {name: "NUM", value: "50"}}},
    };
    expect(describeBlockExpression("gt", blockMap(blocks))).toBe("x座標 > 50");
  });

  it("reads sb3-shaped comparison graphs", () => {
    const blocks: Record<string, TraceBlockLike> = {
      gt: {
        opcode: "operator_gt",
        inputs: {
          OPERAND1: [3, "x", [4, ""]],
          OPERAND2: [1, [4, "50"]],
        },
      },
      x: {opcode: "motion_yposition"},
    };
    // OPERAND2 is a pure literal shadow without a separate block id.
    expect(describeBlockExpression("gt", blockMap(blocks))).toBe("y座標 > 50");
  });

  it("describes key-pressed sensing with menu field", () => {
    const blocks: Record<string, TraceBlockLike> = {
      key: {
        opcode: "sensing_keypressed",
        inputs: {KEY_OPTION: {name: "KEY_OPTION", block: "menu", shadow: "menu"}},
      },
      menu: {
        opcode: "sensing_keyoptions",
        fields: {KEY_OPTION: {name: "KEY_OPTION", value: "space"}},
      },
    };
    expect(describeBlockExpression("key", blockMap(blocks))).toBe(
      "スペースキーが押された",
    );
  });
});

describe("describeConditionExpression / control_if enrichControl", () => {
  it("pulls CONDITION expression from the current stack block", () => {
    const blocks: Record<string, TraceBlockLike> = {
      iff: {
        opcode: "control_if",
        inputs: {CONDITION: {name: "CONDITION", block: "gt"}},
      },
      gt: {
        opcode: "operator_gt",
        inputs: {
          OPERAND1: {block: "x", shadow: "n1"},
          OPERAND2: {block: "n2", shadow: "n2"},
        },
      },
      x: {opcode: "motion_xposition"},
      n2: {opcode: "math_number", fields: {NUM: {value: "50"}}},
    };
    const util = {
      thread: {peekStack: () => "iff"},
      target: {blocks: {getBlock: blockMap(blocks)}},
    };
    expect(describeConditionExpression(util)).toBe("x座標 > 50");

    const control = getTraceDescriptor("control_if")!.enrichControl!(
      {CONDITION: false},
      util,
      undefined,
      createTraceDescriptorContext(),
    );
    expect(control).toEqual({
      branch: 0,
      conditionText: "x座標 > 50",
    });
  });
});
