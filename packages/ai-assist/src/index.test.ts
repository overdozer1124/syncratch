import {describe, expect, it} from "vitest";
import {
  detectProviderFromApiKey,
  preferCheapModel,
  resolveProviderAndModel,
} from "./providers.js";
import {
  aiLevelPolicy,
  clampAiLevel,
  effectiveAiLevel,
} from "./levels.js";
import {
  DEFAULT_AI_SETTINGS,
  loadAiAssistSettings,
  maskApiKey,
  normalizeAiAssistSettings,
  resolveAiAssistConfig,
  saveAiAssistSettings,
} from "./settings.js";
import {sanitizeAiText, truncateForTokens} from "./sanitize.js";
import {
  AI_QUESTION_TARGET_ALL,
  buildAiProjectContext,
  findMotionStyleHints,
  listAiQuestionTargets,
} from "./context.js";
import {
  escapeHtml,
  formatAiAnswerHtml,
  looksTruncatedAiAnswer,
  mergeAiAnswerContinuation,
  parseAiAnswerParts,
} from "./answer-format.js";
import {
  buildClarifyGenerationMessages,
  buildClarifyPrompt,
  buildFallbackClarifyPrompt,
  needsIntentClarification,
  parseClarifyResponse,
} from "./clarify.js";
import {
  buildAdviceMessages,
  buildContinuationUserPrompt,
  formatQuestionTargetLabel,
  hasActiveConversation,
  inferAdviceMode,
  isFollowUpQuestion,
  resolveAdviceMode,
  wantsSmoothMotionAdvice,
} from "./prompt.js";
import {AI_CHAT_ADVICE_MAX_TOKENS, AI_CHAT_HARD_MAX_TOKENS} from "./proxy-protocol.js";
import {
  createEmptyBlockIRProposal,
  requiresExplicitApproval,
} from "./ir.js";
import {
  extractBearerToken,
  forwardAiChat,
  parseAiChatProxyBody,
} from "./forward.js";

describe("detectProviderFromApiKey", () => {
  it("detects known prefixes", () => {
    expect(detectProviderFromApiKey("sk-ant-abc123").provider).toBe("anthropic");
    expect(detectProviderFromApiKey("sk-or-v1-xyz").provider).toBe("openrouter");
    expect(detectProviderFromApiKey("gsk_abc").provider).toBe("groq");
    expect(detectProviderFromApiKey("AIzaSyAbcd").provider).toBe("gemini");
    expect(detectProviderFromApiKey("AQ.AbCdEfGhIjKlMnOp").provider).toBe(
      "gemini",
    );
    expect(detectProviderFromApiKey("sk-proj-abc").provider).toBe("openai");
    expect(detectProviderFromApiKey("sk-abc123").provider).toBe("openai");
    expect(detectProviderFromApiKey("xai-abc").provider).toBe("xai");
  });

  it("normalizes quoted Bearer and whitespace pastes", () => {
    const quoted = detectProviderFromApiKey('"sk-proj-abc123"');
    expect(quoted.provider).toBe("openai");
    expect(quoted.normalizedKey).toBe("sk-proj-abc123");
    expect(detectProviderFromApiKey("Bearer sk-ant-xyz").provider).toBe(
      "anthropic",
    );
    expect(detectProviderFromApiKey("AIza\nSyAbcd").provider).toBe("gemini");
  });

  it("returns unknown for empty or unrecognized keys", () => {
    expect(detectProviderFromApiKey("").provider).toBe("unknown");
    expect(detectProviderFromApiKey("not-a-key").provider).toBe("unknown");
  });

  it("prefers cheap models per provider", () => {
    const openai = preferCheapModel("openai");
    expect(openai?.model).toBe("gpt-4o-mini");
    const resolved = resolveProviderAndModel("sk-ant-test");
    expect(resolved.detect.provider).toBe("anthropic");
    expect(resolved.model?.model).toContain("haiku");
    const forced = resolveProviderAndModel("opaque-key", "gemini");
    expect(forced.provider).toBe("gemini");
    expect(forced.model?.model).toBe("gemini-3.1-flash-lite");
  });
});

describe("levels", () => {
  it("clamps and gates chat", () => {
    expect(clampAiLevel(99)).toBe(2);
    expect(aiLevelPolicy(0).canChat).toBe(false);
    expect(aiLevelPolicy(2).allowCompleteScripts).toBe(false);
    expect(aiLevelPolicy(5).allowFullGeneration).toBe(true);
    expect(effectiveAiLevel(false, 5)).toBe(0);
    expect(effectiveAiLevel(true, 3)).toBe(3);
  });
});

