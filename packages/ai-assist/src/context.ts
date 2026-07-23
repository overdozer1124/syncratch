/**
 * Compact Scratch project context for AI advice.
 * Sends readable script stacks (not just opcode counts) so the model can
 * diagnose real project issues. Omits costumes, sounds, assets, and PII-heavy comments.
 */

import {sanitizeAiText, truncateForTokens} from "./sanitize.js";

export interface AiBlockSummary {
  opcode: string;
  count: number;
}

export interface AiSpriteContext {
  name: string;
  isStage: boolean;
  blockCount: number;
  topOpcodes: AiBlockSummary[];
  /** Human-readable stacks for this sprite. */
  scriptsText: string;
}

/** Sentinel: ask about the whole project, not one sprite. */
export const AI_QUESTION_TARGET_ALL = "__all__";

export interface AiProjectContext {
  title: string;
  spriteCount: number;
  sprites: AiSpriteContext[];
  /** Currently edited sprite name, when known. */
  editingTargetName: string | null;
  /**
   * Sprite/stage the learner explicitly asked about.
   * Null means the whole project (`AI_QUESTION_TARGET_ALL`).
   */
  questionTargetName: string | null;
  /** Compact plain-text dump for the prompt. */
  summaryText: string;
}

export interface AiQuestionTargetOption {
  value: string;
  label: string;
  isStage: boolean;
}

export interface ScratchBlockLike {
  opcode?: string;
  next?: string | null;
  parent?: string | null;
  shadow?: boolean;
  topLevel?: boolean;
  inputs?: Record<string, unknown>;
  fields?: Record<string, unknown>;
}

export interface ScratchProjectJsonLike {
  targets?: Array<{
    name?: string;
    isStage?: boolean;
    currentCostume?: number;
    direction?: number;
    x?: number;
    y?: number;
    visible?: boolean;
    blocks?: Record<string, ScratchBlockLike | undefined>;
  }>;
}

export interface BuildAiProjectContextOptions {
  title?: string;
  editingTargetName?: string | null;
  /**
   * Explicit UI selection. Use `AI_QUESTION_TARGET_ALL` (or omit/null) for
   * the whole project; otherwise a sprite/stage name.
   */
  questionTargetName?: string | null;
  maxSprites?: number;
  maxScriptsPerSprite?: number;
  maxBlocksPerScript?: number;
  maxSummaryChars?: number;
}

export function listAiQuestionTargets(
  projectJson: ScratchProjectJsonLike | null | undefined,
): AiQuestionTargetOption[] {
  const targets = Array.isArray(projectJson?.targets)
    ? projectJson.targets
    : [];
  const options: AiQuestionTargetOption[] = [
    {value: AI_QUESTION_TARGET_ALL, label: "作品全体", isStage: false},
  ];
  for (const target of targets) {
    const name =
      sanitizeAiText(String(target.name ?? "Untitled")).text || "Untitled";
    const isStage = Boolean(target.isStage);
    options.push({
      value: name,
      label: isStage ? `ステージ「${name}」` : `スプライト「${name}」`,
      isStage,
    });
  }
  return options;
}

/** Normalize UI value → focus name (null = whole project). */
export function resolveQuestionTargetName(
  selected: string | null | undefined,
): string | null {
  const value = (selected ?? "").trim();
  if (!value || value === AI_QUESTION_TARGET_ALL) return null;
  return sanitizeAiText(value).text || null;
}

const DEFAULT_MAX_SPRITES = 8;
const DEFAULT_MAX_SCRIPTS_PER_SPRITE = 8;
const DEFAULT_MAX_BLOCKS_PER_SCRIPT = 24;
const DEFAULT_MAX_SUMMARY_CHARS = 7000;
const DEFAULT_MAX_OPCODES_PER_SPRITE = 12;

