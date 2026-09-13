/**
 * Build learner-facing Japanese text for boolean/reporter expressions
 * attached to control_if / similar hats. Scratch passes only the evaluated
 * boolean as args.CONDITION, so we walk the block graph instead.
 */

import {localizeTraceArgValue} from "./execution-trace-ja.js";
import type {TraceBlockLike, TraceBlockUtilLike} from "./execution-trace-types.js";
import {formatTraceNumber} from "./execution-trace-values.js";

const MAX_DEPTH = 8;

/** Runtime `{value}` or sb3 `[value, id]` field (kept local to avoid import cycles). */
function readFieldValue(field: unknown): unknown {
  if (field === null || field === undefined) return undefined;
  if (
    typeof field === "string" ||
    typeof field === "number" ||
    typeof field === "boolean"
  ) {
    return field;
  }
  if (Array.isArray(field)) {
    return field.length > 0 ? field[0] : undefined;
  }
  if (typeof field === "object") {
    const record = field as {value?: unknown};
    if ("value" in record) return record.value;
  }
  return undefined;
}

/** Zero-arg reporters → short Japanese noun/phrase. */
const REPORTER_JA: Record<string, string> = {
  motion_xposition: "x座標",
  motion_yposition: "y座標",
  motion_direction: "向き",
  looks_size: "大きさ",
  looks_costumenumbername: "コスチューム",
  looks_backdropnumbername: "背景",
  sound_volume: "音量",
  sensing_timer: "タイマー",
  sensing_loudness: "音量",
  sensing_answer: "答え",
  sensing_mousedown: "マウスが押された",
  sensing_mousex: "マウスのx座標",
  sensing_mousey: "マウスのy座標",
  sensing_username: "ユーザー名",
  sensing_dayssince2000: "2000年からの日数",
  sensing_current: "現在",
  sensing_distanceto: "距離",
};

function resolveInputBlockId(input: unknown): string | null {
  if (input == null) return null;
  if (Array.isArray(input)) {
    const primary = input[1];
    if (typeof primary === "string" && primary) return primary;
    return null;
  }
  if (typeof input === "object") {
    const record = input as {block?: string | null; shadow?: string | null};
    if (typeof record.block === "string" && record.block) return record.block;
    if (typeof record.shadow === "string" && record.shadow) return record.shadow;
  }
  return null;
}

function describeInput(
  block: TraceBlockLike,
  key: string,
  getBlock: (id: string) => TraceBlockLike | null | undefined,
  depth: number,
  visited: Set<string>,
): string {
  const input = block.inputs?.[key];
  const childId = resolveInputBlockId(input);
  if (!childId) {
    // sb3 literal shadow without a separate block id: [1, [4, "50"]]
    if (Array.isArray(input) && Array.isArray(input[1]) && input[1].length >= 2) {
      return formatLiteral(input[1][1]);
    }
    return "…";
  }
  return describeBlockExpression(childId, getBlock, depth + 1, visited) || "…";
}

function formatLiteral(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatTraceNumber(value);
  }
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (typeof value === "string") {
    const asNum = Number(value);
    if (value.trim() !== "" && Number.isFinite(asNum) && String(asNum) === value.trim()) {
      return formatTraceNumber(asNum);
    }
    return value;
  }
  return "…";
}

function fieldText(block: TraceBlockLike, key: string): string {
  const raw = readFieldValue(block.fields?.[key]);
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "object") {
    const named = raw as {name?: string};
    if (typeof named.name === "string") {
      return localizeTraceArgValue(key, named.name);
    }
  }
  return localizeTraceArgValue(
    key,
    typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
      ? raw
      : String(raw),
  );
}

function wrapBinary(left: string, op: string, right: string): string {
  return `${left} ${op} ${right}`;
}

/**
 * Describe a reporter/boolean block tree as short Japanese / math text.
 */