describe("settings", () => {
  it("defaults to disabled", () => {
    expect(DEFAULT_AI_SETTINGS.enabled).toBe(false);
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, v);
      },
      removeItem: (k: string) => {
        memory.delete(k);
      },
    };
    expect(loadAiAssistSettings(storage).enabled).toBe(false);
    saveAiAssistSettings(storage, {
      enabled: true,
      apiKey: " sk-test ",
      level: 2,
      modelOverride: "",
    });
    const loaded = loadAiAssistSettings(storage);
    expect(loaded.enabled).toBe(true);
    expect(loaded.apiKey).toBe("sk-test");
  });

  it("resolves ready only when enabled with recognizable key", () => {
    const off = resolveAiAssistConfig(
      normalizeAiAssistSettings({enabled: false, apiKey: "sk-abc"}),
    );
    expect(off.ready).toBe(false);
    const on = resolveAiAssistConfig(
      normalizeAiAssistSettings({enabled: true, apiKey: "sk-abc", level: 2}),
    );
    expect(on.ready).toBe(true);
    expect(on.provider).toBe("openai");
    expect(on.model).toBe("gpt-4o-mini");
    expect(maskApiKey("sk-abcdefghijklmnop")).toContain("…");
  });

  it("allows manual provider override when key shape is unknown", () => {
    const forced = resolveAiAssistConfig(
      normalizeAiAssistSettings({
        enabled: true,
        apiKey: "opaque-custom-secret-key",
        level: 2,
        providerOverride: "openai",
      }),
    );
    expect(forced.ready).toBe(true);
    expect(forced.provider).toBe("openai");
    expect(forced.providerForced).toBe(true);
  });
});

