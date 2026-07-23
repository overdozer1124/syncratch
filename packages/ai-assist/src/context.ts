/**
 * Compact Scratch project context for AI advice.
 * Omits costumes, sounds, assets, comments with PII risk, and peer metadata.
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
}

export interface AiProjectContext {
  title: string;
  spriteCount: number;
  sprites: AiSpriteContext[];
  /** Compact plain-text dump for the prompt. */
  summaryText: string;
}

export interface ScratchProjectJsonLike {
  targets?: Array<{
    name?: string;
    isStage?: boolean;
    blocks?: Record<
      string,
      {
        opcode?: string;
        shadow?: boolean;
      }
    >;
  }>;
}

const MAX_SPRITES = 8;
const MAX_OPCODES_PER_SPRITE = 12;
const MAX_SUMMARY_CHARS = 3500;

function summarizeBlocks(
  blocks: Record<string, {opcode?: string; shadow?: boolean}> | undefined,
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
    .slice(0, MAX_OPCODES_PER_SPRITE)
    .map(([opcode, count]) => ({opcode, count}));

  return {blockCount, topOpcodes};
}

export function buildAiProjectContext(
  projectJson: ScratchProjectJsonLike | null | undefined,
  title = "作品",
): AiProjectContext {
  const targets = Array.isArray(projectJson?.targets)
    ? projectJson.targets
    : [];
  const sprites: AiSpriteContext[] = [];

  for (const target of targets.slice(0, MAX_SPRITES)) {
    const name =
      sanitizeAiText(String(target.name ?? "Untitled")).text || "Untitled";
    const {blockCount, topOpcodes} = summarizeBlocks(target.blocks);
    sprites.push({
      name,
      isStage: Boolean(target.isStage),
      blockCount,
      topOpcodes,
    });
  }

  const lines: string[] = [
    `作品名: ${sanitizeAiText(title).text}`,
    `スプライト数: ${targets.length}`,
  ];
  for (const sprite of sprites) {
    const kind = sprite.isStage ? "ステージ" : "スプライト";
    const opcodes =
      sprite.topOpcodes.length === 0
        ? "(ブロックなし)"
        : sprite.topOpcodes
            .map(entry => `${entry.opcode}×${entry.count}`)
            .join(", ");
    lines.push(
      `- ${kind}「${sprite.name}」ブロック${sprite.blockCount}個: ${opcodes}`,
    );
  }
  if (targets.length > MAX_SPRITES) {
    lines.push(`…他 ${targets.length - MAX_SPRITES} スプライトは省略`);
  }

  return {
    title: sanitizeAiText(title).text,
    spriteCount: targets.length,
    sprites,
    summaryText: truncateForTokens(lines.join("\n"), MAX_SUMMARY_CHARS),
  };
}