export function describeBlockExpression(
  blockId: string | null | undefined,
  getBlock: (id: string) => TraceBlockLike | null | undefined,
  depth = 0,
  visited: Set<string> = new Set(),
): string | null {
  if (!blockId || depth > MAX_DEPTH) return null;
  if (visited.has(blockId)) return "…";
  visited.add(blockId);

  const block = getBlock(blockId);
  if (!block?.opcode) return null;
  const opcode = block.opcode;

  switch (opcode) {
    case "math_number":
    case "math_integer":
    case "math_whole_number":
    case "math_positive_number":
      return formatLiteral(readFieldValue(block.fields?.NUM)) || "…";
    case "text":
      return formatLiteral(readFieldValue(block.fields?.TEXT)) || "…";
    case "colour_picker":
      return formatLiteral(readFieldValue(block.fields?.COLOUR)) || "…";
    case "operator_gt":
      return wrapBinary(
        describeInput(block, "OPERAND1", getBlock, depth, visited),
        ">",
        describeInput(block, "OPERAND2", getBlock, depth, visited),
      );
    case "operator_lt":
      return wrapBinary(
        describeInput(block, "OPERAND1", getBlock, depth, visited),
        "<",
        describeInput(block, "OPERAND2", getBlock, depth, visited),
      );
    case "operator_equals":
      return wrapBinary(
        describeInput(block, "OPERAND1", getBlock, depth, visited),
        "=",
        describeInput(block, "OPERAND2", getBlock, depth, visited),
      );
    case "operator_and":
      return wrapBinary(
        describeInput(block, "OPERAND1", getBlock, depth, visited),
        "かつ",
        describeInput(block, "OPERAND2", getBlock, depth, visited),
      );
    case "operator_or":
      return wrapBinary(
        describeInput(block, "OPERAND1", getBlock, depth, visited),
        "または",
        describeInput(block, "OPERAND2", getBlock, depth, visited),
      );
    case "operator_not": {
      const inner = describeInput(block, "OPERAND", getBlock, depth, visited);
      return `${inner} ではない`;
    }
    case "operator_add":
      return wrapBinary(
        describeInput(block, "NUM1", getBlock, depth, visited),
        "+",
        describeInput(block, "NUM2", getBlock, depth, visited),
      );
    case "operator_subtract":
      return wrapBinary(
        describeInput(block, "NUM1", getBlock, depth, visited),
        "-",
        describeInput(block, "NUM2", getBlock, depth, visited),
      );
    case "operator_multiply":
      return wrapBinary(
        describeInput(block, "NUM1", getBlock, depth, visited),
        "×",
        describeInput(block, "NUM2", getBlock, depth, visited),
      );
    case "operator_divide":
      return wrapBinary(
        describeInput(block, "NUM1", getBlock, depth, visited),
        "÷",
        describeInput(block, "NUM2", getBlock, depth, visited),
      );
    case "operator_join":
      return `${describeInput(block, "STRING1", getBlock, depth, visited)} と ${describeInput(block, "STRING2", getBlock, depth, visited)}`;
    case "operator_contains":
      return `${describeInput(block, "STRING1", getBlock, depth, visited)} に ${describeInput(block, "STRING2", getBlock, depth, visited)} が含まれる`;
    case "sensing_keypressed": {
      const keyBlock = resolveInputBlockId(block.inputs?.KEY_OPTION);
      let key = "キー";
      if (keyBlock) {
        const menu = getBlock(keyBlock);
        const fromField = menu ? fieldText(menu, "KEY_OPTION") : "";
        if (fromField) key = fromField;
      } else {
        const direct = fieldText(block, "KEY_OPTION");
        if (direct) key = direct;
      }
      if (key === "スペース" || key === "どれかの") return `${key}キーが押された`;
      return `「${key}」キーが押された`;
    }
    case "sensing_touchingobject": {
      const menuId = resolveInputBlockId(block.inputs?.TOUCHINGOBJECTMENU);
      let target = "何か";
      if (menuId) {
        const menu = getBlock(menuId);
        const fromField = menu ? fieldText(menu, "TOUCHINGOBJECTMENU") : "";
        if (fromField) target = fromField;
      }
      return `${target}に触れた`;
    }
    case "sensing_touchingcolor": {
      const color = describeInput(block, "COLOR", getBlock, depth, visited);
      return `色 ${color} に触れた`;
    }
    case "sensing_coloristouchingcolor": {
      const c1 = describeInput(block, "COLOR", getBlock, depth, visited);
      const c2 = describeInput(block, "COLOR2", getBlock, depth, visited);
      return `色 ${c1} が色 ${c2} に触れた`;
    }
    case "data_variable": {
      const name = fieldText(block, "VARIABLE");
      return name ? `変数「${name}」` : "変数";
    }
    case "data_listcontents": {
      const name = fieldText(block, "LIST");
      return name ? `リスト「${name}」` : "リスト";
    }
    case "sensing_touchingobjectmenu":
    case "sensing_distancetomenu":
    case "sensing_keyoptions":
    case "motion_goto_menu":
    case "motion_glideto_menu":
    case "motion_pointtowards_menu": {
      const fieldKey = Object.keys(block.fields ?? {})[0];
      if (!fieldKey) return "…";
      return fieldText(block, fieldKey) || "…";
    }
    default: {
      if (REPORTER_JA[opcode]) return REPORTER_JA[opcode];
      // Current / costume number-name menus often carry a NUMBER_NAME field.
      const numberName = fieldText(block, "NUMBER_NAME");
      if (numberName && REPORTER_JA[opcode] === undefined) {
        const base =
          opcode === "looks_costumenumbername"
            ? "コスチューム"
            : opcode === "looks_backdropnumbername"
              ? "背景"
              : opcode === "sensing_current"
                ? "現在"
                : null;
        if (base) return `${base}の${numberName}`;
      }
      return null;
    }
  }
}

/** Read CONDITION input on the current stack block and describe it. */
export function describeConditionExpression(
  util: TraceBlockUtilLike | null | undefined,
): string | null {
  const blockId = util?.thread?.peekStack?.();
  if (typeof blockId !== "string" || !blockId) return null;
  const target = util?.target ?? util?.thread?.target ?? null;
  const getBlock = target?.blocks?.getBlock?.bind(target.blocks);
  if (!getBlock) return null;
  const block = getBlock(blockId);
  if (!block) return null;
  const conditionId = resolveInputBlockId(block.inputs?.CONDITION);
  if (!conditionId) return null;
  return describeBlockExpression(conditionId, getBlock);
}

export {resolveInputBlockId};
