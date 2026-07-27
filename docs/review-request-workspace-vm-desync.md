# レビュー依頼: Blockly / VM 不整合と、その「自動修復」の妥当性

Syncratch（Scratch ベースの教育用エディタ）で、**ワークスペースにブロックが無いのにスプライトが動く**という報告が出ました。これに対して 2 つの修正が `main` にマージ済みですが、**真因は未特定**で、うち 1 つは**ユーザーのコードを自動削除する**設計です。この妥当性と、真因の当たりをレビューしてほしいです。

- リポジトリ: `overdozer1124/syncratch`（`main`）
- 対象コミット範囲: `eef07a8..db9226c`（+567 行、6 ファイル）
- 本番: `https://syncratch-production.up.railway.app/`

---

## 1. ユーザー報告（一次情報）

1. 実行するとスプライトの動きが「めちゃくちゃ」になる
2. **コードに含まれていない「15度右回り」が実行されている印象**
3. `10歩動かす` なのにそれ以上動いている印象
4. 3秒の画面録画では、`旗が押されたとき` / `ずっと[10歩動かす]` / `もし端に着いたら跳ね返る` の **3 つが接続されずバラバラ**（本人いわく自分で外した）
5. じっこう履歴には `端で跳ね返った / 歩いた / ずっと繰り返した` が繰り返し記録されていた（＝**元の接続済みスクリプトが VM 上で動き続けている**）
6. **ブロックを全て取り除いて実行しても同じ挙動**

つまり **Blockly（画面）と VM（実行実体）が食い違っている**状態です。

### 動画から読み取った数値（30fps・3秒、全フレーム解析）

| 時刻 | x | y | 向き |
|---|---|---|---|
| 0.17s | -96 | 65 | -71 |
| 0.33s | -140 | -56 | -176 |
| 0.50s | -96 | 39 | 49 |
| 0.67s | **183** | 31 | 124 |
| 0.83s | -108 | -45 | -64 |
| 1.00s | -140 | 125 | 146 |
| 1.17s | -180 | -116 | -41 |
| 1.33s〜 | -173 | -63 | 26（停止ボタンで固定） |

座標も向きもステージ全域・360度にわたって飛んでいます。`10歩動かす` 単体ではこうなりません。

---

## 2. マージ済みの 2 つの修正

### PR #124 `88028be` — `retireOrphanThreads`

`apps/editor-web/src/execution-control.ts`

- ハット／スタック先頭ブロックが消えたスレッドを `runtime._stopThread` で停止し、`runtime.threads` から `splice` で即除去
- 呼び出し箇所: **`_step` ラッパー内で毎フレーム**（`execution-control.ts:310`）、`PROJECT_START`（:286）、`PROJECT_CHANGED`（:301）

**背景として主張されている根拠**: scratch-vm の `deleteBlock` は実行中スレッドを停止しない（upstream の既知の欠落）。この主張自体は妥当だと考えています。

### PR #126 `d73c71c` — `reconcileEmptyWorkspaceWithVm`

`apps/editor-web/src/workspace-run-guard.ts`（新規）+ `main.ts`

```ts
const visible = workspaceTopScriptCount(workspace);   // Blockly の top-level ブロック数
if (visible === null) return null;
if (visible > 0) return {stopped: false, clearedVmScripts: false};
// visible === 0 のとき:
runtime.stopForTarget(editingTarget);                 // 停止
editingTarget.blocks.deleteAllBlocks();               // ← ユーザーの VM 側スクリプトを削除
```

呼び出し: **`window.setInterval(..., 500)`**（`main.ts:2307`）と `PROJECT_START`（:2299）。

既存のガード:
- `if (suppressVmChanges || !diagnostic.ready) return;`（起動・作品ロード中）
- `workspace.isDragging()` 中はスキップ
- `getTopBlocks` が使えない場合は `null` を返して何もしない

---

## 3. こちらで実測したこと（すべて再現せず）

**すべて「新規作成した作品」での計測です。これが最大の穴だと認識しています。**

| 検証 | 方法 | 結果 |
|---|---|---|
| Blockly→VM の削除同期 | Blockly 経由でスクリプト作成 → `dispose()` で全削除 | `vmBlocks 5→0` / `threads 0` / スプライト停止。**正常** |
| スレッド蓄積 | 緑の旗を 5 連打、および一時停止＋5 連打 | 常に `threads: 1`。**蓄積なし** |
| 実行 opcode | `_primitives` を全ラップして実行回数を計数（旗/ずっと/10歩/跳ね返る） | `control_forever` `motion_movesteps` `motion_ifonedgebounce` のみ。**`motion_turnright` は 0 回** |
| 実行速度の回帰 | 上記を `bc28cf8`（実行コントロール導入前）と比較 | 1秒/2秒で 29/60 対 30/61。**差は 1 フレーム** |
| `rotationStyle` | 既定値 | `"all around"`。`ifonedgebounce` が向きを 90⇄-90 に反転させ、猫が上下逆さまになる（本家 Scratch と同じ） |

### #126 のデータ消失リスク（実測）

`deleteAllBlocks()` が誤爆しないか確認しました。

| シナリオ | Sprite1 のブロック数 |
|---|---|
| 作成直後 | 3 |
| コスチュームタブへ切替 → 2.5 秒滞在 → 戻る | **3（保持）** |
| スプライト追加・切替 | **3（保持）** |
| スプライトを 260ms 間隔で 8 回往復 | **3（保持）** |

いずれも消えませんでした。ユニット 414 tests green、typecheck clean。

---

## 4. レビューしてほしい論点

### 論点 A: #126 の設計は許容できるか（最重要）

懸念:

