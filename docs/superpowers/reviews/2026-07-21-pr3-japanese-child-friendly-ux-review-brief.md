# 独立レビュー依頼: PR #3 — 日本語・小学生向けエディター UI

**Date:** 2026-07-21  
**PR:** https://github.com/overdozer1124/syncratch/pull/3  
**Branch:** `cursor/japanese-child-friendly-ux-f431`  
**Base:** `feat/local-first-pivot-impl`  
**性質:** UX／コピー／レイアウト／アクセシビリティ（機能回帰にも注意）  
**共通ルール:** [`2026-07-21-open-draft-prs-review-dispatch.md`](./2026-07-21-open-draft-prs-review-dispatch.md)

## 背景

Local-first + Collab + Drive の認知負荷が高く、小学生向けに日本語（ひらがな寄り）と導線整理が必要。  
Stage 3 の「ローカル保存を主、Collab/Drive は副」は PR #2 で入済み。本 PR はその上に UI 再編と文言を載せる。

元の痛みの文脈:  
[`2026-07-20-codex-collab-drive-ux-review-brief.md`](./2026-07-20-codex-collab-drive-ux-review-brief.md)

## 変更の要点（実装側の主張）

主なファイル（17）:

- `apps/editor-web/index.html`
- `apps/editor-web/src/style.css`
- `apps/editor-web/src/main.ts`
- `apps/editor-web/src/ui-copy.ts` (+ test)
- `apps/editor-web/src/project-status.ts` (+ test)
- `apps/editor-web/src/project-title.ts` (+ test)
- `apps/editor-web/src/scratch-accessibility.ts` (+ test)
- `apps/editor-web/src/drive-conflict-status.ts` (+ test)
- `apps/editor-web/src/drive-integration.ts`
- `apps/editor-web/src/download-filename.ts` (+ test)
- `apps/editor-web/e2e/editor.spec.ts`

主張:

- Scratch GUI `locale: "ja-Hira"` + 残英語 a11y ラベルの日本語化
- ファイル／友だち／Google ドライブの 3 アコーディオン（同時に 1 つ）
- パネルはオーバーレイで Scratch 高さを奪わない
- 768px で横スクロール可能
- Drive 切断と Collab leave の分離（Disconnect Google で部屋を抜けない）
- Drive disconnect 時に古い conflict を clear
- WCAG AA 配色
- コピー成功／失敗など次の行動が分かるフィードバック

PR 本文の Verification 主張（要再確認）:

- editor-web unit / typecheck / build
- Playwright E2E（Create/Join、offline、recovery、narrow layout 等）
- GUI 手動確認 1280×800 / 900px / 768px
- デモ動画（招待 URL が検証環境では `127.0.0.1` になり得る点に注意）

## 必読資料

1. `docs/superpowers/specs/2026-07-20-p2p-bootstrap-optional-drive-design.md`  
   （Creator-only Drive、Join に Drive 不要、Leader/Follower 文言削除の意図）
2. `docs/superpowers/specs/2026-07-19-blocksync-local-first-pivot-design.md`  
   （local-first の一次保存）
3. `docs/superpowers/reviews/2026-07-20-codex-collab-drive-ux-review-brief.md`
4. PR diff 全体と、可能なら PR 本文のデモ動画

## 必ず検証してほしい問い

### A. 意味・契約の回帰（最重要）

1. Google 切断で `leaveRoom()` しなくなったことと、Drive conflict clear の条件（`driveConflictAction`）は正しいか。conflict 中に disconnect → 再接続で競合を見失わないか。
2. エラーメッセージを generic 日本語に置換した結果、診断に必要な情報（issue codes 等）が消えて運用不能になっていないか。`title` / diagnostics / feedback の役割分担は妥当か。
3. `friendlyCollaborationMessage` / `friendlyDriveMessage` の未マップ文字列が落ちたり、英語 raw が子供向け UI に漏れたりしないか。
4. bootstrap phase 文言が実状態と一致するか（`invalid-project`, `stalled-project`, `local-save-failed`, asset 進捗）。
5. 主ステータス（ローカル保存）と副ステータス（Drive/Collab）の ARIA live / `aria-hidden` が壊れ、スクリーンリーダーが噪音または無言になっていないか。

### B. UX（小学生）

6. 第1画面で「作品を作る／保存される／友だちとつなぐ」が分かるか。パネルを開かないと必須操作が隠れていないか。
7. コピー成功／失敗フィードバックは見つかるか。招待 URL が `127.0.0.1` になる検証環境と本番オリジンの説明が誤解を生まないか（レビューコメント用）。
8. ひらがな寄りと漢字のバランス、誤誘導する語（「保存しました」が Local なのに Drive と誤読されないか）を点検。
9. Scratch `ja-Hira` と自前ラベルの不一致・英語残存。

### C. レイアウト／a11y

10. オーバーレイが Scratch 操作（ブロックドラッグ、スプライト、モーダル）を永久に塞がないか。outside click / accordion 切替で復帰できるか。
11. 768px / 狭い高さで横スクロールとパネルが共存し、主要 CTA が到達可能か。
12. コントラスト（WCAG AA）と focus 可視性。`details/summary` キーボード操作。
13. `installScratchAccessibility` の Mutation/探索がパフォーマンスやラベル誤上書きを起こさないか。

### D. テスト

14. E2E が日本語セレクタ依存で脆くないか。役割・testid を優先しているか。
15. Create/Join・offline・recovery・narrow layout の回帰がカバーされているか。
16. unit がコピー変更のスナップショット張り替えだけになっていないか。行動変更（disconnect ≠ leave、conflict clear）にテストがあるか。

## 検証コマンド（可能なら実行）

```bash
git fetch origin cursor/japanese-child-friendly-ux-f431
git checkout cursor/japanese-child-friendly-ux-f431
# package.json のスクリプト名に合わせて同等コマンドを使う
pnpm --filter editor-web test
pnpm --filter editor-web typecheck
pnpm --filter editor-web test:e2e
```

可能なら 1280 / 900 / 768 幅の手動確認。動画がある場合は内容と実装の一致も確認。

## スコープ外

- staging DoS（PR #4）の再設計
- 新しい Drive 権限モデル
- 英語 UI の併存 i18n フレームワーク導入
- マージ操作