describe("sanitize and context", () => {
  it("redacts email and api keys", () => {
    const result = sanitizeAiText(
      "連絡は a@b.co と sk-ant-secretkey123456 です",
    );
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain("a@b.co");
    expect(result.text).not.toContain("sk-ant-secretkey123456");
  });

  it("truncates long text", () => {
    expect(truncateForTokens("abcdef", 4)).toBe("abc…");
  });

  it("builds compact project context without assets", () => {
    const ctx = buildAiProjectContext(
      {
        targets: [
          {
            name: "Stage",
            isStage: true,
            blocks: {
              a: {opcode: "event_whenflagclicked"},
              b: {opcode: "motion_movesteps", shadow: true},
              c: {opcode: "control_forever"},
            },
          },
          {
            name: "Cat",
            isStage: false,
            blocks: {
              d: {opcode: "motion_movesteps"},
              e: {opcode: "motion_movesteps"},
            },
          },
        ],
      },
      "テスト作品",
    );
    expect(ctx.spriteCount).toBe(2);
    expect(ctx.sprites[0]?.topOpcodes.some(o => o.opcode === "control_forever"))
      .toBe(true);
    expect(ctx.summaryText).toContain("Cat");
    expect(ctx.summaryText).not.toContain("costume");
  });

  it("includes script stacks and prefers the editing target", () => {
    const ctx = buildAiProjectContext(
      {
        targets: [
          {
            name: "Stage",
            isStage: true,
            blocks: {
              s1: {
                opcode: "event_whenflagclicked",
                next: null,
                parent: null,
                topLevel: true,
              },
            },
          },
          {
            name: "Dog",
            isStage: false,
            x: 10,
            y: 20,
            direction: 90,
            visible: true,
            blocks: {
              d1: {
                opcode: "event_whenflagclicked",
                next: "d2",
                parent: null,
                topLevel: true,
              },
              d2: {
                opcode: "looks_say",
                next: null,
                parent: "d1",
                inputs: {MESSAGE: [1, [10, "わん"]]},
              },
            },
          },
          {
            name: "Cat",
            isStage: false,
            x: 0,
            y: 0,
            direction: 90,
            visible: true,
            blocks: {
              c1: {
                opcode: "motion_movesteps",
                next: null,
                parent: null,
                topLevel: true,
                inputs: {STEPS: [1, [4, "10"]]},
              },
            },
          },
        ],
      },
      {title: "動かない猫", editingTargetName: "Cat"},
    );
    expect(ctx.editingTargetName).toBe("Cat");
    expect(ctx.questionTargetName).toBeNull();
    expect(ctx.sprites[0]?.name).toBe("Cat");
    expect(ctx.summaryText).toContain("編集中");
    expect(ctx.summaryText).toContain("motion_movesteps");
    expect(ctx.summaryText).toContain("開始イベント");
    expect(ctx.summaryText).toContain("スクリプト1:");
  });

  it("reads blocks nested inside forever SUBSTACK", () => {
    const ctx = buildAiProjectContext(
      {
        targets: [
          {
            name: "Sprite1",
            isStage: false,
            blocks: {
              hat: {
                opcode: "event_whenkeypressed",
                next: "loop",
                parent: null,
                topLevel: true,
                fields: {KEY_OPTION: ["space", null]},
              },
              loop: {
                opcode: "control_forever",
                next: null,
                parent: "hat",
                inputs: {SUBSTACK: [2, "body"]},
              },
              body: {
                opcode: "motion_changeyby",
                next: null,
                parent: "loop",
                inputs: {DY: [1, [4, "-10"]]},
              },
            },
          },
        ],
      },
      {questionTargetName: "Sprite1"},
    );
    expect(ctx.summaryText).toContain("control_forever");
    expect(ctx.summaryText).toContain("なか");
    expect(ctx.summaryText).toContain("motion_changeyby");
    expect(ctx.summaryText).toContain("dy=-10");
    expect(ctx.summaryText).not.toContain("なかにブロックなし");
  });

  it("marks empty forever bodies explicitly", () => {
    const ctx = buildAiProjectContext({
      targets: [
        {
          name: "Sprite1",
          blocks: {
            hat: {
              opcode: "event_whenkeypressed",
              next: "loop",
              parent: null,
              topLevel: true,
            },
            loop: {
              opcode: "control_forever",
              next: null,
              parent: "hat",
              inputs: {SUBSTACK: [2, null]},
            },
          },
        },
      ],
    });
    expect(ctx.summaryText).toContain("なかにブロックなし");
  });

  it("marks the explicit question target ahead of editing", () => {
    const project = {
      targets: [
        {name: "Stage", isStage: true, blocks: {}},
        {
          name: "Dog",
          isStage: false,
          blocks: {
            d1: {opcode: "looks_say", topLevel: true, parent: null, next: null},
          },
        },
        {
          name: "Cat",
          isStage: false,
          blocks: {
            c1: {
              opcode: "motion_movesteps",
              topLevel: true,
              parent: null,
              next: null,
            },
          },
        },
      ],
    };
    const targets = listAiQuestionTargets(project);
    expect(targets[0]?.value).toBe(AI_QUESTION_TARGET_ALL);
    expect(targets.some(t => t.value === "Cat")).toBe(true);

    const ctx = buildAiProjectContext(project, {
      editingTargetName: "Cat",
      questionTargetName: "Dog",
    });
    expect(ctx.questionTargetName).toBe("Dog");
    expect(ctx.sprites[0]?.name).toBe("Dog");
    expect(ctx.summaryText).toContain("質問の対象: Dog");
    expect(ctx.summaryText).toContain("★質問対象");
  });
});

