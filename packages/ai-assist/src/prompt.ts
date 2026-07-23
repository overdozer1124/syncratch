/**
 * Prompt construction for advice / debug coaching (not auto-coding).
 */

import {aiLevelPolicy, type AiAssistLevel} from "./levels.js";
import {sanitizeAiText, truncateForTokens} from "./sanitize.js";
import type {AiProjectContext} from "./context.js";

export type AiAdviceMode = "explain" | "hint" | "debug";

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BuildAdvicePromptInput {
  level: AiAssistLevel;
  mode: AiAdviceMode;
  userQuestion: string;
  project?: AiProjectContext | null;
  /** Optional runtime / error notes already sanitized by caller. */
  observationNotes?: string;
}

const MODE_LABEL: Record<AiAdviceMode, string> = {
  explain: "説明",
  hint: "ヒント",
  debug: "デバッグ助言",
};

function modeInstructions(mode: AiAdviceMode, level: AiAssistLevel): string {
  const policy = aiLevelPolicy(level);
  const lines = [
    "あなたは Scratch 互換エディター「Syncratch」の学習コーチです。",
    "完成品を代わりに書くのではなく、学習者が自分で直せるように助言してください。",
    "日本語で、初学者にも分かる短い文で答えてください。",
    `現在の利用レベル: ${policy.level}（${policy.label}）— ${policy.description}`,
    `依頼モード: ${MODE_LABEL[mode]}`,
  ];

  if (!policy.allowCompleteScripts) {
    lines.push(
      "完成したスクリプト全体や、そのままコピーできる長いブロック列は出さないでください。",
    );
  }
  if (level <= 2) {
    lines.push(
      "答えを一気に教えず、次に確認する手順や考える手がかりを段階的に示してください。",
    );
  }
  if (policy.allowBlockCandidates && !policy.allowPartialGeneration) {
    lines.push(
      "必要なら使えそうなブロック名（opcode や日本語カテゴリ）を候補として列挙してよいですが、自動配置前提の手順にはしないでください。",
    );
  }
  if (!policy.allowRuntimeAdvice && mode === "debug") {
    lines.push(
      "実行ログの断定的な解析ではなく、よくある原因の確認チェックリストを優先してください。",
    );
  }
  if (mode === "explain") {
    lines.push("用語と、いまの作品の仕組みの説明に集中してください。");
  }
  if (mode === "hint") {
    lines.push("ヒントは最大3つまでにし、最後に「自分で試す一歩」を1つ書いてください。");
  }
  if (mode === "debug") {
    lines.push(
      "再現手順 → 疑う場所 → 確認方法 → 直し方の方針、の順で短く書いてください。",
    );
  }

  lines.push(
    "氏名・メール・出席番号などの個人情報には触れないでください。",
    "外部サービスや実機操作を勝手に勧める場合は、危険性を先に書いてください。",
  );
  return lines.join("\n");
}

export function buildAdviceMessages(
  input: BuildAdvicePromptInput,
): AiChatMessage[] {
  const policy = aiLevelPolicy(input.level);
  if (!policy.canChat) {
    throw new Error("AI chat is disabled at this level");
  }

  const question = truncateForTokens(
    sanitizeAiText(input.userQuestion.trim()).text,
    1200,
  );
  if (!question) {
    throw new Error("question is empty");
  }

  const userParts: string[] = [
    `【質問】\n${question}`,
  ];

  if (input.project?.summaryText) {
    userParts.push(`【作品の要約】\n${input.project.summaryText}`);
  }

  if (input.observationNotes?.trim()) {
    const notes = truncateForTokens(
      sanitizeAiText(input.observationNotes).text,
      800,
    );
    if (notes) {
      userParts.push(`【観察メモ】\n${notes}`);
    }
  }

  return [
    {
      role: "system",
      content: modeInstructions(input.mode, input.level),
    },
    {
      role: "user",
      content: userParts.join("\n\n"),
    },
  ];
}