const OPCODE_HINTS: Record<string, string> = {
  event_whenflagclicked: "旗が押されたとき",
  event_whenkeypressed: "キーが押されたとき",
  event_whenthisspriteclicked: "このスプライトが押されたとき",
  event_whenbroadcastreceived: "メッセージを受け取ったとき",
  control_forever: "ずっと",
  control_repeat: "〜回繰り返す",
  control_if: "もし〜なら",
  control_if_else: "もし〜なら/でなければ",
  control_wait: "〜秒待つ",
  control_stop: "止める",
  motion_movesteps: "〜歩動かす",
  motion_gotoxy: "x: y: へ行く",
  motion_goto: "〜へ行く",
  motion_glidesecstoxy: "〜秒でx: y: へ行く",
  motion_changexby: "x座標を〜ずつ変える",
  motion_changeyby: "y座標を〜ずつ変える",
  motion_setx: "x座標を〜にする",
  motion_sety: "y座標を〜にする",
  motion_turnright: "時計回りに回す",
  motion_turnleft: "反時計回りに回す",
  motion_pointindirection: "〜度に向ける",
  looks_say: "〜と言う",
  looks_sayforsecs: "〜と〜秒言う",
  looks_show: "表示する",
  looks_hide: "隠す",
  sensing_keypressed: "キーが押された",
  sensing_mousedown: "マウスが押された",
};

function opcodeLabel(opcode: string): string {
  const hint = OPCODE_HINTS[opcode];
  return hint ? `${opcode}（${hint}）` : opcode;
}

function fieldValue(fields: Record<string, unknown> | undefined, key: string): string | null {
  const entry = fields?.[key];
  if (Array.isArray(entry) && entry.length > 0) {
    const value = entry[0];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return null;
}

function inputLiteral(
  inputs: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const entry = inputs?.[key];
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const value = entry[1];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) && value.length >= 2) {
    // Shadow/literal form: [type, literal, ...]
    const literal = value[1];
    if (
      typeof literal === "string" ||
      typeof literal === "number" ||
      typeof literal === "boolean"
    ) {
      return String(literal);
    }
  }
  return null;
}

function describeBlock(block: ScratchBlockLike): string {
  const opcode = typeof block.opcode === "string" ? block.opcode : "unknown";
  const extras: string[] = [];

  const keyOption = fieldValue(block.fields, "KEY_OPTION");
  if (keyOption) extras.push(`key=${keyOption}`);
  const broadcast = fieldValue(block.fields, "BROADCAST_OPTION");
  if (broadcast) extras.push(`msg=${broadcast}`);
  const stopOption = fieldValue(block.fields, "STOP_OPTION");
  if (stopOption) extras.push(`stop=${stopOption}`);

  for (const inputKey of [
    "STEPS",
    "DURATION",
    "SECS",
    "TIMES",
    "X",
    "Y",
    "DX",
    "DY",
    "DEGREES",
    "DIRECTION",
    "MESSAGE",
  ]) {
    const literal = inputLiteral(block.inputs, inputKey);
    if (literal != null) extras.push(`${inputKey.toLowerCase()}=${literal}`);
  }

  const base = opcodeLabel(opcode);
  return extras.length > 0 ? `${base} [${extras.join(", ")}]` : base;
}

/** Scratch nest input: [shadowType, blockId | literalArray | null] */
function inputBlockId(
  inputs: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const entry = inputs?.[key];
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const value = entry[1];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function summarizeBlocks(
  blocks: Record<string, ScratchBlockLike | undefined> | undefined,
): {blockCount: number; topOpcodes: AiBlockSummary[]} {
  const counts = new Map<string, number>();
  let blockCount = 0;
  if (!blocks) return {blockCount: 0, topOpcodes: []};

  for (const block of Object.values(blocks)) {
    if (!block || typeof block.opcode !== "string") continue;
    if (block.shadow) continue;
    blockCount += 1;
    counts.set(block.opcode, (counts.get(block.opcode) ?? 0) + 1);
  }

  const topOpcodes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, DEFAULT_MAX_OPCODES_PER_SPRITE)
    .map(([opcode, count]) => ({opcode, count}));

  return {blockCount, topOpcodes};
}

function listTopLevelScriptIds(
  blocks: Record<string, ScratchBlockLike | undefined>,
): string[] {
  const ids: string[] = [];
  for (const [id, block] of Object.entries(blocks)) {
    if (!block || block.shadow) continue;
    if (block.topLevel === true || (block.parent == null && block.opcode)) {
      ids.push(id);
    }
  }
  // Hats / top-level event blocks first for readability.
  return ids.sort((a, b) => {
    const ao = blocks[a]?.opcode ?? "";
    const bo = blocks[b]?.opcode ?? "";
    const aHat = ao.startsWith("event_") ? 0 : 1;
    const bHat = bo.startsWith("event_") ? 0 : 1;
    if (aHat !== bHat) return aHat - bHat;
    return ao.localeCompare(bo);
  });
}

