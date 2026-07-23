/**
 * Spec §29 AI utilization levels.
 * Prototype focuses on advice / stepwise hints; codegen remains gated.
 */

export type AiAssistLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AiLevelPolicy {
  level: AiAssistLevel;
  label: string;
  /** Short learner-facing description. */
  description: string;
  /** Whether the AI panel may be shown. */
  visible: boolean;
  /** Whether chat requests may be sent. */
  canChat: boolean;
  /** Whether complete scripts may appear in the reply. */
  allowCompleteScripts: boolean;
  /** Whether block candidate lists may appear (no auto-place). */
  allowBlockCandidates: boolean;
  /** Whether partial generation suggestions may appear (still no auto-apply). */
  allowPartialGeneration: boolean;
  /** Whether whole-program generation suggestions may appear. */
  allowFullGeneration: boolean;
  /** Whether runtime observation / fix suggestions may appear. */
  allowRuntimeAdvice: boolean;
}

const POLICIES: Record<AiAssistLevel, AiLevelPolicy> = {
  0: {
    level: 0,
    label: "オフ",
    description: "AI を表示せず使えません",
    visible: false,
    canChat: false,
    allowCompleteScripts: false,
    allowBlockCandidates: false,
    allowPartialGeneration: false,
    allowFullGeneration: false,
    allowRuntimeAdvice: false,
  },
  1: {
    level: 1,
    label: "説明のみ",
    description: "用語と、いまのプログラムの説明だけ",
    visible: true,
    canChat: true,
    allowCompleteScripts: false,
    allowBlockCandidates: false,
    allowPartialGeneration: false,
    allowFullGeneration: false,
    allowRuntimeAdvice: false,
  },
  2: {
    level: 2,
    label: "ヒント",
    description: "段階的なヒント。完成スクリプトは出さない",
    visible: true,
    canChat: true,
    allowCompleteScripts: false,
    allowBlockCandidates: false,
    allowPartialGeneration: false,
    allowFullGeneration: false,
    allowRuntimeAdvice: false,
  },
  3: {
    level: 3,
    label: "ブロック候補",
    description: "使えそうなブロックを候補として示す（自動配置しない）",
    visible: true,
    canChat: true,
    allowCompleteScripts: false,
    allowBlockCandidates: true,
    allowPartialGeneration: false,
    allowFullGeneration: false,
    allowRuntimeAdvice: false,
  },
  4: {
    level: 4,
    label: "部分提案",
    description: "選んだ範囲の部分的な案を示す（適用は人が決める）",
    visible: true,
    canChat: true,
    allowCompleteScripts: false,
    allowBlockCandidates: true,
    allowPartialGeneration: true,
    allowFullGeneration: false,
    allowRuntimeAdvice: false,
  },
  5: {
    level: 5,
    label: "全体提案",
    description: "標準ブロックでの全体案を示す（自動適用しない）",
    visible: true,
    canChat: true,
    allowCompleteScripts: true,
    allowBlockCandidates: true,
    allowPartialGeneration: true,
    allowFullGeneration: true,
    allowRuntimeAdvice: false,
  },
  6: {
    level: 6,
    label: "観察と修正提案",
    description: "実行の観察に基づく修正提案（自動適用は別ポリシー）",
    visible: true,
    canChat: true,
    allowCompleteScripts: true,
    allowBlockCandidates: true,
    allowPartialGeneration: true,
    allowFullGeneration: true,
    allowRuntimeAdvice: true,
  },
};

/** Default for prototype: hints without complete scripts. */
export const DEFAULT_AI_LEVEL: AiAssistLevel = 2;

export function clampAiLevel(value: unknown): AiAssistLevel {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) return DEFAULT_AI_LEVEL;
  return n as AiAssistLevel;
}

export function aiLevelPolicy(level: AiAssistLevel): AiLevelPolicy {
  return POLICIES[level];
}

export function allAiLevelPolicies(): AiLevelPolicy[] {
  return [0, 1, 2, 3, 4, 5, 6].map(level => POLICIES[level as AiAssistLevel]);
}

/**
 * Effective level when the feature master switch is off → always 0.
 */
export function effectiveAiLevel(
  enabled: boolean,
  configuredLevel: AiAssistLevel,
): AiAssistLevel {
  if (!enabled) return 0;
  return configuredLevel;
}