1. **判断根拠が UI の観測**（`getTopBlocks().length === 0`）で、**対処が取り消し不能な削除**
2. それを **500ms タイマーで永続的に回している**
3. コード内コメント自体が原因を掴めていないことを認めている — *"delete events dropped, partial sync, **etc.**"*
4. `scratchWorkspace()` は React fiber を辿って workspace を取得する。**古い／破棄済みの workspace インスタンス**を掴んだ場合、`getTopBlocks()` が誤って 0 を返し、`deleteAllBlocks()` が発火し得るのではないか
5. 上記 4 シナリオが通ったのは「ワークスペース再描画が 500ms より速かった」からで、**重い作品・低速端末・共同編集中の再同期**は未検証

こちらの見解では、症状（動き続ける）は `stopForTarget` だけで解消するので、**`deleteAllBlocks()` は不要**です。整合を取るなら VM を正として `emitWorkspaceUpdate()` で**再描画する**方が安全ではないでしょうか。

**問い**: この判断は妥当か。誤爆する具体的条件を他に挙げられるか。

### 論点 B: #124 は根本対処と呼べるか

`retireOrphanThreads` は「不整合を作らせない」ではなく「**毎フレーム検出して後始末する**」形です。

**問い**:
- 毎 `_step`（約30回/秒）での全スレッド走査＋`getScripts()` 呼び出しはコスト的に妥当か
- `runtime.threads` を `splice` で直接改変することの安全性（`sequencer.stepThreads` が配列参照をキャッシュしていないか）
- `control_stop`、クローン、カスタムブロック（procedures）、`stopForTarget` との相互作用で、**正常なスレッドを誤って retire する**ケースはないか
- upstream（scratch-vm の `deleteBlock`）を直す方が筋ではないか

### 論点 C: 真因は何か（未解決）

**Blockly と VM がなぜ食い違ったのかは、誰も特定していません。**

こちらの検証はすべて新規作品で、ユーザー環境は **IndexedDB からの復元・拡張機能の読み込み・共同編集（WebRTC + Yjs）** を経ています。食い違いはこの経路で生まれている可能性が高いと見ていますが、未検証です。

**問い**: 以下のどれが本命か、他に疑うべき経路はあるか。
- 作品復元（`load-project-preserving-editing-target.ts` / `guest-project-apply.ts`）で VM と Blockly の一方だけが更新される
- 共同編集の remote 適用（`apply-remote-update.ts` / `collaboration-domain/project-collab.ts`）が VM に入って Blockly に反映されない、またはその逆
- `blocks.jsx` の `onWorkspaceUpdate` が例外で中断し、`clearWorkspaceAndLoadFromXml` が途中で止まる
- Blockly の change listener が例外で中断し、以降の `vm.blockListener` に届かない

---

## 5. 提案している次の一手

1. **`deleteAllBlocks()` を外し、検出時は「停止＋記録」だけにする**（消失リスクを消しつつ、発生条件のデータを取る）
2. 記録された条件から再現する
3. 特定できたら本丸（同期経路 or VM）を直す

**この順序でよいか、あるいは先に潰すべき経路があるか**を判断してほしいです。

---

## 6. 見るべきファイル

**今回の変更**
- `apps/editor-web/src/workspace-run-guard.ts`（新規, 136行）— `reconcileEmptyWorkspaceWithVm`
- `apps/editor-web/src/execution-control.ts` — `retireOrphanThreads` / `threadScriptIsGone` / `guardGlowUpdates`
- `apps/editor-web/src/main.ts:2295-2360` — `enforceWorkspaceMatchesVm`, 500ms タイマー, `warnIfGreenFlagRunsOtherSprites`

**同期経路（真因の候補）**
- `apps/editor-web/src/load-project-preserving-editing-target.ts`
- `apps/editor-web/src/apply-remote-update.ts`
- `packages/collaboration-domain/src/project-collab.ts`
- `vendor/scratch-editor/packages/scratch-gui/src/containers/blocks.jsx` — `onWorkspaceUpdate`, `blockListener`
- `vendor/scratch-editor/packages/scratch-vm/src/engine/blocks.js` — `deleteBlock`, `blocklyListen`

**制約**: `vendor/scratch-editor` はピン留めサブモジュール（ADR-0001、gate0 が clean を検証）。修正は `apps/editor-web` 側を優先。

---

## 7. 再現手順

```bash
pnpm install --frozen-lockfile
git submodule update --init --depth 1 vendor/scratch-editor
pnpm gate0:build-vendor-vm
pnpm gate0:build-vendor-gui-spike
pnpm --filter @blocksync/editor-web prepare:assets
pnpm --filter @blocksync/editor-web test
pnpm --filter @blocksync/editor-web test:e2e -- e2e/execution-control.spec.ts
```

**注意**: `vendor/scratch-editor/packages/scratch-gui/scripts/prepare.mjs` は
`downloads.scratch.mit.edu` から micro:bit HEX を取得します。ネットワーク制限環境では
`static/microbit/*.hex` と `src/generated/microbit-hex-url.cjs` を手で用意して回避しました。

---

## 8. 欲しい成果物

1. **#126 を現状のまま残してよいか**（残す／停止のみに変更／revert）と、その理由
2. **#124 の安全性**（毎フレーム走査・`splice`・誤 retire の可能性）
3. **真因の当たり** — 論点 C の 4 候補の優先順位、または見落としている経路
4. 上記を確かめるための**最小の再現手順または計測方法**

なお「実行が止まる／履歴が別物になる」系の既知の問題は #116〜#123 で対応済みです（一時停止ゲートの順序、緑の旗での再開、実行ごとの履歴リセット、グロー例外で描画が飛ぶ問題）。今回の論点はそれらとは別です。