/**
 * Walk a linear stack and also enter C-block bodies (SUBSTACK / SUBSTACK2).
 * Without this, "ずっと" looks empty even when motion blocks are nested inside.
 */
function appendScriptStack(
  blocks: Record<string, ScratchBlockLike | undefined>,
  startId: string,
  maxBlocks: number,
  indent: string,
  seen: Set<string>,
  lines: string[],
): {used: number; truncated: boolean} {
  let currentId: string | null = startId;
  let used = 0;
  let truncated = false;

  while (currentId) {
    if (used >= maxBlocks) {
      truncated = true;
      break;
    }
    if (seen.has(currentId)) {
      lines.push(`${indent}…(ループ参照のため省略)`);
      break;
    }
    seen.add(currentId);
    const block: ScratchBlockLike | undefined = blocks[currentId];
    if (!block) break;

    used += 1;
    lines.push(`${indent}${used}. ${describeBlock(block)}`);

    const nestedBranches: Array<{key: string; label: string}> = [
      {key: "SUBSTACK", label: "なか"},
      {key: "SUBSTACK2", label: "でなければ"},
    ];
    const isCBlock = nestedBranches.some(
      branch => inputBlockId(block.inputs, branch.key) != null,
    );
    // Explicit empty body: forever/repeat/if with null SUBSTACK.
    if (
      !isCBlock &&
      typeof block.opcode === "string" &&
      (block.opcode === "control_forever" ||
        block.opcode === "control_repeat" ||
        block.opcode === "control_repeat_until" ||
        block.opcode === "control_if" ||
        block.opcode === "control_if_else")
    ) {
      lines.push(`${indent}  （なかにブロックなし）`);
    }

    for (const branch of nestedBranches) {
      const nestedId = inputBlockId(block.inputs, branch.key);
      if (!nestedId) continue;
      lines.push(`${indent}  └ ${branch.label}:`);
      const nested = appendScriptStack(
        blocks,
        nestedId,
        maxBlocks - used,
        `${indent}    `,
        seen,
        lines,
      );
      used += nested.used;
      if (nested.truncated) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;

    currentId = typeof block.next === "string" ? block.next : null;
  }

  return {used, truncated};
}

function formatScriptStack(
  blocks: Record<string, ScratchBlockLike | undefined>,
  startId: string,
  maxBlocks: number,
): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const result = appendScriptStack(
    blocks,
    startId,
    maxBlocks,
    "  ",
    seen,
    lines,
  );
  if (result.truncated) lines.push("  …(以降省略)");
  return lines.join("\n");
}

function formatSpriteScripts(
  blocks: Record<string, ScratchBlockLike | undefined> | undefined,
  maxScripts: number,
  maxBlocksPerScript: number,
): string {
  if (!blocks || Object.keys(blocks).length === 0) {
    return "(スクリプトなし)";
  }
  const topIds = listTopLevelScriptIds(blocks).slice(0, maxScripts);
  if (topIds.length === 0) return "(トップレベルスクリプトなし)";

  const parts: string[] = [];
  topIds.forEach((id, index) => {
    parts.push(`スクリプト${index + 1}:\n${formatScriptStack(blocks, id, maxBlocksPerScript)}`);
  });
  const remaining = listTopLevelScriptIds(blocks).length - topIds.length;
  if (remaining > 0) {
    parts.push(`…他 ${remaining} スクリプトは省略`);
  }
  return parts.join("\n");
}

function findLikelyMotionGaps(scriptsText: string): string[] {
  const gaps: string[] = [];
  const hasHat =
    /event_whenflagclicked|event_whenkeypressed|event_whenthisspriteclicked|event_whenbroadcastreceived/
      .test(scriptsText);
  const hasMotion =
    /motion_movesteps|motion_gotoxy|motion_goto|motion_glidesecstoxy|motion_changexby|motion_changeyby/
      .test(scriptsText);
  if (!hasHat && hasMotion) {
    gaps.push("動きブロックはあるが、開始イベント（旗・キーなど）が見当たらない");
  }
  if (hasHat && !hasMotion) {
    gaps.push("開始イベントはあるが、動かすブロックが見当たらない");
  }
  if (!hasHat && !hasMotion) {
    gaps.push("開始イベントも動かすブロックも見当たらない");
  }
  return gaps;
}

