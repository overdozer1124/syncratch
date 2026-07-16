# Cursor ↔ Codex 作業引き継ぎ

このファイルを、BlockSync AI 実装とレビューの唯一の引き継ぎ台帳として使用する。
ユーザーが回答をコピー＆ペーストする必要はない。Cursor と Codex は作業開始時に必ずこのファイルと Git の実状態を読み、作業終了時にこのファイルを更新する。

## 運用ルール

1. Cursor/Codex は作業前に、このファイル、`git status --short`、`git rev-parse HEAD` を確認する。
2. 実装担当は作業完了時に「現在の状態」を更新し、作業ログへ結果を追記する。
3. 実装担当が `READY_FOR_CODEX_REVIEW` にした後、ユーザーは Codex に「作業完了」とだけ伝えればよい。
4. Codex はこのファイルと実際の差分・テストを確認し、`GO` または `NO_GO` を記録する。
5. Codex が `CHANGES_REQUESTED` にした後、ユーザーは Cursor に「作業完了」とだけ伝えればよい。Cursor は本ファイルの指摘を読んで修正する。
6. チャット本文ではなく、Git・コード・テスト結果が最終的な証拠である。
7. 作業終了報告には、必ずJSTタイムスタンプと全体進捗率を含める。
8. 過去の作業ログは削除せず、末尾へ追記する。
9. 承認前のTaskへ先行着手しない。

## 進捗の計算方法

- 全体を Task 0〜11 の12 Taskとして計算する。
- Codex承認済みTaskのみ完了として数える。
- `全体進捗率 = 承認済みTask数 / 12 × 100`（整数へ四捨五入）。
- 現在は Task 0〜5 の6 Taskが承認済みなので **50%**。

## 現在の状態

| 項目 | 値 |
|---|---|
| 最終更新 | 2026-07-16 20:14:07 JST |
| 更新者 | Codex |
| ワークフロー状態 | `ACTION_REQUIRED_COMMIT` |
| 現在の担当 | Cursor |
| 現在のTask | Task 6 — project-service: live asset verify + atomic import |
| 全体進捗 | **50%**（Task 0〜5承認済み / 全12 Task） |
| 承認基準SHA | `d149631b2455af480ac6dbad7cad64d478e247cf` |
| Task 6差分 | 未コミット |
| 次Task | Task 7（Task 6のGoまで着手禁止） |

## Cursorが次に行う作業

Task 6の未コミット差分はコードレビューGo。次のメッセージでcommitする。

- commit message: `feat(project-service): live asset verify and atomic import`
- `docs/CURSOR_CODEX_HANDOFF.md`を含む現在のTask 6差分をcommitする。
- commit後に40文字SHA、`git status --short`、主要ゲート結果を当ファイルへ追記する。
- 状態を`READY_FOR_CODEX_REVIEW`、次担当をCodexへ変更する。
- Task 7はTask 6 commit SHAの最終確認まで着手しない。

## Task 6 再レビュー条件

- 上記P1をすべて修正する。✅
- `pnpm --filter @blocksync/project-service test` ✅
- `pnpm --filter @blocksync/project-service typecheck` ✅
- `pnpm r1:persist:test` ✅
- Task 0ゲートを変更していないことを確認する。✅
- `git diff --check` がPASSする。✅
- Cursorはコミット前レビューを希望する場合、未コミットのまま `READY_FOR_CODEX_REVIEW` にする。✅
- コミット済み再提出の場合は40文字のSHAを記載する。

## 作業完了時の更新テンプレート

実装担当は以下を埋めてから、状態を `READY_FOR_CODEX_REVIEW` に変更する。

```text
最終更新: YYYY-MM-DD HH:mm:ss JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task N
全体進捗: NN%
基準SHA: 40文字SHA
再提出SHA: 未コミット または 40文字SHA
変更ファイル:
- ...
対応内容:
- ...
テスト結果:
- command: PASS/FAIL
未解決事項:
- なし / ...
次の担当: Codex
```

## 作業ログ

### 2026-07-16 19:10:42 JST — Codex

- Cursor/Codex間の単一ファイル引き継ぎ運用を開始。
- Task 0〜5承認済み。全体進捗を50%と確定。
- Task 6は未コミットの修正作業中。
- Task 6レビューでP1を4件検出し、`CHANGES_REQUESTED` とした。
- 次担当: Cursor。

### 2026-07-16 19:22:04 JST — Codex

- Cursorへ、当ファイルが正式な引き継ぎ台帳であり「無関係な未追跡ファイル」ではないことを通知。
- Task 6未コミット差分を再レビュー。ACL順序とGC直列化の骨格は改善済み。
- 独立負例で、偽MP3、61秒WAV、実MD5不一致importがすべて受理されることを確認。
- save/restoreのcommit guardがDB `md5_hex` / `data_format` / `byte_length`を検査しないことを確認。
- project-service 35/35、project-store-sqlite 52/52、両typecheck、`r1:persist:test`はPASS。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。全体進捗50%。
- 次担当: Cursor。

### 2026-07-16 19:39:30 JST — Cursor

