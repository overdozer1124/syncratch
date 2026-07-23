/**
 * Prompt construction for advice / debug coaching (not auto-coding).
 * Answers must be grounded in the project's actual script stacks.
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

/**
 * Infer advice mode from the learner question.
 * "動かない" / error / fix requests prefer debug over generic hints.
 */
export function inferAdviceMode(question: string): AiAdviceMode {
  const q = question.trim();
  if (!q) return "hint";

  if (
    /動かない|動きません|動かなく|動かず|うごかない|うごきません|うごかなく|うごかず|動かなくて|うごかなくて|エラー|バグ|なおして|直して|うまくいか/.test(
      q,
    )
  ) {
    return "debug";
  }

  if (/どうやって|なぜ|なんで|とは|意味|説明|しくみ|仕組み/.test(q)) {
    return "explain";
  }

  return "hint";
}

/**
 * Prefer an explicit UI mode, but upgrade hint → debug when the question
 * clearly asks why something does not work.
 */
export function resolveAdviceMode(
  selectedMode: AiAdviceMode,
  question: string,
): AiAdviceMode {
  const inferred = inferAdviceMode(question);
  if (selectedMode === "hint" && inferred === "debug") {
    return "debug";
  }
  return selectedMode;
}

function modeInstructions(mode: AiAdviceMode, level: AiAssistLevel): string {
  const policy = aiLevelPolicy(level);
  const lines = [
    "あなたは Scratch 互換エディター「Syncratch」の学習コーチです。",
    "完成品を代わりに書くのではなく、学習者が自分で直せるように助言してください。",
    "日本語で、初学者にも分かる短い文で答えてください。",
    `現在の利用レベル: ${policy.level}（${policy.label}）— ${policy.description}`,
    `依頼モード: ${MODE_LABEL[mode]}`,
    "",
    "【最重要】作品の実スクリプトを根拠に答えること",
    "- 一般的な Scratch の説明だけで終わらないこと。",
    "- 必ず【作品の要約】に書かれたスプライト名・スクリプトの流れ・自動チェックを参照すること。",
    "- 作品に存在しないブロックやスクリプトを、ある前提で話さないこと。",
    "- 根拠が見つからないときは「この作品のスクリプトからは○○が見つかりません」と明示すること。",
    "- 「編集中」と付いたスプライトを優先して診断すること。",
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
      "実行ログの断定的な解析ではなく、作品スクリプト上の不足・誤接続・未起動を優先して指摘してください。",
    );
  }
  if (mode === "explain") {
    lines.push("用語と、いまの作品の仕組みの説明に集中してください。");
  }
  if (mode === "hint") {
    lines.push(
      "ヒントは最大3つまでにし、最後に「自分で試す一歩」を1つ書いてください。",
      "ヒントも作品の実スクリプトに触れること。一般論だけにしないこと。",
    );
  }
  if (mode === "debug") {
    lines.push(
      "回答は次の順で短く書いてください:",
      "1. いま見ていること（どのスプライトのどのスクリプトか）",
      "2. 想定される原因（作品根拠つきで1〜3個）",
      "3. 次に試すこと（1つだけ、具体的に）",
      "「動かない」系では、開始イベント不足・動かすブロック不足・接続切れ・非表示・別スプライト編集などを優先して確認してください。",
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

  const userParts: string[] = [`【質問】\n${question}`];

  if (input.project?.summaryText) {
    userParts.push(
      [
        "【作品の要約】",
        "（この内容だけを根拠にして答えてください。ここに無いものを想像で補わないでください。）",
        input.project.summaryText,
      ].join("\n"),
    );
  } else {
    userParts.push(
      "【作品の要約】\n(取得できませんでした。スクリプトが読めないため、一般論ではなく「作品を確認できない」と伝えてください。)",
    );
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

  userParts.push(
    "上記の作品スクリプトを根拠に答えてください。一般論だけで終わらないでください。",
  );

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