export function buildAiProjectContext(
  projectJson: ScratchProjectJsonLike | null | undefined,
  titleOrOptions: string | BuildAiProjectContextOptions = "作品",
): AiProjectContext {
  const options: BuildAiProjectContextOptions =
    typeof titleOrOptions === "string"
      ? {title: titleOrOptions}
      : (titleOrOptions ?? {});
  const title = options.title ?? "作品";
  const editingTargetName = options.editingTargetName
    ? sanitizeAiText(options.editingTargetName).text || null
    : null;
  const questionTargetName = resolveQuestionTargetName(
    options.questionTargetName,
  );
  const maxSprites = options.maxSprites ?? DEFAULT_MAX_SPRITES;
  const maxScriptsPerSprite =
    options.maxScriptsPerSprite ?? DEFAULT_MAX_SCRIPTS_PER_SPRITE;
  const maxBlocksPerScript =
    options.maxBlocksPerScript ?? DEFAULT_MAX_BLOCKS_PER_SCRIPT;
  const maxSummaryChars = options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS;

  const targets = Array.isArray(projectJson?.targets)
    ? projectJson.targets
    : [];

  // Question target first, then editing target, so diagnosis focuses correctly.
  const orderedTargets = [...targets].sort((a, b) => {
    const rank = (name: string | undefined): number => {
      if (questionTargetName && name === questionTargetName) return 0;
      if (editingTargetName && name === editingTargetName) return 1;
      return 2;
    };
    return rank(a.name) - rank(b.name);
  });

  const sprites: AiSpriteContext[] = [];
  for (const target of orderedTargets.slice(0, maxSprites)) {
    const name =
      sanitizeAiText(String(target.name ?? "Untitled")).text || "Untitled";
    const {blockCount, topOpcodes} = summarizeBlocks(target.blocks);
    const scriptsText = formatSpriteScripts(
      target.blocks,
      maxScriptsPerSprite,
      maxBlocksPerScript,
    );
    sprites.push({
      name,
      isStage: Boolean(target.isStage),
      blockCount,
      topOpcodes,
      scriptsText,
    });
  }

  const lines: string[] = [
    `作品名: ${sanitizeAiText(title).text}`,
    `スプライト数: ${targets.length}`,
  ];
  if (questionTargetName) {
    lines.push(`質問の対象: ${questionTargetName}`);
  } else {
    lines.push("質問の対象: 作品全体");
  }
  if (editingTargetName) {
    lines.push(`いま編集中のスプライト: ${editingTargetName}`);
  }

  for (const sprite of sprites) {
    const kind = sprite.isStage ? "ステージ" : "スプライト";
    const marks: string[] = [];
    if (questionTargetName && sprite.name === questionTargetName) {
      marks.push("★質問対象");
    }
    if (editingTargetName && sprite.name === editingTargetName) {
      marks.push("編集中");
    }
    const focus = marks.length > 0 ? ` ${marks.join(" / ")}` : "";
    lines.push(
      `- ${kind}「${sprite.name}」${focus} ブロック${sprite.blockCount}個`,
    );
    if (
      typeof orderedTargets.find(t => t.name === sprite.name)?.x === "number"
    ) {
      const target = orderedTargets.find(t => t.name === sprite.name);
      if (target && !target.isStage) {
        lines.push(
          `  位置: x=${target.x}, y=${target.y}, 向き=${target.direction ?? "?"}, 表示=${target.visible !== false}`,
        );
      }
    }
    const gaps = findLikelyMotionGaps(sprite.scriptsText);
    if (gaps.length > 0 && !sprite.isStage) {
      lines.push(`  自動チェック: ${gaps.join(" / ")}`);
    }
    lines.push("  【スクリプト】");
    lines.push(sprite.scriptsText);
  }
  if (targets.length > maxSprites) {
    lines.push(`…他 ${targets.length - maxSprites} スプライトは省略`);
  }

  return {
    title: sanitizeAiText(title).text,
    spriteCount: targets.length,
    sprites,
    editingTargetName,
    questionTargetName,
    summaryText: truncateForTokens(lines.join("\n"), maxSummaryChars),
  };
}
