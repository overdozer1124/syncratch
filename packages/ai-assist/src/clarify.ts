/**
 * Intent clarification choices (Cursor-like multiple choice)
 * so young learners can point to what they really want.
 */

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
  /** Template family used (for tests / analytics). */
  family: "bounce" | "broken" | "motion" | "generic";
}

export const AI_CLARIFY_OTHER_ID = "other";

function bounceClarify(): AiClarifyPrompt {
  return {
    family: "bounce",
    promptText: "きみは どれが したい？",
    allowOther: true,
    choices: [
      {
        id: "bounce_updown",
        label: "A: ボールを うえしたに いったりきたり させたい",
        adviceHint: [
          "意図: うえしたに いったりきたり（いちばんやさしいやりかた）。",
          "すすめ方: yを -10 ずつかえる を 10回くりかえす → yを 10 ずつかえる を 10回くりかえす → それを ずっと でかこむ。",
          "大きな数の1回移動は勧めない。まずはこのワンセットを図で示す。",
          "レベルが低いときは、先に「した方向のくりかえし」だけためさせてもよい。",
        ].join(" "),
      },
      {
        id: "bounce_smooth",
        label: "B: ボールを なめらかに うえしたに うごかしたい",
        adviceHint: [
          "意図: なめらかな うえした。",
          "大きな dy（例 -50）はしゅんかんいどうに見えると説明する。",
          "すすめ方: 数を小さく（-3〜-8）して、まつ を長くしすぎない。",
          "もっと大きな数にする案は禁止。",
        ].join(" "),
      },
      {
        id: "bounce_realistic",
        label: "C: ボールが ほんとうに はずんでいる みたいに したい",
        adviceHint: [
          "意図: ほんとうに はずむ 見え方。",
          "やさしい道: まず A のワンセット（くりかえし）ができてから。",
          "次の道: 変数で「はやさ」を持ち、したへいくとき少しずつ早く／うえへは遅く、など段階的に。",
          "むずかしい式の名前（二次関数など）は出さず、「はやさが 少しずつ かわる」と説明する。",
          "完成の長いスクリプトは出さない。次の一手だけ。",
        ].join(" "),
      },
    ],
  };
}

function brokenClarify(): AiClarifyPrompt {
  return {
    family: "broken",
    promptText: "いま どんな こまりかた？",
    allowOther: true,
    choices: [
      {
        id: "broken_still",
        label: "A: ぜんぜん うごかない",
        adviceHint:
          "意図: まったく動かない。開始イベント・接続・表示・別スプライトを優先して見る。",
      },
      {
        id: "broken_wrong",
        label: "B: うごくけど おかしい",
        adviceHint:
          "意図: 動くが期待と違う。いまのスクリプトと質問をつき合わせて、ずれを1つ示す。",
      },
      {
        id: "broken_timing",
        label: "C: うごきかたが へんだ（はやい／おそい／とぶ）",
        adviceHint:
          "意図: 速度や飛び方の違和感。大きな数値やしゅんかんいどうを疑い、小さくくりかえす案を優先。",
      },
    ],
  };
}

function motionClarify(): AiClarifyPrompt {
  return {
    family: "motion",
    promptText: "どんな うごきが したい？",
    allowOther: true,
    choices: [
      {
        id: "motion_start",
        label: "A: まずは すこしだけ うごかしたい",
        adviceHint:
          "意図: 最初の一歩。旗やキーの下に、小さな動きを1つ足す案に絞る。",
      },
      {
        id: "motion_repeat",
        label: "B: ずっと うごきつづけて ほしい",
        adviceHint:
          "意図: 動き続けたい。ずっと／くりかえし の中に小さい動きを入れる案。",
      },
      {
        id: "motion_path",
        label: "C: きめた ばしょまで いきたい",
        adviceHint:
          "意図: 決めた場所へ行く。x/yへ行くや、くりかえして近づく案。大きな瞬間移動を勧めすぎない。",
      },
    ],
  };
}

function genericClarify(): AiClarifyPrompt {
  return {
    family: "generic",
    promptText: "なにを しりたい？",
    allowOther: true,
    choices: [
      {
        id: "generic_why",
        label: "A: いまの プログラムの いみを しりたい",
        adviceHint: "意図: 説明。いまのスクリプトをやさしく読み解く。",
      },
      {
        id: "generic_fix",
        label: "B: うまくいかないのを なおしたい",
        adviceHint: "意図: デバッグ。足りないもの・つながりを1つ示す。",
      },
      {
        id: "generic_next",
        label: "C: つぎに なにを すればいいか しりたい",
        adviceHint: "意図: 次の一手。小さくためせる一歩だけ示す。",
      },
    ],
  };
}

export function isBounceLikeQuestion(question: string): boolean {
  return /弾|はね|跳ね|はず|とぶ|とんで|なめらか|スムーズ|スムース|カクカク|ガクガク|しゅんかん|瞬間|したまで|もど|上下|うえした|行ったり|きたり/.test(
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

export function buildClarifyPrompt(question: string): AiClarifyPrompt | null {
  if (!needsIntentClarification(question)) return null;
  if (isBounceLikeQuestion(question)) return bounceClarify();
  if (isBrokenLikeQuestion(question)) return brokenClarify();
  if (isMotionLikeQuestion(question)) return motionClarify();
  return genericClarify();
}

export function formatClarifiedIntentLabel(choice: AiClarifyChoice): string {
  return choice.label.replace(/^[A-D]:\s*/, "");
}

export function buildOtherClarifyChoice(otherText: string): AiClarifyChoice {
  const text = otherText.trim() || "そのほか";
  return {
    id: AI_CLARIFY_OTHER_ID,
    label: `D: ${text}`,
    adviceHint: `意図（学習者が書いた）: ${text}。この意図を最優先して、やさしく次の一手を示す。`,
  };
}
