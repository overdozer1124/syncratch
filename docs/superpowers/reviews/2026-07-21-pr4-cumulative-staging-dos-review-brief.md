# 独立レビュー依頼: PR #4 — Cumulative staging DoS bounds

**Date:** 2026-07-21  
**PR:** https://github.com/overdozer1124/syncratch/pull/4  
**Branch:** `cursor/cumulative-staging-dos-f431`  
**Base:** `feat/local-first-pivot-impl`  
**性質:** 共同編集ゲスト bootstrap の staging DoS／状態機械硬化（セキュリティ＋正しさ）  
**共通ルール:** [`2026-07-21-open-draft-prs-review-dispatch.md`](./2026-07-21-open-draft-prs-review-dispatch.md)

## 背景

Stage 1 設計では staging Y.Doc に remote update を受け、検証成功後にだけ VM / IndexedDB へ反映する。  
既存は **1 update あたり 16 MiB** 制限があったが、**小さく大量の update を積む累積成長**を止められていなかった。  
加えて次が問題になり得た:

- `invalid-project` 後も update がカウンタ／mutation に影響する
- guest local-copy 保存中のレース
- retry が古い staging snapshot を再適用する

## 変更の要点（実装側の主張）

対象ファイル（5）:

- `packages/collaboration-domain/src/project-collab.ts`
- `packages/collaboration-domain/src/project-collab.test.ts`
- `apps/editor-web/src/collab-session.ts`
- `apps/editor-web/src/collab-session.test.ts`
- `apps/editor-web/src/p2p-bootstrap.acceptance.test.ts`

主張されている対策:

1. `!active` または `invalid-project` なら、カウンタ／progress／mutation の前に update を拒否
2. 累積 encoded staging state を上限管理（novel-byte upper bound + `Y.diffUpdate` + 対数コンパクション chunks + 境界付近で exact merge）
3. raw / semantic result cache（重複・delete-set 相当フレームの再計算回避）
4. `releaseStagingGuardResources()` を invalid / ready / leave で解放（以降 staging 拒否）
5. guest local-copy を直列化し、保存中に staging が進んだら再検証ループ
6. retry は古い snapshot を盲信せず、最新 staging を再検証
7. terminal `invalid-project` を in-flight save / retry から守る

PR 本文の Verification 主張（要再確認）:

- collaboration-domain / collab-webrtc / editor-web unit・typecheck・build
- Playwright E2E
- 実装者側の独立レビューで高・中優先度なし（**本依頼で再検証すること**）

## 必読資料

1. `docs/superpowers/specs/2026-07-20-p2p-bootstrap-optional-drive-design.md`
   - §3 Non-goals
   - §4 Staging / trust boundary
   - §7–8 bootstrap phases・hard limits・`invalid-project` が terminal
   - §13 acceptance tests（特に over-limit / invalid で VM・IndexedDB を変えない）
2. base...head diff 全体（上記 5 ファイル）
3. 既存の staging / bootstrap 経路（`tryApplyStagingUpdate`, `evaluateGuestBootstrap`, `enterInvalid`, retry / leave）

## 必ず検証してほしい問い

### A. 累積上限の正しさ

1. `maxStagingStateBytes`（既定 16 MiB）は「1 update」ではなく「累積 staging state」として仕様と矛盾しないか。仕様文言が「one decoded Yjs update」なのに実装が cumulative になった点を、強化として妥当か／契約変更として明記不足かを判定せよ。
2. novel-byte upper bound は **過大評価（保守的）** か。過小評価して limit をすり抜ける経路はないか。
3. `Y.diffUpdate` 後の duplicate（空 update `0,0`）扱いが正しいか。delete-set 相当で state は変わらないが wire 上は新しいフレーム、というケースで limit／cache が破綻しないか。
4. 対数コンパクション `appendStagingUpdateChunk` の merge で、exact merge 時の byteLength が実際の `encodeState()` と乖離し、false accept / false reject しないか。
5. 境界付近だけ exact merge する最適化で、非境界経路が不正に accept されないか。
6. 外部 origin の `update` リスナーが upper bound に `encodedUpdate.byteLength` を足す経路と、`STAGING_ORIGIN` 適用経路の二重計上／取りこぼしはないか。

### B. 端末状態・リソース

7. `releaseStagingGuardResources()` 後に staging update が必ず拒否されるか。ready 後の通常 collab update 経路を壊していないか（staging API と live apply の分離）。
8. invalid / ready / leave / 再入で listener リーク・二重 off・解放後のキャッシュ参照はないか。
9. `stagingGuardReleased` 中に apply 途中で release された場合の `{accepted: true}` 早期 return は安全か（呼び出し側が progress を進めないか）。

### C. セッション状態機械

10. `invalid-project` 後、receivedBytes / progress / stall / guest evaluate が動かないか。
11. leave 後や inactive 後にキュー済み update が残っても mutation しないか。
12. guest-initial 保存中に新しい seal/update が来たとき、同じ local copy を更新してから `ready` になるか。古い materialization で `ready` にならないか。
13. `local-save-failed` → retry が最新 staging を再検証するか。retry 中に invalid になったら terminal を保てるか。
14. host 側経路・reconnect・`stalled-project` を誤って壊していないか。
15. `provider.connect()` を `active = true` の後に移した順序変更の意図と安全性。

### D. セキュリティ／DoS

16. 小さな update 連打での CPU（sha256 cache key、mergeUpdates、diffUpdate）が新しい DoS になっていないか。キャッシュ上限 64/128 は十分か、キーが攻撃者制御でメモリを膨らませないか。
17. `@noble/hashes` 依存追加の妥当性（既存依存との整合、ブラウザバンドル）。
18. 悪意ある招待済み peer（仕様上 fully trusted editor に近い）前提でも、**未 ready ゲストのメモリ／CPU を無制限に消費できない**ことが目的。その目的を達しているか。仕様 non-goal「Malicious-editor isolation after invite secret shared」との境界を誤って主張していないか。

### E. テスト

19. PR 本文の TDD 項目が実際に失敗→成功で固定されているか。抜けやすいケース:
    - 累積超過ちょうど境界
    - duplicate / delete-set equivalent near limit
    - invalid 後の update
    - leave 後の queued update
    - guest apply 中の staging 進行
    - retry が新しい内容を使う
    - release の再入
20. acceptance suite（§13）を壊す変更がないか。`p2p-bootstrap.acceptance.test.ts` の差分の意味。

## 検証コマンド（可能なら実行）

```bash
git fetch origin cursor/cumulative-staging-dos-f431 feat/local-first-pivot-impl
git checkout cursor/cumulative-staging-dos-f431
# package.json のスクリプト名に合わせて同等コマンドを使う
pnpm --filter @blocksync/collaboration-domain test
pnpm --filter @blocksync/collab-webrtc test
pnpm --filter editor-web test
pnpm --filter editor-web typecheck
pnpm --filter editor-web test:e2e
```

## スコープ外

- UI 文言・日本語化（PR #3）
- Drive OAuth 実機
- 仕様 non-goals（writer handoff、公開シグナリング等）の新規実装提案
- Draft の Ready 化やマージ
