/**
 * Japanese staged hint catalog (presentation only — facts live in findings).
 */

import type {StagedHint} from "./presenter.js";

export const GENERIC_DEBUG_HINT_ID = "hint.generic-debug";

export const GENERIC_DEBUG_ACTIONS = [
  "緑の旗から、どのスクリプトが動くか順に確かめる",
  "動かしたいスプライトを選んで、帽子ブロックの下につながっているか見る",
  "メッセージや変数の名前が送り側と受け側で同じか確かめる",
] as const;

const CATALOG: Record<string, StagedHint> = {
  "hint.schema.integrity": {
    hintId: "hint.schema.integrity",
    stages: [
      "作品のつながりのデータが壊れている可能性があります。",
      "ブロックの接続や名前の参照を見直して、もう一度保存してみましょう。",
      "直らないときは、問題のスクリプトを作り直すと安全です。",
    ],
    genericDebugActions: [...GENERIC_DEBUG_ACTIONS],
  },
  "hint.empty-c-block": {
    hintId: "hint.empty-c-block",
    stages: [
      "くり返しや条件の「なか」が空かもしれません。",
      "動かしたいブロックを、そのなかに入れてみましょう。",
    ],
    genericDebugActions: [...GENERIC_DEBUG_ACTIONS],
  },
  "hint.broadcast.send-without-receive": {
    hintId: "hint.broadcast.send-without-receive",
    stages: [
      "メッセージを送っていますが、受け取る帽子が見つかりません。",
      "同じメッセージ名の「メッセージを受け取ったとき」があるか確かめましょう。",
    ],
    genericDebugActions: [...GENERIC_DEBUG_ACTIONS],
  },
  "hint.broadcast.receive-without-send": {
    hintId: "hint.broadcast.receive-without-send",
    stages: [
      "メッセージを待つ帽子がありますが、送るブロックが見つかりません。",
      "どこかで同じメッセージを送っているか見てみましょう。",
    ],
    genericDebugActions: [...GENERIC_DEBUG_ACTIONS],
  },
  "hint.empty-event-script": {
    hintId: "hint.empty-event-script",
    stages: [
      "イベントの帽子の下にブロックがありません。",
      "動かしたいブロックを帽子の下につなげてみましょう。",
    ],
    genericDebugActions: [...GENERIC_DEBUG_ACTIONS],
  },
  [GENERIC_DEBUG_HINT_ID]: {
    hintId: GENERIC_DEBUG_HINT_ID,
    stages: [
      "いまのルールでははっきりした問題は見つかりませんでした。",
      "下の手順で、どこまで動くか少しずつ確かめてみましょう。",
    ],
    genericDebugActions: [...GENERIC_DEBUG_ACTIONS],
  },
};

export function lookupStagedHint(hintId: string): StagedHint | undefined {
  return CATALOG[hintId];
}