```text
最終更新: 2026-07-16 19:39:30 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 6
全体進捗: 50%
基準SHA: d149631b2455af480ac6dbad7cad64d478e247cf
再提出SHA: 未コミット
変更ファイル:
- packages/project-service/src/ports.ts
- packages/project-service/src/verify-live-assets.ts
- packages/project-service/src/verify-live-assets.test.ts
- packages/project-service/src/verify-audio-bytes.ts
- packages/project-service/src/verify-audio-bytes.test.ts
- packages/project-service/src/verify-import-assets.ts
- packages/project-service/src/verify-import-assets.test.ts
- packages/project-service/src/memory-assets.ts
- packages/project-service/src/service.ts
- packages/project-service/src/service.test.ts
- packages/project-service/src/test-wav-fixtures.ts
- packages/project-service/src/index.ts
- packages/project-store-sqlite/src/commit-asset-guard.ts
- packages/project-store-sqlite/src/commit-asset-guard.test.ts
対応内容:
- P1-1: CommitAssetExpectation を導入し、preflight 実バイト長 + ref metadata を同一 BEGIN IMMEDIATE TX 内で DB md5_hex/data_format/byte_length と完全一致検査（SQLite + memory guard）
- P1-2: WAV に sampleFrames/sampleRate <= 60 上限、MP3 に MPEG header 各フィールド・frame length・連続2 frame・偽 sync 負例拒否
- P1-3: import で MD5(CAS bytes) === ref.assetId === object.md5Hex を atomic repository 委譲前に検査
テスト結果:
- pnpm --filter @blocksync/project-service test: PASS (41/41)
- pnpm --filter @blocksync/project-service typecheck: PASS
- pnpm --filter @blocksync/project-store-sqlite test: PASS (56/56)
- pnpm --filter @blocksync/project-store-sqlite typecheck: PASS
- pnpm r1:persist:test: PASS
- git diff --check: PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 6 再レビュー指摘 P1×3 を未コミット差分上で修正。
- 判定待ち: `READY_FOR_CODEX_REVIEW`。全体進捗50%。
- 次担当: Codex。

### 2026-07-16 19:43:07 JST — Codex

- 引き継ぎ台帳と未コミット差分を再レビュー。
- 前回のDB metadata、61秒WAV、偽sync、実MD5不一致の指摘は修正済み。
- 独立負例で、有効なschema文書の同一SHA・異なるassetId refがexpectation生成で無視されることを確認。
- 独立負例で、MPEG-1 Layer IIの連続2 frameがMP3として受理されることを確認。
- project-service 41/41、project-store-sqlite 56/56、両typecheck、`r1:persist:test`、`git diff --check`はPASS。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。全体進捗50%。
- 次担当: Cursor。

### 2026-07-16 19:48:45 JST — Cursor

```text
最終更新: 2026-07-16 19:48:45 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 6
全体進捗: 50%
基準SHA: d149631b2455af480ac6dbad7cad64d478e247cf
再提出SHA: 未コミット
変更ファイル:
- packages/project-service/src/verify-live-assets.ts
- packages/project-service/src/verify-live-assets.test.ts
- packages/project-service/src/verify-audio-bytes.ts
- packages/project-service/src/verify-audio-bytes.test.ts
- packages/project-service/src/test-wav-fixtures.ts
対応内容:
- P1-1: collectCommitAssetExpectations で同一SHAの metadata 不一致を DUPLICATE_SHA_METADATA で拒否。一致時のみ dedupe
- P1-2: MP3 検証を MPEG Audio Layer III (layer === 0x01) に限定。Layer II 負例テスト追加
テスト結果:
- pnpm --filter @blocksync/project-service test: PASS (44/44)
- pnpm --filter @blocksync/project-service typecheck: PASS
- pnpm --filter @blocksync/project-store-sqlite test: PASS (56/56)
- pnpm r1:persist:test: PASS
- git diff --check: PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 6 第3ラウンド指摘 P1×2 を未コミット差分上で修正。
- 判定待ち: `READY_FOR_CODEX_REVIEW`。全体進捗50%。
- 次担当: Codex。

### 2026-07-16 20:05:38 JST — Codex

- Task 6第3ラウンド差分を再レビュー。
- 同一SHA・矛盾metadata refとMPEG Layer IIの独立負例が拒否されることを確認。
- MPEG-2 / MPEG-2.5 Layer IIIの独立正例が受理されることを確認。
- project-service 44/44、project-store-sqlite 56/56、両typecheck、`r1:persist:test`、`git diff --check`はPASS。
- blocking findingなし。未コミット差分をコードレビューGoとし、指定messageでのcommitを許可。
- commit SHA確認までは承認済みTask数を増やさず、全体進捗50%を維持。
- 状態: `APPROVED_TO_COMMIT`。次担当: Cursor。

### 2026-07-16 20:14:07 JST — Codex

- ユーザーの「作業完了」を受けてcommit状態を確認。
- HEADは`d149631b2455af480ac6dbad7cad64d478e247cf`のままで、Task 6差分と当台帳は未コミット。
- コードレビューは既にGo。追加修正は不要。
- Cursorは`feat(project-service): live asset verify and atomic import`で現在のTask 6差分と当台帳をcommitする。
- commit後、40文字SHA、clean状態、次担当Codexを当台帳へ追記し、`READY_FOR_CODEX_REVIEW`に変更する。
- 状態: `ACTION_REQUIRED_COMMIT`。全体進捗50%。次担当: Cursor。
