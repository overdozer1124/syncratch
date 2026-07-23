/**
 * Intent clarification choices (Cursor-like multiple choice).
 * Preferred path: the model generates options from THIS question.
 * Static templates remain only as offline fallback.
 */

import {sanitizeAiText, truncateForTokens} from "./sanitize.js";
import type {AiChatMessage} from "./prompt.js";

export interface AiClarifyChoice {
  /** Stable id for coaching rules. */
  id: string;
  /** Kid-facing button label. */
  label: string;
  /** Extra coaching injected into the advice prompt. */
  adviceHint: string;
}

export interface AiClarifyPrompt {
  /** Kid-facing question above the buttons. */
  promptText: string;
  choices: AiClarifyChoice[];
  /** Show free-text "other" path. */
  allowOther: boolean;
  /** How the choices were produced. */
  family: "dynamic" | "bounce" | "broken" | "motion" | "generic" | "fallback";
}

export const AI_CLARIFY_OTHER_ID = "other";

const LETTERS = ["A", "B", "C"] as const;

export function isBounceLikeQuestion(question: string): boolean {
  return /弾|はね|跳ね|はず|とぶ|とんで|なめらか|スムーズ|スムース|カクカク|ガクガク|しゅんかん|瞬間|したまで|じめん|地面|一番下|いちばんした|もど|上下|うえした|行ったり|きたり|おち|落ち/.test(
    question,
  );
}

function isBrokenLikeQuestion(question: string): boolean {
  return /動かない|動きません|うごかない|うごきません|おかしい|へん|なおして|直して|バグ|エラー|うまくいか/.test(
    question,
  );
}

function isMotionLikeQuestion(question: string): boolean {
  return /動か|うごか|動く|うごく|すすむ|とば|移動|いどう/.test(question);
}

/**
 * Whether we should ask a clarifying choice before giving advice.
 * Short / ambiguous kid questions especially benefit.
 */
export function needsIntentClarification(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (isBounceLikeQuestion(q)) return true;
  if (isBrokenLikeQuestion(q)) return true;
  if (isMotionLikeQuestion(q) && q.length <= 40) return true;
  if (q.length <= 14) return true;
  return false;
}

function stripLetterPrefix(label: string): string {
  return label.replace(/^[A-D][:：．.]\s*/i, "").trim();
}

function withLetterPrefix(index: number, label: string): string {
  const letter = LETTERS[index] ?? "A";
  const body = stripLetterPrefix(label) || "この やりかた";
  return `${letter}: ${body}`;
}

function sanitizeChoice(
  raw: unknown,
  index: number,
  question: string,
): AiClarifyChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const labelRaw =
    typeof obj.label === "string"
      ? obj.label
      : typeof obj.text === "string"
        ? obj.text
        : "";
  const hintRaw =
    typeof obj.adviceHint === "string"
      ? obj.adviceHint
      : typeof obj.hint === "string"
        ? obj.hint
        : "";
  const idRaw = typeof obj.id === "string" ? obj.id : `choice_${index + 1}`;
  const label = truncateForTokens(sanitizeAiText(labelRaw).text, 80);
  if (!label) return null;
  const adviceHint = truncateForTokens(
    sanitizeAiText(
      hintRaw ||
        `学習者の質問「${question}」のうち、この解釈を最優先して一小歩だけ示す。`,
    ).text,
    280,
  );
  return {
    id: sanitizeAiText(idRaw).text.replace(/\s+/g, "_").slice(0, 40) ||
      `choice_${index + 1}`,
    label: withLetterPrefix(index, label),
    adviceHint,
  };
}

/** Messages that ask the model to invent question-specific choices. */
export function buildClarifyGenerationMessages(params: {
  question: string;
  projectSummary?: string | null;
}): AiChatMessage[] {
  const question = truncateForTokens(
    sanitizeAiText(params.question.trim()).text,
    800,
  );
  const summary = params.projectSummary
    ? truncateForTokens(sanitizeAiText(params.projectSummary).text, 2500)
    : "";

  return [
    {
      role: "system",
      content: [
        "あなたは Scratch 学習コーチです。",
        "小学生の質問の意図を、あらかじめ決めた定型ではなく、その質問の言葉に合わせて3つに分けてください。",
        "固定の「いったりきたり／なめらか／ほんとうに弾む」テンプレをそのまま出してはいけません。",
        "質問に「じめん」「した」「いちばん下」「ついたら」などがあれば、それを反映した選択肢にすること。",
        "出力は JSON だけ。前後に説明文を付けないこと。",
        "形式:",
        '{"promptText":"きみは どれが したい？","choices":[{"id":"c1","label":"短い文","adviceHint":"指導メモ"},{"id":"c2","label":"...","adviceHint":"..."},{"id":"c3","label":"...","adviceHint":"..."}]}',
        "label はひらがな多め、1行、40文字以内。A/B/C の接頭辞は付けない（こちらで付ける）。",
        "adviceHint は次の助言用の短いメモ（日本語）。完成コードは書かない。",
        "choices は必ず3つ。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `【学習者の質問】\n${question}`,
        summary
          ? `【作品の要約（参考）】\n${summary}`
          : "【作品の要約】\n(なし)",
        "この質問だけを根拠に、意図の分かれ方を3つ作って JSON で返してください。",
      ].join("\n\n"),
    },
  ];
}

