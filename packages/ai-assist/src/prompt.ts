/**
 * Prompt construction for advice / debug coaching (not auto-coding).
 * Answers must be grounded in the project's actual script stacks,
 * written for elementary learners, and include a simple diagram.
 */

import {aiLevelPolicy, type AiAssistLevel} from "./levels.js";
import {sanitizeAiText, truncateForTokens} from "./sanitize.js";
import type {AiClarifyChoice} from "./clarify.js";
import type {AiProjectContext} from "./context.js";

export type AiAdviceMode = "explain" | "hint" | "debug";

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Prior turns in the same advice thread (not including the new question). */
export interface AiConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BuildAdvicePromptInput {
  level: AiAssistLevel;
  mode: AiAdviceMode;
  userQuestion: string;
  project?: AiProjectContext | null;
  /** Optional runtime / error notes already sanitized by caller. */
  observationNotes?: string;
  /** Choice the learner picked in the clarify step. */
  clarifiedIntent?: AiClarifyChoice | null;
  /** Earlier user/assistant turns in this thread. */
  conversationHistory?: AiConversationTurn[] | null;
}

const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_TURN_CHARS = 1200;

/** True when we already have a thread and should continue it. */
export function hasActiveConversation(
  history: AiConversationTurn[] | null | undefined,
): boolean {
  return Array.isArray(history) && history.length > 0;
}

/** Follow-up phrasing common from kids after trying advice. */
export function isFollowUpQuestion(question: string): boolean {
  return /うまくいか|だめ|ダメ|かわらない|変わらない|やってみた|ためした|試した|してみた|まだ|それでも|つぎ|次|どうすれば|なおら|直ら|できない|できなかった|へん|おかしい|もど|戻/.test(
    question,
  );
}

