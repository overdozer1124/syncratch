# Local-First pivot → mainline 最終受け入れレポート

| 項目 | 値 |
|---|---|
| 日時 | 2026-07-22 07:00:30 JST |
| 対象 tip | `48b94c499a496dbf6c15ecee63c57f6e8e256258` |
| 元ブランチ | `feat/local-first-pivot-impl` |
| 本流ブランチ | `main`（同一 tip で新設） |
| 受け入れ PR | https://github.com/overdozer1124/syncratch/pull/15（Draft） |
| 製品名 | Syncratch（シンクラッチ） |

## 結論

自動ゲートはすべて PASS。Community Local-First primary track（単独編集・SB3・任意 Drive・少人数 WebRTC 共同編集・local UI 保全）を本流候補として受け入れ可能。

手動 Google OAuth / Drive 実ユーザー試験は CI 資格情報では実行していない（`RELEASE_CHECKLIST.md` の Manual Google gates）。デプロイ前に実 Google プロジェクトで実施すること。

## 自動ゲート結果

| ゲート | 結果 |
|---|---|
| `pnpm gate0:test` | PASS |
| `pnpm gate0:collab` | PASS（2/2） |
| `@blocksync/editor-web` typecheck | PASS |
| `@blocksync/editor-web` test | PASS（190/190） |
| `@blocksync/editor-web` build（production） | PASS |
| production `dist/index.html` あり / `collab-harness.html` なし | PASS |
| `BLOCKSYNC_BASE_PATH=/` `verify:static` | PASS |
| Playwright `e2e/editor.spec.ts` + `collab.spec.ts` | PASS（16/16） |
| `@blocksync/google-drive-sync` test | PASS（25/25） |
| `@blocksync/classroom-apps-script` test | PASS（14/14） |
| `@blocksync/collaboration-domain` test | PASS（36/36） |
| `@blocksync/collab-webrtc` test | PASS（35/35） |
| `@blocksync/collab-signaling` test | PASS（17/17） |
| `@blocksync/collab-invite` test | PASS（13/13） |
| Frozen School: `pnpm r1:persist:test` | PASS |
| Frozen School: `pnpm r1:auth:test` | PASS |
| `git diff --check` | PASS |

## 含まれる主要マイルストーン（既に tip 上）

- PR #10: local-first 共同編集統合（bootstrap/reconnect、block 収束、asset 同期、選択維持、Syncratch 改名、ja 漢字）
- PR #13: regular remote apply 時の local-only UI（tab / per-target Blockly viewport）保全
- Frozen School/self-hosted track は buildable のまま Community 実行時必須依存にしない

## 既知の限界（リリース告知に含めない／含めないもの）

受け入れ対象外・非目標（設計どおり）:

- 同一スプライト同時ブロック編集は `blocksJson` LWW
- AI / 中央バックアップ / 大規模 room / 新規 school directory
- Drive の厳密分散ロック・atomic CAS 保証なし（best-effort leader）
- guest-initial / new / open で「前作品の UI」を復元しない（漏えい禁止）
- `currentCostume` 等の共有作品状態を peer 同期しない

## 本流化手順（ユーザー承認後）

1. 本レポートを含む PR を `main` へ merge する。
2. GitHub の default branch を `feat/local-first-pivot-impl` から `main` へ切り替える。
3. 残存 Draft PR（例: #5, #7）の base を `main` へ付け替えるか、不要なら close する。
4. 手動 Google gates（`RELEASE_CHECKLIST.md`）を実プロジェクトで実施してから公開デプロイする。

自動で default branch 変更・公開デプロイは行わない。