describe("prompt", () => {
  it("infers debug mode for movement failures", () => {
    expect(inferAdviceMode("キャラクターが動きません")).toBe("debug");
    expect(inferAdviceMode("エラーが出ます")).toBe("debug");
    expect(inferAdviceMode("どうやって動かすの？")).toBe("explain");
    expect(resolveAdviceMode("hint", "キャラクターが動きません")).toBe("debug");
    expect(resolveAdviceMode("explain", "キャラクターが動きません")).toBe(
      "explain",
    );
    expect(wantsSmoothMotionAdvice("ボールを弾ませたい")).toBe(true);
    expect(inferAdviceMode("ボールを弾ませたいがうまくいかない")).toBe("debug");
  });

  it("flags large one-shot moves as teleport-like", () => {
    const hints = findMotionStyleHints(
      [
        "control_forever（ずっと）",
        "motion_changeyby（y座標を〜ずつ変える） [dy=-50]",
        "control_wait（〜秒待つ）",
        "motion_changeyby（y座標を〜ずつ変える） [dy=10]",
      ].join("\n"),
    );
    expect(hints.some(hint => hint.includes("しゅんかんいどう"))).toBe(true);
    expect(hints.some(hint => hint.includes("小さくする"))).toBe(true);

    const ctx = buildAiProjectContext({
      targets: [
        {
          name: "Sprite1",
          blocks: {
            hat: {
              opcode: "event_whenkeypressed",
              next: "loop",
              parent: null,
              topLevel: true,
            },
            loop: {
              opcode: "control_forever",
              next: null,
              parent: "hat",
              inputs: {SUBSTACK: [2, "down"]},
            },
            down: {
              opcode: "motion_changeyby",
              next: "wait1",
              parent: "loop",
              inputs: {DY: [1, [4, "-50"]]},
            },
            wait1: {
              opcode: "control_wait",
              next: "up",
              parent: "loop",
              inputs: {DURATION: [1, [4, "0.1"]]},
            },
            up: {
              opcode: "motion_changeyby",
              next: null,
              parent: "loop",
              inputs: {DY: [1, [4, "10"]]},
            },
          },
        },
      ],
    });
    expect(ctx.summaryText).toContain("しゅんかんいどう");
  });

  it("forbids larger-number advice for bounce questions", () => {
    const messages = buildAdviceMessages({
      level: 2,
      mode: "hint",
      userQuestion:
        "ボールを弾ませたいのに、なめらかじゃなくて瞬間移動みたいに見える",
      project: buildAiProjectContext(
        {
          targets: [
            {
              name: "Sprite1",
              blocks: {
                a: {
                  opcode: "motion_changeyby",
                  topLevel: true,
                  parent: null,
                  next: null,
                  inputs: {DY: [1, [4, "-50"]]},
                },
              },
            },
          ],
        },
        {questionTargetName: "Sprite1"},
      ),
    });
    expect(messages[0]?.content).toContain("もっと大きな数にする");
    expect(messages[0]?.content).toContain("絶対に");
    expect(messages[1]?.content).toContain("大きな数値への変更は禁止");
    expect(messages[1]?.content).toContain("一小歩");
  });

  it("keeps prior turns when asking a follow-up", () => {
    expect(isFollowUpQuestion("やってみたけど、うまくいかなかった")).toBe(true);
    expect(hasActiveConversation([{role: "user", content: "a"}])).toBe(true);

    const messages = buildAdviceMessages({
      level: 2,
      mode: "debug",
      userQuestion: "やってみたけど、うまくいかなかった",
      conversationHistory: [
        {role: "user", content: "ボールを弾ませたい"},
        {
          role: "assistant",
          content: "まずは yを -5 にしてみよう。",
        },
      ],
      project: buildAiProjectContext({
        targets: [
          {
            name: "Sprite1",
            blocks: {
              a: {
                opcode: "motion_changeyby",
                topLevel: true,
                parent: null,
                next: null,
                inputs: {DY: [1, [4, "-5"]]},
              },
            },
          },
        ],
      }),
    });
    expect(messages.map(m => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[0]?.content).toContain("つづき");
    expect(messages[0]?.content).toContain("まえの案と どこが ちがうか");
    expect(messages[0]?.content).toContain("前の回答に出た数値・ブロック・図を、そのままもう一度出さないこと");
    expect(messages[1]?.content).toContain("ボールを弾ませたい");
    expect(messages[2]?.content).toContain("-5");
    expect(messages[3]?.content).toContain("つづきのしつもん");
    expect(messages[3]?.content).toContain("まえのこたえ");
    expect(messages[3]?.content).toContain("まずは yを -5 にしてみよう。");
    expect(messages[3]?.content).toContain("同じアドバイスのくりかえしは禁止");
  });

  it("does not re-inject the first-turn intent recipe on follow-up", () => {
    const clarify = buildClarifyPrompt("ボールを弾ませたい");
    const choice = clarify!.choices.find(c => c.id === "bounce_updown")!;
    const messages = buildAdviceMessages({
      level: 2,
      mode: "hint",
      userQuestion: "やってみたけど、うまくいかなかった",
      clarifiedIntent: choice,
      conversationHistory: [
        {
          role: "user",
          content: `ボールを弾ませたい\n（したいこと: ${choice.label}）`,
        },
        {
          role: "assistant",
          content:
            "【ず】した→うえ\n-10を10回 → +10を10回\n【/ず】\nまず -10 のくりかえしを入れてみよう。",
        },
      ],
      project: buildAiProjectContext({
        targets: [{name: "Sprite1", blocks: {}}],
      }),
    });
    expect(messages[0]?.content).toContain("すでに共有済み");
    expect(messages[0]?.content).not.toContain("指導メモ:");
    expect(messages[0]?.content).not.toContain("-10を10回 → +10を10回 → ずっと");
    expect(messages[3]?.content).toContain("レシピ再掲なし");
    expect(messages[3]?.content).toContain(choice.label);
    expect(messages[3]?.content).not.toContain(choice.adviceHint);
  });

  it("builds bounce clarify choices and injects selected intent", () => {
    expect(needsIntentClarification("ボールを弾ませたい")).toBe(true);
    const clarify = buildClarifyPrompt("ボールを弾ませたい");
    expect(clarify?.family).toBe("bounce");
    expect(clarify?.choices.some(c => c.id === "bounce_updown")).toBe(true);
    expect(clarify?.choices.some(c => c.id === "bounce_realistic")).toBe(true);

    const choice = clarify!.choices.find(c => c.id === "bounce_updown")!;
    const messages = buildAdviceMessages({
      level: 2,
      mode: "hint",
      userQuestion: "うまくうごかない",
      clarifiedIntent: choice,
      project: buildAiProjectContext({
        targets: [{name: "Sprite1", blocks: {}}],
      }),
    });
    expect(messages[0]?.content).toContain("学習者が選んだ意図");
    expect(messages[0]?.content).toContain("10回");
    expect(messages[1]?.content).toContain(choice.label);
  });

  it("parses dynamic clarify choices from the model JSON", () => {
    const question =
      "ボールがじめんについたらはずむようにしたいです。一番下まで行ってから上に上がるようにしたいです";
    const gen = buildClarifyGenerationMessages({
      question,
      projectSummary: "Sprite1 に motion_changeyby がある",
    });
    expect(gen[0]?.content).toContain("定型ではなく");
    expect(gen[1]?.content).toContain("じめん");

    const parsed = parseClarifyResponse(
      JSON.stringify({
        promptText: "どれが いちばん ちかい？",
        choices: [
          {
            id: "ground_bounce",
            label: "じめんに ついたら うえに もどしたい",
            adviceHint: "yが下端に来たら向きを反転する一小歩",
          },
          {
            id: "once_down_up",
            label: "したまで おちてから うえに あげたい",
            adviceHint: "下方向のくりかえしのあと上方向のくりかえし",
          },
          {
            id: "loop_bounce",
            label: "おちて はねる を ずっと くりかえしたい",
            adviceHint: "ずっとで下→上をくりかえす",
          },
        ],
      }),
      question,
    );
    expect(parsed?.family).toBe("dynamic");
    expect(parsed?.choices[0]?.label).toContain("じめん");
    expect(parsed?.choices[0]?.label.startsWith("A:")).toBe(true);

    const fallback = buildFallbackClarifyPrompt(question);
    expect(fallback.family).toBe("fallback");
    expect(fallback.choices[0]?.label).toContain("じめん");
  });

  it("builds advice messages that forbid complete scripts at level 2", () => {
    const messages = buildAdviceMessages({
      level: 2,
      mode: "debug",
      userQuestion: "スプライトが動きません",
      project: buildAiProjectContext(
        {
          targets: [
            {
              name: "Cat",
              blocks: {
                a: {
                  opcode: "motion_movesteps",
                  topLevel: true,
                  parent: null,
                  next: null,
                },
              },
            },
          ],
        },
        {questionTargetName: "Cat"},
      ),
    });
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("完成したスクリプト");
    expect(messages[0]?.content).toContain("実スクリプトを根拠");
    expect(messages[0]?.content).toContain("学習者が選んだ質問対象");
    expect(messages[0]?.content).toContain("小学校の子ども");
    expect(messages[0]?.content).toContain("【ず】");
    expect(messages[0]?.content).toContain("むずかしい漢字");
    expect(messages[1]?.content).toContain("スプライトが動きません");
    expect(messages[1]?.content).toContain("【質問の対象】");
    expect(messages[1]?.content).toContain(formatQuestionTargetLabel("Cat"));
    expect(messages[1]?.content).toContain("この内容だけを根拠");
    expect(messages[1]?.content).toContain("ひらがな多め");
    expect(messages[1]?.content).toContain("motion_movesteps");
  });

  it("formats diagram blocks into safe HTML", () => {
    const html = formatAiAnswerHtml(
      [
        "「Cat」の はなしだよ。",
        "",
        "【ず】いまの つながり",
        "キーがおされたとき",
        "   ↓",
        "ばしょへいく",
        "【/ず】",
        "",
        "つぎは これだけ ためそう。",
      ].join("\n"),
    );
    expect(html).toContain('class="ai-diagram"');
    expect(html).toContain("いまの つながり");
    expect(html).toContain("ばしょへいく");
    expect(html).toContain("はなしだよ");
    expect(html).not.toContain("<script>");
    expect(escapeHtml("<b>")).toBe("&lt;b&gt;");
    expect(parseAiAnswerParts("```zu\na\n```")).toHaveLength(1);
  });

  it("detects truncated answers and merges continuations", () => {
    expect(AI_CHAT_ADVICE_MAX_TOKENS).toBeLessThanOrEqual(AI_CHAT_HARD_MAX_TOKENS);
    const cut = [
      "「Sprite1」の はなしだよ。",
      "【ず】うごきの イメージ",
    ].join("\n");
    expect(looksTruncatedAiAnswer(cut)).toBe(true);
    const complete = [
      "【ず】うごきの イメージ",
      "  ↑",
      " ●",
      "  ↓",
      "【/ず】",
      "まずは はやさの 変数を 1つ つくってみよう。",
    ].join("\n");
    expect(looksTruncatedAiAnswer(complete)).toBe(false);
    const merged = mergeAiAnswerContinuation(cut, complete);
    expect(merged).toContain("【/ず】");
    expect(merged).toContain("変数");
    expect(buildContinuationUserPrompt()).toContain("途中で止まっています");
  });

  it("rejects empty questions and level 0", () => {
    expect(() =>
      buildAdviceMessages({level: 0, mode: "explain", userQuestion: "x"}),
    ).toThrow(/disabled/i);
    expect(() =>
      buildAdviceMessages({level: 1, mode: "explain", userQuestion: "  "}),
    ).toThrow(/empty/i);
  });
});

describe("ir", () => {
  it("requires approval for deletes", () => {
    const proposal = createEmptyBlockIRProposal({
      projectId: "p1",
      baseRevision: 1,
      targetId: "t1",
      intentSummary: "test",
    });
    expect(requiresExplicitApproval(proposal)).toBe(false);
    proposal.operations.push({
      type: "delete_block",
      payload: {blockId: "b1"},
    });
    expect(requiresExplicitApproval(proposal)).toBe(true);
  });
});

describe("forward helpers", () => {
  it("parses bearer and body", () => {
    expect(extractBearerToken("Bearer secret")).toBe("secret");
    expect(extractBearerToken("Basic x")).toBeNull();
    const parsed = parseAiChatProxyBody({
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{role: "user", content: "hello"}],
    });
    expect(parsed.ok).toBe(true);
  });

  it("forwards OpenAI-compatible chat via injected fetch", async () => {
    const result = await forwardAiChat({
      apiKey: "sk-test",
      request: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{role: "user", content: "hi"}],
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{message: {content: "こんにちは"}}],
            usage: {prompt_tokens: 3, completion_tokens: 2},
          }),
          {status: 200, headers: {"content-type": "application/json"}},
        ),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("こんにちは");
      expect(result.usage?.inputTokens).toBe(3);
    }
  });

  it("sends Gemini auth keys with x-goog-api-key header", async () => {
    let sawHeader = "";
    let sawUrl = "";
    const result = await forwardAiChat({
      apiKey: "AQ.example-auth-key",
      request: {
        provider: "gemini",
        model: "gemini-3.1-flash-lite",
        messages: [{role: "user", content: "hi"}],
      },
      fetchImpl: async (input, init) => {
        sawUrl = String(input);
        const headers = new Headers(init?.headers);
        sawHeader = headers.get("x-goog-api-key") ?? "";
        return new Response(
          JSON.stringify({
            candidates: [{content: {parts: [{text: "gemini-ok"}]}}],
          }),
          {status: 200, headers: {"content-type": "application/json"}},
        );
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe("gemini-ok");
    expect(sawHeader).toBe("AQ.example-auth-key");
    expect(sawUrl).not.toContain("?key=");
  });

  it("surfaces discontinued Gemini model errors clearly", async () => {
    const result = await forwardAiChat({
      apiKey: "AQ.example-auth-key",
      request: {
        provider: "gemini",
        model: "gemini-2.0-flash-lite",
        messages: [{role: "user", content: "hi"}],
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: "Resource exhausted. Please try again later.",
              status: "RESOURCE_EXHAUSTED",
            },
          }),
          {status: 429, headers: {"content-type": "application/json"}},
        ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("RATE_LIMITED");
      expect(result.message).toContain("RESOURCE_EXHAUSTED");
    }
  });
});
