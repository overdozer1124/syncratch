import {allowedOpcodeSet} from "@blocksync/project-schema";
import {
  describeOpcodeInJapanese,
  fallbackJapaneseLabel,
  localizeArgsForDisplay,
  localizeTraceArgValue,
} from "./execution-trace-ja.js";
import {
  formatDirection,
  formatTraceNumber,
  traceValueToText,
} from "./execution-trace-values.js";
import type {
  TraceDescriptor,
  TraceDescriptorContext,
  TraceSemanticSnapshot,
  TraceStateSnapshot,
  TraceValue,
} from "./execution-trace-types.js";

const FOREVER_VISIT = new WeakMap<object, Map<string, number>>();

export function createTraceDescriptorContext(): TraceDescriptorContext {
  return {foreverVisits: FOREVER_VISIT};
}

function argNumber(args: Record<string, TraceValue>, key: string): number | null {
  const value = args[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function argText(args: Record<string, TraceValue>, key: string): string {
  return traceValueToText(args[key]);
}

function formatConditionText(snapshot: TraceSemanticSnapshot): string {
  if (snapshot.control?.conditionText) return snapshot.control.conditionText;
  const condition = snapshot.args.CONDITION;
  const text = traceValueToText(condition);
  return text || "条件";
}

const descriptors: Record<string, TraceDescriptor> = {
  event_whenflagclicked: {
    describe: () => "緑の旗でスクリプトを開始した",
  },
  motion_movesteps: {
    describe(snapshot) {
      const steps = argNumber(snapshot.args, "STEPS");
      if (steps === null) return "歩いた";
      return `${formatTraceNumber(steps)}歩動いた`;
    },
  },
  motion_turnright: {
    describe(snapshot) {
      const degrees = argNumber(snapshot.args, "DEGREES");
      if (degrees === null) return "右に回った";
      return `${formatTraceNumber(degrees)}度右に回った`;
    },
  },
  motion_turnleft: {
    describe(snapshot) {
      const degrees = argNumber(snapshot.args, "DEGREES");
      if (degrees === null) return "左に回った";
      return `${formatTraceNumber(degrees)}度左に回った`;
    },
  },
  motion_setx: {
    describe(snapshot) {
      const x = argNumber(snapshot.args, "X");
      if (x === null) return "x座標を決めた";
      return `x座標を ${formatTraceNumber(x)} にした`;
    },
  },
  motion_sety: {
    describe(snapshot) {
      const y = argNumber(snapshot.args, "Y");
      if (y === null) return "y座標を決めた";
      return `y座標を ${formatTraceNumber(y)} にした`;
    },
  },
  motion_ifonedgebounce: {
    captureBefore(_args, util) {
      const target = util.target;
      if (!target) return undefined;
      return {direction: target.direction, x: target.x, y: target.y};
    },
    captureAfter(_args, util, before) {
      const target = util.target;
      if (!target || !before) return undefined;
      return {direction: target.direction, x: target.x, y: target.y};
    },
    enrichControl(_args, util, before, ctx) {
      const afterDir = util.target?.direction;
      const beforeDir = before?.direction;
      const bounced =
        beforeDir !== undefined &&
        afterDir !== undefined &&
        formatDirection(beforeDir) !== formatDirection(afterDir);
      return {bounced: bounced ?? false};
    },
    describe(snapshot) {
      const beforeDir = snapshot.before?.direction;
      const afterDir = snapshot.after?.direction;
      const bounced =
        snapshot.control?.bounced ??
        (beforeDir !== undefined &&
          afterDir !== undefined &&
          formatDirection(beforeDir) !== formatDirection(afterDir));
      if (!bounced) return "端で跳ね返った？ → いいえ";
      if (beforeDir === undefined || afterDir === undefined) {
        return "端で跳ね返った？ → はい";
      }
      return `端で跳ね返った？ → はい（向き ${formatDirection(beforeDir)}° → ${formatDirection(afterDir)}°）`;
    },
  },
  control_forever: {
    enrichControl(_args, util, _before, ctx) {
      const thread = util.thread;
      const blockId = thread?.peekStack?.();
      if (!thread || !blockId) return {firstVisit: true};
      let visits = ctx.foreverVisits.get(thread);
      if (!visits) {
        visits = new Map();
        ctx.foreverVisits.set(thread, visits);
      }
      const count = (visits.get(blockId) ?? 0) + 1;
      visits.set(blockId, count);
      return {firstVisit: count === 1, iteration: count};
    },
    describe(snapshot) {
      if (snapshot.control?.firstVisit) return "「ずっと」を開始した";
      return "「ずっと」の先頭に戻った";
    },
  },
  control_repeat: {
    captureBefore(args, util) {
      const total = Math.round(Number(args.TIMES));
      return {
        repeat: {total, loopCounterBefore: util.stackFrame?.loopCounter},
      };
    },
    enrichControl(args, util, before) {
      const total = before?.repeat?.total ?? Math.round(Number(args.TIMES));
      const loopCounterBefore = before?.repeat?.loopCounterBefore;
      const after = util.stackFrame?.loopCounter;
      if (loopCounterBefore === undefined && typeof after === "number") {
        return {firstVisit: true, total, iteration: 1};
      }
      if (typeof after === "number" && after >= 0) {
        return {firstVisit: false, total, iteration: total - after};
      }
      return {firstVisit: false, total};
    },
    describe(snapshot) {
      const total = snapshot.control?.total;
      const iteration = snapshot.control?.iteration;
      if (snapshot.control?.firstVisit && total !== undefined) {
        return `${formatTraceNumber(total)}回の繰り返しを開始した`;
      }
      if (
        total !== undefined &&
        iteration !== undefined &&
        iteration <= total &&
        iteration > 0
      ) {
        return `繰り返しの先頭に戻った（${formatTraceNumber(iteration)}/${formatTraceNumber(total)}回目）`;
      }
      if (total !== undefined) {
        return `${formatTraceNumber(total)}回の繰り返しを終えた`;
      }
      return "繰り返した";
    },
  },
  control_if: {
    enrichControl(args) {
      const condition = Boolean(args.CONDITION);
      return {
        branch: condition ? 1 : 0,
        conditionText: conditionTextFromArgs(args),
      };
    },
    describe(snapshot) {
      const condition = formatConditionText(snapshot);
      const truthy = snapshot.control?.branch === 1;
      if (truthy) {
        return `条件「${condition}」→ はい。「なら」の中へ進んだ`;
      }
      return `条件「${condition}」→ いいえ。「なら」をスキップした`;
    },
  },
  control_if_else: {
    enrichControl(args) {
      const condition = Boolean(args.CONDITION);
      return {
        branch: condition ? 1 : 2,
        conditionText: conditionTextFromArgs(args),
      };
    },
    describe(snapshot) {
      const condition = formatConditionText(snapshot);
      const branch = snapshot.control?.branch;
      if (branch === 1) {
        return `条件「${condition}」→ はい。「なら」の中へ進んだ`;
      }
      return `条件「${condition}」→ いいえ。「でなければ」の中へ進んだ`;
    },
  },
  control_wait: {
    describe(snapshot) {
      const duration = argNumber(snapshot.args, "DURATION");
      if (duration === null) return "待った";
      return `${formatTraceNumber(duration)}秒待った`;
    },
  },
  control_stop: {
    describe(snapshot) {
      const option = localizeTraceArgValue(
        "STOP_OPTION",
        snapshot.args.STOP_OPTION,
      );
      if (!option) return "スクリプトを止めた";
      return `「${option}」を止めた`;
    },
  },
  looks_say: {
    describe(snapshot) {
      const message = argText(snapshot.args, "MESSAGE");
      if (!message) return "言った";
      return `「${message}」と言った`;
    },
  },
  looks_sayforsecs: {
    describe(snapshot) {
      const message = argText(snapshot.args, "MESSAGE");
      const secs = argNumber(snapshot.args, "SECS");
      if (!message && secs === null) return "少しの間言った";
      if (secs === null) return `「${message}」と言った`;
      return `「${message}」と ${formatTraceNumber(secs)} 秒言った`;
    },
  },
  data_setvariableto: {
    captureBefore(args, util) {
      return readVariableState(args, util);
    },
    captureAfter(args, util) {
      return readVariableState(args, util);
    },
    describe(snapshot) {
      const name =
        traceValueToText(snapshot.args.VARIABLE) ||
        snapshot.before?.variable?.name ||
        "変数";
      const before = snapshot.before?.variable?.value;
      const after = snapshot.after?.variable?.value ?? snapshot.args.VALUE;
      if (before !== undefined && after !== undefined) {
        return `変数「${name}」を ${traceValueToText(before as TraceValue)} → ${traceValueToText(after as TraceValue)} に変えた`;
      }
      const value = traceValueToText(after as TraceValue);
      if (value) return `変数「${name}」を ${value} にした`;
      return `変数「${name}」を決めた`;
    },
  },
  data_changevariableby: {
    captureBefore(args, util) {
      return readVariableState(args, util);
    },
    captureAfter(args, util) {
      return readVariableState(args, util);
    },
    describe(snapshot) {
      const name =
        traceValueToText(snapshot.args.VARIABLE) ||
        snapshot.before?.variable?.name ||
        "変数";
      const before = snapshot.before?.variable?.value;
      const after = snapshot.after?.variable?.value;
      if (before !== undefined && after !== undefined) {
        return `変数「${name}」を ${traceValueToText(before as TraceValue)} → ${traceValueToText(after as TraceValue)} に変えた`;
      }
      const delta = argNumber(snapshot.args, "VALUE");
      if (delta !== null) {
        return `変数「${name}」を ${formatTraceNumber(delta)} だけ変えた`;
      }
      return `変数「${name}」を変えた`;
    },
  },
  event_broadcast: {
    describe(snapshot) {
      const message = argText(snapshot.args, "BROADCAST_OPTION");
      if (!message) return "メッセージを送った";
      return `「${message}」を送った`;
    },
  },
  event_broadcastandwait: {
    describe(snapshot) {
      const message = argText(snapshot.args, "BROADCAST_OPTION");
      if (!message) return "メッセージを送って待った";
      return `「${message}」を送って待った`;
    },
  },
};

function conditionTextFromArgs(args: Record<string, unknown>): string {
  const condition = args.CONDITION;
  if (typeof condition === "string") return condition;
  if (typeof condition === "number") return formatTraceNumber(condition);
  if (typeof condition === "boolean") return condition ? "はい" : "いいえ";
  return "条件";
}

function readVariableState(
  args: Record<string, unknown>,
  util: {target?: {lookupOrCreateVariable?: (id: string, name: string) => {value?: unknown}} | null},
) {
  const variableArg = args.VARIABLE as {id?: string; name?: string} | undefined;
  if (!variableArg?.name || !util.target?.lookupOrCreateVariable) return undefined;
  const variable = util.target.lookupOrCreateVariable(
    variableArg.id ?? variableArg.name,
    variableArg.name,
  );
  return {
    variable: {
      id: variableArg.id,
      name: variableArg.name,
      value: variable.value as TraceValue,
    },
  };
}

const blockTemplateCache = new Map<string, string>();

export function indexBlockTemplates(
  blocksJson: Array<{type?: string; message0?: string; message1?: string; message2?: string}> | undefined,
): void {
  blockTemplateCache.clear();
  for (const block of blocksJson ?? []) {
    if (!block.type) continue;
    const parts = [block.message0, block.message1, block.message2].filter(Boolean);
    if (parts.length > 0) blockTemplateCache.set(block.type, parts.join(" "));
  }
}

export function lookupBlockTemplate(opcode: string | null | undefined): string | undefined {
  if (!opcode) return undefined;
  return blockTemplateCache.get(opcode);
}

function fillTemplate(template: string, args: Record<string, TraceValue>): string {
  const keys = Object.keys(args);
  let index = 0;
  // Scratch message0 uses %1/%2…; some JSON defs use %n/%s/%b.
  return template.replace(/%(?:[nsb]|\d+)/gi, () => {
    const key = keys[index];
    index += 1;
    if (!key) return "…";
    const value = localizeTraceArgValue(key, args[key]);
    return value || "…";
  });
}

function looksLikeOpcodeId(text: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/i.test(text.trim());
}

function formatGenericFallback(snapshot: TraceSemanticSnapshot): string {
  const localizedArgs = localizeArgsForDisplay(snapshot.args);
  const rawTemplate =
    snapshot.displayTemplate ??
    (snapshot.opcode ? lookupBlockTemplate(snapshot.opcode) : undefined);
  const hasLearnerTemplate =
    typeof rawTemplate === "string" &&
    rawTemplate.trim().length > 0 &&
    !looksLikeOpcodeId(rawTemplate);

  if (hasLearnerTemplate) {
    const filled = fillTemplate(rawTemplate, localizedArgs);
    return `「${filled}」を実行した`;
  }

  const label = fallbackJapaneseLabel(snapshot.opcode, rawTemplate);
  const argEntries = Object.entries(localizedArgs).filter(
    ([key]) => key !== "mutation",
  );
  if (argEntries.length === 0) {
    return `「${label}」を実行した`;
  }
  // Learner-facing summary: Japanese values only (no STYLE=left-right dumps).
  const inputSummary = argEntries
    .map(([key, value]) => localizeTraceArgValue(key, value))
    .filter(Boolean)
    .join("、");
  if (!inputSummary) return `「${label}」を実行した`;
  return `「${label}（${inputSummary}）」を実行した`;
}

/** Assertive past-tense fragments that generic fallback must not invent. */
const ASSERTIVE_RESULT_PATTERNS = [
  /跳ね返った(?!？)/,
  /^歩いた$/,
  /^言った$/,
  /^待った$/,
  /^止めた$/,
];

export function describeTraceSnapshot(snapshot: TraceSemanticSnapshot): string {
  const opcode = snapshot.opcode;
  if (opcode && descriptors[opcode]) {
    return descriptors[opcode].describe(snapshot);
  }
  const japanese = describeOpcodeInJapanese(snapshot);
  if (japanese) return japanese;
  return formatGenericFallback(snapshot);
}

export function getTraceDescriptor(opcode: string): TraceDescriptor | undefined {
  return descriptors[opcode];
}

export function isCoreOpcodeCovered(opcode: string): boolean {
  if (descriptors[opcode]) return true;
  const text = describeTraceSnapshot({
    opcode,
    args: {STEPS: 1},
    displayTemplate: lookupBlockTemplate(opcode),
  });
  return !ASSERTIVE_RESULT_PATTERNS.some(pattern => pattern.test(text));
}

export function assertAllCoreOpcodesCovered(): void {
  const missing: string[] = [];
  for (const opcode of allowedOpcodeSet()) {
    if (!isCoreOpcodeCovered(opcode)) missing.push(opcode);
  }
  if (missing.length > 0) {
    throw new Error(`Uncovered opcodes without safe fallback: ${missing.join(", ")}`);
  }
}

export {descriptors as traceDescriptorsForTest};