function extractJsonObject(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // ignore
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim()) as unknown;
    } catch {
      // ignore
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/** Parse model JSON into a clarify prompt; returns null if unusable. */
export function parseClarifyResponse(
  raw: string,
  question: string,
): AiClarifyPrompt | null {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const choicesRaw = obj.choices;
  if (!Array.isArray(choicesRaw)) return null;

  const choices: AiClarifyChoice[] = [];
  for (const item of choicesRaw) {
    if (choices.length >= 3) break;
    const choice = sanitizeChoice(item, choices.length, question);
    if (choice) choices.push(choice);
  }
  if (choices.length < 2) return null;

  const promptText =
    truncateForTokens(
      sanitizeAiText(
        typeof obj.promptText === "string"
          ? obj.promptText
          : "きみは どれが したい？",
      ).text,
      60,
    ) || "きみは どれが したい？";

  return {
    family: "dynamic",
    promptText,
    allowOther: true,
    choices,
  };
}

function staticBounceClarify(): AiClarifyPrompt {
  return {
    family: "bounce",
    promptText: "きみは どれが したい？",
    allowOther: true,
    choices: [
      {
        id: "bounce_updown",
        label: "A: ボールを うえしたに いったりきたり させたい",
        adviceHint:
          "意図: うえしたに いったりきたり。-10を10回→+10を10回→ずっと。",
      },
      {
        id: "bounce_smooth",
        label: "B: ボールを なめらかに うえしたに うごかしたい",
        adviceHint: "意図: なめらか。大きな数を小さくする。",
      },
      {
        id: "bounce_realistic",
        label: "C: ボールが ほんとうに はずんでいる みたいに したい",
        adviceHint: "意図: ほんとにはずむ。変数ではやさがかわる一小歩。",
      },
    ],
  };
}

function staticBrokenClarify(): AiClarifyPrompt {
  return {
    family: "broken",
    promptText: "いま どんな こまりかた？",
    allowOther: true,
    choices: [
      {
        id: "broken_still",
        label: "A: ぜんぜん うごかない",
        adviceHint: "意図: まったく動かない。",
      },
      {
        id: "broken_wrong",
        label: "B: うごくけど おかしい",
        adviceHint: "意図: 動くが期待と違う。",
      },
      {
        id: "broken_timing",
        label: "C: うごきかたが へんだ（はやい／おそい／とぶ）",
        adviceHint: "意図: 速度や飛び方の違和感。",
      },
    ],
  };
}

function staticMotionClarify(): AiClarifyPrompt {
  return {
    family: "motion",
    promptText: "どんな うごきが したい？",
    allowOther: true,
    choices: [
      {
        id: "motion_start",
        label: "A: まずは すこしだけ うごかしたい",
        adviceHint: "意図: 最初の一歩。",
      },
      {
        id: "motion_repeat",
        label: "B: ずっと うごきつづけて ほしい",
        adviceHint: "意図: 動き続けたい。",
      },
      {
        id: "motion_path",
        label: "C: きめた ばしょまで いきたい",
        adviceHint: "意図: 決めた場所へ行く。",
      },
    ],
  };
}

function staticGenericClarify(): AiClarifyPrompt {
  return {
    family: "generic",
    promptText: "なにを しりたい？",
    allowOther: true,
    choices: [
      {
        id: "generic_why",
        label: "A: いまの プログラムの いみを しりたい",
        adviceHint: "意図: 説明。",
      },
      {
        id: "generic_fix",
        label: "B: うまくいかないのを なおしたい",
        adviceHint: "意図: デバッグ。",
      },
      {
        id: "generic_next",
        label: "C: つぎに なにを すればいいか しりたい",
        adviceHint: "意図: 次の一手。",
      },
    ],
  };
}

/** Offline/static clarify (legacy). Prefer AI generation in the editor. */
export function buildClarifyPrompt(question: string): AiClarifyPrompt | null {
  if (!needsIntentClarification(question)) return null;
  if (isBounceLikeQuestion(question)) return staticBounceClarify();
  if (isBrokenLikeQuestion(question)) return staticBrokenClarify();
  if (isMotionLikeQuestion(question)) return staticMotionClarify();
  return staticGenericClarify();
}

/**
 * Fallback when the model fails: put the learner's own words first,
 * then up to two static alternatives.
 */
export function buildFallbackClarifyPrompt(question: string): AiClarifyPrompt {
  const q = truncateForTokens(sanitizeAiText(question.trim()).text, 42);
  const staticPrompt = buildClarifyPrompt(question);
  const choices: AiClarifyChoice[] = [
    {
      id: "from_question",
      label: withLetterPrefix(0, q || "しつもんの とおりに したい"),
      adviceHint: `学習者の質問を最優先: ${question.trim()}。質問の言葉（じめん／した／はねる等）を根拠に一小歩だけ示す。`,
    },
  ];
  for (const choice of staticPrompt?.choices ?? []) {
    if (choices.length >= 3) break;
    choices.push({
      ...choice,
      label: withLetterPrefix(choices.length, choice.label),
    });
  }
  return {
    family: "fallback",
    promptText: staticPrompt?.promptText ?? "きみは どれが したい？",
    allowOther: true,
    choices,
  };
}

export function formatClarifiedIntentLabel(choice: AiClarifyChoice): string {
  return stripLetterPrefix(choice.label);
}

export function buildOtherClarifyChoice(otherText: string): AiClarifyChoice {
  const text = otherText.trim() || "そのほか";
  return {
    id: AI_CLARIFY_OTHER_ID,
    label: `D: ${text}`,
    adviceHint: `意図（学習者が書いた）: ${text}。この意図を最優先して、やさしく次の一手を示す。`,
  };
}