export function trimConversationHistory(
  history: AiConversationTurn[] | null | undefined,
): AiConversationTurn[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.slice(-MAX_HISTORY_TURNS).map(turn => ({
    role: turn.role,
    content: truncateForTokens(
      sanitizeAiText(turn.content).text,
      MAX_HISTORY_TURN_CHARS,
    ),
  }));
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
/** True when the learner wants bounce / smooth motion, not a teleport. */
export function wantsSmoothMotionAdvice(question: string): boolean {
  return /弾|はね|跳ね|とぶ|とんで|なめらか|スムーズ|スムース|カクカク|ガクガク|しゅんかん|瞬間|したまで|もど|自然な/.test(
    question,
  );
}

export function inferAdviceMode(question: string): AiAdviceMode {
  const q = question.trim();
  if (!q) return "hint";

  if (
    /動かない|動きません|動かなく|動かず|うごかない|うごきません|うごかなく|うごかず|動かなくて|うごかなくて|エラー|バグ|なおして|直して|うまくいか/.test(
      q,
    ) ||
    wantsSmoothMotionAdvice(q)
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

export function formatQuestionTargetLabel(
  questionTargetName: string | null | undefined,
): string {
  if (!questionTargetName) return "作品全体";
  return `「${questionTargetName}」`;
}

function questionTargetInstructions(
  project: AiProjectContext | null | undefined,
): string {
  const target = project?.questionTargetName ?? null;
  if (target) {
    return [
      `学習者が選んだ質問対象: ${formatQuestionTargetLabel(target)}`,
      `- いちばん最初の文で「${formatQuestionTargetLabel(target)} の はなしだよ。」のように対象を言うこと。`,
      "- まずその対象のスクリプトを根拠に答えること。",
      "- ほかのスプライトは、メッセージのときなど必要なときだけ見ること。",
    ].join("\n");
  }
  return [
    "学習者が選んだ質問対象: 作品全体",
    "- いちばん最初の文で「さくひんぜんたいの はなしだよ。」と言うこと。",
    "- どのスプライトの話かを、そのつどはっきり書くこと。",
  ].join("\n");
}

function kidWritingRules(level: AiAssistLevel): string {
  const base = [
    "【ことばのルール（とても大切）】",
    "- 対象は 小学校の子どもです。むずかしい漢字・中学生以上の言葉は使わないこと。",
    "- 短い文で書くこと。1文はだいたい40文字以内。",
    "- 漢字はできるだけひらがなにする（例: 動かす→うごかす、変化→かわる、確認→たしかめる、必要→いる、重力→したにひっぱる力）。",
    "- 「放物線」「座標変換」「カテゴリ」「ロジック」「実装」など抽象語は禁止。どうしても使うなら、その場でやさしく言い換えること。",
    "- Markdown の太字（**）や見出し（#）は使わないこと。",
    "- ですます調より、子どもに話しかけるやさしい口調（だよ／してみよう）で書くこと。",
    "- いちどに教えることは少なく。レベルが低いほど、次の一手だけに絞ること。",
  ];

  if (level <= 2) {
    base.push(
      "- ヒントは いちばん大事なこと 1つだけ。長い番号つきリストは禁止。",
      "- 「まずこれだけためそう」で終わること。",
    );
  } else if (level <= 4) {
    base.push("- ヒントは最大2つまで。それ以上は書かないこと。");
  }

  return base.join("\n");
}

function diagramRules(): string {
  return [
    "【ず（図）のルール】",
    "- 毎回、文字だけの説明で終わらないこと。かならず 1つ以上の【ず】を入れること。",
    "- 図は次のどちらか（または両方）:",
    "  1) ブロックのつながり図（上から下へ、矢印 ↓ でつなぐ）",
    "  2) 動きのイメージ図（うえ↑ / した↓ / みぎ→ / ひだり← を使ったかんたんな線）",
    "- 図の書き方は必ずこの形:",
    "【ず】みじかいタイトル",
    "（ここに ASCII の図。半角の線や矢印を使ってよい）",
    "【/ず】",
    "- 図の中の言葉も、むずかしい漢字を避け、ひらがな多めにすること。",
    "- 図の例（つながり）:",
    "【ず】いまの つながり",
    "キーがおされたとき",
    "   ↓",
    "ばしょへいく",
    "（とぶ・おちる はない）",
    "【/ず】",
    "- 図の例（うごき）:",
    "【ず】ボールの うごき",
    "    ↑ うえへ",
    "   ●",
    "    ↓ したへ",
    "【/ず】",
  ].join("\n");
}

function answerShape(mode: AiAdviceMode, level: AiAssistLevel): string {
  if (mode === "debug") {
    return [
      "【答え方】",
      "つぎのじゅんばんで、みじかく書くこと:",
      "1. だれの はなし？（質問対象）",
      "2. いま みえていること（1〜2文）",
      "3. 【ず】を 1つ以上",
      "4. つぎに ためすこと（1つだけ）",
    ].join("\n");
  }
  if (mode === "explain") {
    return [
      "【答え方】",
      "1. だれの はなし？",
      "2. かんたんな せつめい（2〜4文）",
      "3. 【ず】を 1つ以上",
    ].join("\n");
  }
  return [
    "【答え方】",
    "1. だれの はなし？",
    "2. いまの じょうきょう（1〜2文）",
    "3. 【ず】を 1つ以上",
    level <= 2
      ? "4. じぶんでためす いっぽ（1つだけ）"
      : "4. ヒント（最大2つ）と、じぶんでためす いっぽ（1つ）",
  ].join("\n");
}

function motionIntentRules(question: string): string {
  if (wantsSmoothMotionAdvice(question)) {
    return [
      "【うごきの意図（いちばん大切）】",
      "- 学習者はボールを「弾ませたい／なめらかに動かしたい」。しゅんかんいどうにはしたくない。",
      "- 大きな数（例: -50 や -100）を1回で変えると、弾むのではなく一瞬でとんだように見える。",
      "- 絶対に「もっと大きな数にする」アドバイスをしないこと。それは悪化する。",
      "- 自動チェックに「しゅんかんいどう」「大きないっぺん移動」とあったら、それを原因として先に認めること。",
      "- 次の一手は「数値を小さくする」（例: -50 を -5 や -3 にする）を最優先すること。",
      "- したまで行って戻したいときは、図で「小さい↓を何度も → 小さい↑を何度も」を示すこと。",
      "- 「まつ」を増やす・大きくするだけの案は避けること。まずは移動量を小さくする。",
    ].join("\n");
  }
  return [
    "【うごきの意図】",
    "- 質問が弾む／なめらか系なら、大きな1回移動ではなく小さい数のくりかえしを勧めること。",
    "- 「数値を大きくする」は、しゅんかんいどうを悪化させやすいので安易に勧めないこと。",
  ].join("\n");
}

function clarifiedIntentRules(
  clarified: AiClarifyChoice | null | undefined,
): string {
  if (!clarified) {
    return [
      "【学習者の意図確認】",
      "- まだボタン選択がない場合は、質問文から意図を慎重に読むこと。",
      "- あいまいなら、いちばんやさしいやりかた（くりかえし）から案内すること。",
    ].join("\n");
  }
  return [
    "【学習者が選んだ意図（最優先）】",
    `- 選択: ${clarified.label}`,
    `- 指導メモ: ${clarified.adviceHint}`,
    "- 回答の最初で、選んだ意図をやさしい言葉でもう一度確認すること。",
    "- この意図以外の高度なやり方へ勝手に飛ばないこと。",
    "- bounce_updown のときは、図で「-10を10回 → +10を10回 → ずっと」のワンセットを示すこと。",
    "- bounce_smooth のときは、大きな数を小さくする一手を最優先すること。",
    "- bounce_realistic のときは、いきなり完成式を出さず、変数で「はやさ」がかわる話を一小歩だけ。",
  ].join("\n");
}

function conversationRules(hasHistory: boolean): string {
  if (!hasHistory) {
    return [
      "【やりとり】",
      "- これは新しいはなしのいちばん最初のターンです。",
    ].join("\n");
  }
  return [
    "【やりとり（つづき）】",
    "- これまでのユーザーとアシスタントの会話を必ず踏まえること。",
    "- 最初から説明しなおさないこと。続きとして答えること。",
    "- 「やってみたけどうまくいかない」などとあったら、前の案が足りなかったとみなし、同じ案のくりかえしは禁止。",
    "- いまの【作品の要約】は最新版。前のターンよりスクリプトが変わっているかもしれないので、最新を優先すること。",
    "- 次の一小歩だけ示すこと。",
  ].join("\n");
}

function modeInstructions(
  mode: AiAdviceMode,
  level: AiAssistLevel,
  project: AiProjectContext | null | undefined,
  question: string,
  clarifiedIntent?: AiClarifyChoice | null,
  hasHistory = false,
): string {
  const policy = aiLevelPolicy(level);
  const lines = [
    "あなたは Scratch 互換エディター「Syncratch」の、小学校むけ学習コーチです。",
    "完成プログラムを代わりに書くのではなく、子どもが自分で直せるように導いてください。",
    "学習者の質問の意図をよく読み、表面的な数値いじりでごまかさないこと。",
    `現在の利用レベル: ${policy.level}（${policy.label}）— ${policy.description}`,
    `依頼モード: ${MODE_LABEL[mode]}`,
    "",
    kidWritingRules(level),
    "",
    diagramRules(),
    "",
    answerShape(mode, level),
    "",
    conversationRules(hasHistory),
    "",
    clarifiedIntentRules(clarifiedIntent),
    "",
    motionIntentRules(question),
    "",
    "【質問対象の共有】",
    questionTargetInstructions(project),
    "",
    "【最重要】作品の実スクリプトを根拠に答えること",
    "- 一般的な Scratch の説明だけで終わらないこと。",
    "- 必ず【作品の要約】に書かれたスプライト名・スクリプトの流れ・自動チェックを参照すること。",
    "- 「└ なか:」の下に書かれているブロックは、その上の「ずっと／くりかえし／もし」の中身です。見落とさないこと。",
    "- 「（なかにブロックなし）」と書いてあるときだけ、中が空だと判断すること。書いていないのに空だと言わないこと。",
    "- 作品に存在しないブロックやスクリプトを、ある前提で話さないこと。",
    "- 根拠が見つからないときは「このさくひんには ○○ が みつからないよ」とやさしく言うこと。",
    "- 「★質問対象」をいちばん優先し、なければ「編集中」を優先すること。",
  ];

  if (!policy.allowCompleteScripts) {
    lines.push(
      "完成したスクリプト全体や、そのままコピーできる長いブロック列は出さないでください。",
    );
  }
  if (policy.allowBlockCandidates && !policy.allowPartialGeneration) {
    lines.push(
      "必要なら Scratch のブロック名を出してよいですが、自動で置く前提の手順にはしないでください。ブロック名もやさしい言い方を添えること。",
    );
  }
  if (!policy.allowRuntimeAdvice && mode === "debug") {
    lines.push(
      "実行ログの断定ではなく、スクリプトに足りないもの・つながっていないものを優先して伝えること。",
    );
  }

  lines.push(
    "氏名・メール・出席番号などの個人情報には触れないでください。",
    "外部サービスや実機操作を勝手に勧める場合は、危険性を先に書いてください。",
  );
  return lines.join("\n");
}

function buildProjectUserParts(params: {
  question: string;
  questionHeading: string;
  targetLabel: string;
  project?: AiProjectContext | null;
  clarifiedIntent?: AiClarifyChoice | null;
  observationNotes?: string;
  isFollowUp: boolean;
}): string[] {
  const userParts: string[] = [
    `【質問の対象】\n${params.targetLabel}`,
    `${params.questionHeading}\n${params.question}`,
  ];

  if (params.clarifiedIntent) {
    userParts.push(
      [
        "【学習者が選んだ意図】",
        params.clarifiedIntent.label,
        params.clarifiedIntent.adviceHint,
      ].join("\n"),
    );
  }

  if (params.project?.summaryText) {
    userParts.push(
      [
        params.isFollowUp ? "【いまの作品の要約（最新）】" : "【作品の要約】",
        "（この内容だけを根拠にして答えてください。ここに無いものを想像で補わないでください。）",
        params.project.summaryText,
      ].join("\n"),
    );
  } else {
    userParts.push(
      "【作品の要約】\n(取得できませんでした。スクリプトが読めないため、一般論ではなく「作品を確認できない」と伝えてください。)",
    );
  }

  if (params.observationNotes?.trim()) {
    const notes = truncateForTokens(
      sanitizeAiText(params.observationNotes).text,
      800,
    );
    if (notes) {
      userParts.push(`【観察メモ】\n${notes}`);
    }
  }

  const closing = [
    `質問対象は ${params.targetLabel} です。`,
    "小学校の子ども向けに、ひらがな多め・みじかい文で答えてください。",
    "むずかしい漢字や「放物線」「重力」などのむずかしい言葉は使わないでください。",
    "かならず【ず】…【/ず】の図を1つ以上入れてください。",
    "文字だけの長い説明は禁止です。",
    "上記の作品スクリプトを根拠に答えてください。",
  ];
  if (
    wantsSmoothMotionAdvice(params.question) ||
    params.clarifiedIntent?.id.startsWith("bounce_")
  ) {
    closing.push(
      "学習者は弾む／なめらかな動きを欲しがっています。",
      "大きな数値への変更は禁止。選んだ意図に合う一小歩だけ示してください。",
    );
  }
  if (params.clarifiedIntent) {
    closing.push(
      `選んだ意図「${params.clarifiedIntent.label}」に合わせて答えてください。`,
    );
  }
  if (params.isFollowUp) {
    closing.push(
      "これはつづきのしつもんです。これまでのやりとりをふまえて答えてください。",
      "前と同じアドバイスのくりかえしは禁止です。うまくいかなかったなら別の一小歩を出してください。",
    );
  }

  userParts.push(closing.join("\n"));
  return userParts;
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

  const history = trimConversationHistory(input.conversationHistory);
  const isFollowUp = history.length > 0;
  const targetLabel = formatQuestionTargetLabel(
    input.project?.questionTargetName,
  );

  const messages: AiChatMessage[] = [
    {
      role: "system",
      content: modeInstructions(
        input.mode,
        input.level,
        input.project,
        question,
        input.clarifiedIntent,
        isFollowUp,
      ),
    },
  ];

  for (const turn of history) {
    messages.push({role: turn.role, content: turn.content});
  }

  messages.push({
    role: "user",
    content: buildProjectUserParts({
      question,
      questionHeading: isFollowUp ? "【つづきのしつもん】" : "【質問】",
      targetLabel,
      project: input.project,
      clarifiedIntent: input.clarifiedIntent,
      observationNotes: input.observationNotes,
      isFollowUp,
    }).join("\n\n"),
  });

  return messages;
}
