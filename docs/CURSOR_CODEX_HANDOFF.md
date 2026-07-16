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
- 現在は Task 0〜6 の7 Taskが承認済みなので **58%**。Task 7はコードレビューGoだが、commit SHA確認までは未承認として扱う。

## 現在の状態

| 項目 | 値 |
|---|---|
| 最終更新 | 2026-07-16 23:58:54 JST |
| 更新者 | Codex |
| ワークフロー状態 | `APPROVED_TO_COMMIT` |
| 現在の担当 | Cursor |
| 現在のTask | Task 7 — sb3-tools: canonical I/O, SVG explicit walk, equivalenceProduction |
| 全体進捗 | **58%**（Task 0〜6承認済み / 全12 Task） |
| 承認基準SHA | `8e59f5aec3609d7d90920cd1b943af236ff53fbe` |
| Task 6 commit SHA | `5b83f36b4e1b8b14d97e4e47140a86f9e845411a` |
| 次Task | Task 8（Task 7 commit SHAの正式承認まで着手禁止） |

## Cursorが次に行う作業

Task 7のコードレビューはGo。次を実行する。

1. Task 7の実装・テスト・仕様差分と本台帳を、`feat(sb3-tools): canonical I/O and production equivalence`としてcommitする。
2. `docs/ai-platform/design-brief-candidate.md`は設計ブリーフ候補であり、Task 7 commitから必ず除外する。
3. commit後に40文字SHA、`git status --short`、commit対象ファイルを本台帳へ追記し、`READY_FOR_CODEX_REVIEW`へ変更する。
4. Task 8にはまだ着手しない。

## Task 7 第8ラウンド Codex指摘（対応済み）

1. **P1 — ID3v2.4 tag size / footer 公式仕様** ✅
2. **P1 — procedure proccode placeholder と argument 整合** ✅

## Task 7 第8ラウンド再提出サマリー

```text
最終更新: 2026-07-16 23:52:30 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-schema/src/mp3-bytes.ts
- packages/project-schema/src/mp3-bytes.test.ts
- packages/project-schema/src/index.ts
- packages/project-schema/src/schema-gate.test.ts
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1: ID3v2.4 — tag size は header/footer 除外、footer は 10+tagSize 位置、version/flags/size 一致検査、synchsafe MSB=0、v2.4 以外 footer 拒否
- P1: procedure — countProcedurePlaceholders(%s/%b/%n)、argumentids↔placeholder/input 整合、重複 id 拒否
テスト結果:
- project-schema 66/66、typecheck PASS
- project-service 49/49、sb3-tools 41/41
- pnpm build / gate0:test / git diff --check: すべて PASS
未解決事項:
- なし
次の担当: Codex
```

再提出時の必須確認:

- `pnpm --filter @blocksync/project-schema test && typecheck`
- `pnpm --filter @blocksync/project-service test && typecheck`
- `pnpm --filter @blocksync/sb3-tools test && build`
- `pnpm --filter @blocksync/project-envelope test && build`
- `pnpm build`
- `pnpm sb3:opcodes:check`
- `pnpm gate0:test`
- V1 golden hash不変
- `git diff --check`
- `docs/ai-platform/design-brief-candidate.md`はTask 7 commit対象外のまま維持

## Task 7 第7ラウンド Codex指摘（対応済み）

1. **P1 — mode 1/2/3 primitive shadow descriptor** ✅
2. **P1 — procedures_call vendor mutation（warp null 含む）** ✅
3. **P1 — MP3 metadata/frame scan 分離 + ID3v2.4 footer** ✅

## Task 7 第7ラウンド再提出サマリー

```text
最終更新: 2026-07-16 23:40:12 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-schema/src/index.ts
- packages/project-schema/src/schema-gate.test.ts
- packages/project-schema/src/mp3-bytes.ts
- packages/project-schema/src/mp3-bytes.test.ts
- packages/project-service/src/verify-audio-bytes.test.ts
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1: mode 2/3 descriptor を block id または primitive array として検査（`[3,"add",[10,"0"]]` 等を受理）
- P1: procedures_call mutation を vendor 形式必須化（tagName/children/proccode/argumentids/warp、warp `"null"` 許可、argumentids↔inputs 整合）
- P1: MP3 — `MP3_METADATA_UNDERREPORT` 削除、actual/claimed 各々 <=60s のみ検査、ID3v2.4 footer flag + `3DI` skip
テスト結果:
- project-schema 60/60、typecheck PASS
- project-service 49/49
- sb3-tools 41/41
- scratch-adapter PASS
- pnpm build / sb3:opcodes:check / gate0:test / V1 golden hash / git diff --check: すべて PASS
未解決事項:
- なし
次の担当: Codex
```

再提出時の必須確認:

- `pnpm --filter @blocksync/project-schema test && typecheck`
- `pnpm --filter @blocksync/project-service test && typecheck`
- `pnpm --filter @blocksync/sb3-tools test && build`
- `pnpm --filter @blocksync/project-envelope test && build`
- `pnpm build`
- `pnpm sb3:opcodes:check`
- `pnpm gate0:test`
- V1 golden hash不変
- `git diff --check`
- `docs/ai-platform/design-brief-candidate.md`はTask 7 commit対象外のまま維持

## Task 7 第6ラウンド再提出サマリー

```text
最終更新: 2026-07-16 23:22:53 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-schema/src/mp3-bytes.ts（新規）
- packages/project-schema/src/mp3-bytes.test.ts（新規）
- packages/project-schema/src/index.ts
- packages/project-schema/src/schema-gate.test.ts
- packages/project-service/src/verify-audio-bytes.ts
- packages/project-service/src/verify-audio-bytes.test.ts
- packages/sb3-tools/src/verify-media-bytes.ts
- packages/sb3-tools/src/canonical-io.ts
- packages/sb3-tools/src/index.ts
- packages/sb3-tools/test/canonical-io.test.ts
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1: MP3 — 全frame走査・duration積算・60秒上限・ID3v2/ID3v1・garbage/trailing拒否を project-schema/mp3-bytes.ts に共通化。project-service / sb3-tools から利用
- P1: SB3 input encoding — mode 1/2 長さ2、mode 3 長さ3、descriptor は block id または primitive のみ、全 block ref 検証（ref.length>=8 削除）
- P1: custom procedure mutation — prototype/call の vendor fixture 準拠型検査（JSON配列 parse、argument 長整合、warp 型）
- P1: canonical suffix — jpeg md5ext を schema で拒否、import 時 .jpg へ正規化、asset alias 登録
- §6.5.3: old-format procedure call + argument reporter の import→export→re-import 正例を追加
テスト結果:
- pnpm --filter @blocksync/project-schema test: PASS (55/55)
- pnpm --filter @blocksync/project-schema typecheck: PASS
- pnpm --filter @blocksync/project-service test: PASS (48/48)
- pnpm --filter @blocksync/sb3-tools test: PASS (41/41)
- pnpm --filter @blocksync/sb3-tools build: PASS
- pnpm --filter @blocksync/project-envelope test: PASS
- pnpm build: PASS
- pnpm sb3:opcodes:check: PASS (208 opcodes)
- pnpm gate0:test: PASS
- V1 golden hash: PASS（変更なし）
- git diff --check: PASS
未解決事項:
- なし
次の担当: Codex
```

## Task 7 第6ラウンド Codex指摘（対応済み）

1. **P1 — MP3全体構造と実音声時間の60秒上限** ✅
2. **P1 — SB3 input encoding厳密化と全参照検証** ✅
3. **P1 — custom procedure mutation完全shape/type + fixture** ✅
4. **P1 — canonical dataFormat suffix（jpeg→jpg）** ✅

再提出時の必須確認:

- `pnpm --filter @blocksync/sb3-tools test && build`
- `pnpm --filter @blocksync/project-envelope test && build`
- `pnpm --filter @blocksync/project-schema test && typecheck`
- `pnpm --filter @blocksync/project-service test && typecheck`
- `pnpm build`
- `pnpm sb3:opcodes:check`
- `pnpm gate0:test`
- V1 golden hash不変
- `git diff --check`
- `docs/ai-platform/design-brief-candidate.md`はTask 7 commit対象外のまま維持

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

### 2026-07-16 20:16:30 JST — Cursor

```text
最終更新: 2026-07-16 20:16:30 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 6
全体進捗: 50%
基準SHA: d149631b2455af480ac6dbad7cad64d478e247cf
再提出SHA: 5b83f36b4e1b8b14d97e4e47140a86f9e845411a
commit message: feat(project-service): live asset verify and atomic import
git status --short: (clean)
テスト結果:
- pnpm --filter @blocksync/project-service test: PASS (44/44)
- pnpm --filter @blocksync/project-service typecheck: PASS
- pnpm --filter @blocksync/project-store-sqlite test: PASS (56/56)
- pnpm r1:persist:test: PASS
- git diff --check: PASS
次の担当: Codex
```

- Codex Go に従い Task 6 を commit 済み。
- 判定待ち: commit SHA 最終確認。全体進捗50%（Task 6 承認前）。
- 次担当: Codex。

### 2026-07-16 20:18:38 JST — Codex

- Task 6実装commit `5b83f36b4e1b8b14d97e4e47140a86f9e845411a`を最終確認。
- 親は承認基準`d149631b2455af480ac6dbad7cad64d478e247cf`、承認済み差分と一致。
- 台帳更新後のHEADは`435e24457a3250af0ff22ed6c053d665ad34867e`。確認時working tree/vendorはclean。
- Task 6を正式承認。Task 0〜6の7/12完了として全体進捗を58%へ更新。
- Task 7を解禁。承認基準SHAは`435e24457a3250af0ff22ed6c053d665ad34867e`。
- 状態: `TASK_7_READY`。次担当: Cursor。

### 2026-07-16 20:46:00 JST — Cursor

```text
最終更新: 2026-07-16 20:46:00 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7
全体進捗: 58%
基準SHA: 435e24457a3250af0ff22ed6c053d665ad34867e
再提出SHA: 未コミット
変更ファイル:
- packages/sb3-tools/package.json
- packages/sb3-tools/src/index.ts
- packages/sb3-tools/src/index.test.ts
- packages/sb3-tools/src/block-graph-canonical.ts
- packages/sb3-tools/src/canonical-io.ts
- packages/sb3-tools/src/equivalence-production.ts
- packages/sb3-tools/src/svg-sanitize.ts
- packages/sb3-tools/src/verify-media-bytes.ts
- packages/sb3-tools/test/canonical-io.test.ts
- packages/sb3-tools/test/helpers/assets.ts
- packages/sb3-tools/test/fixtures/svg/*.svg (5 fuzz fixtures)
- pnpm-lock.yaml
対応内容:
- canonical-io: projectJsonToDocument (schemaVersion 2) / documentToProjectJson / exportSb3 v2 正規化
- loadSb3: opcode allow-list (validateProject §6.6)、SVG explicit DOM walk、WAV/MP3 メディア検証統合
- equivalenceProduction: §6.7 target pairing + multiset script-root fingerprints (spike port)
- svg-sanitize: @xmldom/xmldom@0.8.10 parse + css-tree url/@import scan + allow-list walk
- verify-media-bytes: WAV rate/sampleCount 一致、MP3 Layer III 構造検証
- テスト: motion_unknown 拒否、audio corpus (pop 44100/1032, Meow 44100/37376)、custom procedure mutation round-trip、SVG fuzz fixtures
テスト結果:
- pnpm --filter @blocksync/sb3-tools test: PASS (21/21)
- pnpm --filter @blocksync/sb3-tools build: PASS
- pnpm gate0:test: PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 7 実装完了。Codex レビュー待ち。全体進捗58%（Task 7 承認前）。
- 次担当: Codex。

### 2026-07-16 20:54:37 JST — Codex

- Task 7未コミット差分をDesign §6.3〜§7.1と照合し、独立負例を実行。
- Task 7の正式基準SHAを、Task 6 Go台帳commitを含むclean HEAD `8e59f5aec3609d7d90920cd1b943af236ff53fbe`へ訂正（製品コード差はなし）。
- 独立負例5件で、costume順序変更を等価扱い、top-level座標をfingerprintへ算入、primitive block map entry拒否、5000px PNG受理、未知SVG属性受理を再現。レビュー用一時テストは実行後に削除済み。
- `pnpm --filter @blocksync/sb3-tools test`: PASS（21/21）。
- `pnpm sb3:opcodes:check`: PASS（208 opcodes）。
- `pnpm gate0:test`: PASS。
- `pnpm --filter @blocksync/sb3-tools build`: FAIL。css-tree型不足、stylesheet context型不整合、暗黙any、generator mjs declaration不足。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。Task 7は未承認、全体進捗58%を維持。
- Task 8は着手禁止。次担当: Cursor。

### 2026-07-16 21:11:00 JST — Cursor

```text
最終更新: 2026-07-16 21:11:00 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7（第2ラウンド）
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-schema/src/index.ts (BlockMapEntry / primitive blocks)
- packages/sb3-tools/src/equivalence-production.ts
- packages/sb3-tools/src/block-graph-canonical.ts
- packages/sb3-tools/src/canonical-io.ts
- packages/sb3-tools/src/svg-sanitize.ts
- packages/sb3-tools/src/verify-raster-bytes.ts
- packages/sb3-tools/src/verify-media-bytes.ts
- packages/sb3-tools/src/index.ts
- packages/sb3-tools/src/types/modules.d.ts
- packages/sb3-tools/tsconfig.json
- packages/sb3-tools/test/canonical-io.test.ts
- packages/sb3-tools/test/helpers/assets.ts
- packages/sb3-tools/test/fixtures/svg/unknown-attr.svg
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1: equivalenceProduction — costumes/sounds を配列順序付きで比較（sort 廃止）
- P1: primitive block map entries [4..13] を import/export/equivalence で保持（BlockMapEntry）
- P1: PNG/JPEG/GIF/BMP ヘッダー検証（4096px / 16M px 上限）+ 5000px 負例
- P1: SVG 属性 explicit allow-list + unknown-attr fuzz fixture
- P1: TypeScript build 修正（css-tree d.ts、test exclude、stylesheet context）
- P2: §6.7 fingerprint から x/y 除外（Design 準拠）、x/y は document/export で保持する回帰試験追加
テスト結果:
- pnpm --filter @blocksync/sb3-tools test: PASS (25/25)
- pnpm --filter @blocksync/sb3-tools build: PASS
- pnpm --filter @blocksync/project-schema test: PASS (40/40)
- pnpm sb3:opcodes:check: PASS (208 opcodes)
- pnpm gate0:test: PASS
- git diff --check: PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 7 第2ラウンド指摘（P1×5 + P2×1）を修正。Codex 再レビュー待ち。全体進捗58%。
- 次担当: Codex。

### 2026-07-16 21:19:47 JST — Codex

- Task 7第2ラウンドを再レビュー。前回のcostume順序、参照primitive保持、5000px上限、未知SVG属性、sb3-tools単体build、x/y fingerprintは修正済み。
- `project-schema` test 40/40、`sb3-tools` test 25/25はPASS。
- `pnpm build`は`project-envelope`が`BlockMapEntry`へ未対応のためFAIL（source 2件 + test型エラー）。
- コード確認でtop-level primitiveがequivalence fingerprintから除外されることを確認。
- 独立境界検査で24-byte PNG、10-byte GIF、不正短SOF JPEGが受理され、正当なtop-down BMPが拒否されることを確認。
- vendor非corrupt SB3 fixtureのSVG 124件を走査し29件のみ通過。少なくとも`project1.sb3`の標準猫costume 2件が`fill-rule`で拒否されることを確認。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。Task 7未承認、進捗58%、Task 8着手禁止を維持。
- 次担当: Cursor。

### 2026-07-16 21:50:52 JST — Cursor

```text
最終更新: 2026-07-16 21:50:52 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7（第3ラウンド）
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-envelope/src/index.ts
- packages/project-envelope/src/index.test.ts
- packages/project-schema/src/index.ts
- packages/project-service/src/service.test.ts
- packages/sb3-tools/src/block-graph-canonical.ts
- packages/sb3-tools/src/equivalence-production.ts
- packages/sb3-tools/src/verify-raster-bytes.ts
- packages/sb3-tools/src/svg-sanitize.ts
- packages/sb3-tools/src/index.ts
- packages/sb3-tools/test/canonical-io.test.ts
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1: project-envelope — V1 canonicalize 凍結（object block のみ）、V2 primitive entry canonicalize + テスト。project-service test 型修正。
- P1: scriptRootFingerprints — top-level primitive `[12|13, …, x, y]` を multiset へ含める（x/y は fingerprint から除外、§6.7 準拠）。
- P1: raster parser — PNG IHDR chunk 境界、GIF packed/GCT、JPEG SOF segment 境界、BMP signed height（top-down）検証。
- P1: SVG allow-list — `fill-rule` 追加 + vendor project1.sb3 猫 costume 正例テスト。
- P2: isPrimitiveBlockEntry — sb3.js tag 別 arity/type 検証（`[4]` 等を拒否）。
テスト結果:
- pnpm --filter @blocksync/sb3-tools test: PASS (31/31)
- pnpm --filter @blocksync/sb3-tools build: PASS
- pnpm --filter @blocksync/project-envelope test: PASS (17/17)
- pnpm --filter @blocksync/project-envelope build: PASS
- pnpm --filter @blocksync/project-schema test: PASS (40/40)
- pnpm --filter @blocksync/project-service test: PASS (44/44)
- pnpm build: PASS
- pnpm sb3:opcodes:check: PASS (208 opcodes)
- pnpm gate0:test: PASS
- V1 golden hash: PASS（empty/rich 変更なし）
- git diff --check: PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 7 第3ラウンド指摘（P1×4 + P2×1）を修正。Codex 再レビュー待ち。全体進捗58%。
- 次担当: Codex。

### 2026-07-16 22:09:38 JST — Codex

- Task 7第3ラウンドを再レビュー。前回の全体build、top-level primitive fingerprint、BMP top-down、PNG境界、primitive tag別検査、`fill-rule`は修正済み。
- 独立検査で、primitive block entryを追加したV1文書が`validateProject`を通過し、追加前と同一contentHashになることを確認（`sameHash: true`, `valid: true`）。V1 canonicalizer/golden hashを変えずvalidatorで拒否する必要がある。
- Design §2.3がhard rejectと定めるmissing asset bytesを、`loadSb3`がwarningのみにして継続するコード経路を確認。vendor `missing_png.sb3`でも`Missing asset file ...` warningを確認した。
- 独立境界検査で12-byteの切断GIFとSOF segment length 7の不正JPEGが受理されることを確認。
- 非corrupt vendor SB3の`project.json`参照SVGを走査し、110件中59件がallow-listで拒否されることを確認。標準`draggable.sb3`のcostumeもroot `x`等で拒否される。
- `pnpm build`はPASS。第3ラウンドで回復した項目は確認済み。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。P1×4を台帳上部へ記録。Task 7未承認、全体進捗58%、Task 8着手禁止を維持。
- 次担当: Cursor。

### 2026-07-16 22:36:30 JST — Cursor

```text
最終更新: 2026-07-16 22:36:30 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7（第4ラウンド）
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-schema/src/index.ts
- packages/project-schema/src/schema-gate.test.ts
- packages/project-envelope/src/index.test.ts
- packages/project-service/src/service.test.ts
- packages/sb3-tools/src/index.ts
- packages/sb3-tools/src/verify-raster-bytes.ts
- packages/sb3-tools/src/svg-sanitize.ts
- packages/sb3-tools/test/canonical-io.test.ts
- packages/sb3-tools/test/fixtures/svg/unknown-attr.svg
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1: V1 validator — primitive block entry を DISALLOWED_V1_FIELD で拒否（canonicalizer/golden hash 凍結）
- P1: loadSb3 — 欠落 asset を MISSING_ASSET issue で hard reject（missing_png.sb3 負例）
- P1: raster — GIF logical screen 13-byte、JPEG SOF component count/segment 整合性
- P1: SVG — root x/y, enable-background, font-*, data-* 許可 + vendor corpus/draggable 回帰試験
テスト結果:
- pnpm --filter @blocksync/sb3-tools test: PASS (34/34)
- pnpm --filter @blocksync/sb3-tools build: PASS
- pnpm --filter @blocksync/project-envelope test: PASS (18/18)
- pnpm --filter @blocksync/project-envelope build: PASS
- pnpm --filter @blocksync/project-schema test: PASS (41/41)
- pnpm --filter @blocksync/project-service test: PASS (45/45)
- pnpm build: PASS
- pnpm sb3:opcodes:check: PASS (208 opcodes)
- pnpm gate0:test: PASS
- V1 golden hash: PASS（変更なし）
- git diff --check: PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 7 第4ラウンド指摘（P1×4）を修正。Codex 再レビュー待ち。全体進捗58%。
- 次担当: Codex。

### 2026-07-16 22:45:44 JST — Codex

- Task 7第4ラウンドを再レビュー。前回P1のV1 primitive拒否、missing asset hard reject、GIF/JPEG境界、referenced vendor SVG corpusは修正済み。
- `pnpm --filter @blocksync/sb3-tools test`を独立実行し34/34 PASS。`git diff --check`もPASS。
- actual vendor WAVを含む`project1.sb3` / `origin-absent.sb3`が`WAV_RATE_MISMATCH`で拒否されることを確認。raw WAVとScratch metadataはAudioEngine resamplingにより異なり、Design §6.3の直接一致規則とvendor v14.1.0実装が矛盾している。
- actual `scratch3_music` MP3を`assertValidMp3Bytes`へ入力し`MP3_LAYER_NOT_III`で拒否されることを確認。`sb3-tools` parserのheader byte offsetが誤っている。
- `equivalenceProduction`がtop-level meta変更とcostume name変更をいずれも等価（`true`）と判定することを独立確認。
- importがmd5ext stem/suffixとassetId/canonical formatの整合性を検査しない経路を確認。
- `inputs.BAD=[99,"x"]`およびcustom procedure必須mutation削除の双方を`validateProject`が`ok:true`で受理することを独立確認。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。P1×5を台帳上部へ記録。Task 7未承認、全体進捗58%、Task 8着手禁止を維持。
- 次担当: Cursor。

### 2026-07-16 22:56:30 JST — Cursor

```text
最終更新: 2026-07-16 22:56:30 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7（第5ラウンド）
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md
- packages/project-schema/src/index.ts
- packages/project-schema/src/schema-gate.test.ts
- packages/project-service/src/verify-audio-bytes.ts
- packages/project-service/src/verify-audio-bytes.test.ts
- packages/sb3-tools/src/verify-media-bytes.ts
- packages/sb3-tools/src/equivalence-production.ts
- packages/sb3-tools/src/canonical-io.ts
- packages/sb3-tools/src/index.ts
- packages/sb3-tools/test/canonical-io.test.ts
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1: WAV — §6.3 を Scratch metadata 準拠に訂正。raw RIFF と metadata の直接一致検査を廃止（project-service / sb3-tools 共通）
- P1: MP3 — sb3-tools parser の header byte offset を project-service と同じに修正
- P1: equivalenceProduction — meta + costume/sound name を比較に追加
- P1: asset ref — assetId/md5ext stem/dataFormat suffix 整合性（schema + loadSb3）
- P1: SB3 input/field encoding + procedures_prototype/call 必須 mutation 検証
- vendor project1.sb3 import 正例、scratch3_music MP3 corpus 正例を追加
テスト結果:
- pnpm --filter @blocksync/sb3-tools test: PASS (39/39)
- pnpm --filter @blocksync/sb3-tools build: PASS
- pnpm --filter @blocksync/project-schema test: PASS (44/44)
- pnpm --filter @blocksync/project-envelope test: PASS (18/18)
- pnpm --filter @blocksync/project-service test: PASS (46/46)
- pnpm build: PASS
- pnpm sb3:opcodes:check: PASS (208 opcodes)
- pnpm gate0:test: PASS
- V1 golden hash: PASS（変更なし）
- git diff --check: PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 7 第5ラウンド指摘（P1×5）を修正。Codex 再レビュー待ち。全体進捗58%。
- 次担当: Codex。

### 2026-07-16 23:02:38 JST — Codex

- Task 7第5ラウンドを再レビュー。actual vendor WAV/MP3正例、equivalence meta/name、基本asset stem検査、不正mode 99、mutation欠落は修正済み。
- `pnpm --filter @blocksync/sb3-tools test`を独立実行し39/39 PASS。`git diff --check`もPASS。
- vendorの有効MP3 frameを2300個連結した約60.0816秒の音声が、metadataを1秒と申告すると受理されることを独立確認。parserが先頭2 frameしか走査せず、実duration上限を強制していない。
- SB3 input境界の`[1,10]`、`[2,"x","extra"]`、`[3,"x"]`がすべて`validateProject ok:true`になることを独立確認。欠落block refも短いidなら拒否されない。
- custom procedure mutationのkey型を全面的に壊しても`validateProject ok:true`になることを独立確認。§6.5.3必須のprocedure call / argument reporter fixtureも未追加。
- `dataFormat:'jpg'`と`md5ext:'<assetId>.jpeg'`の非canonical suffixが`validateProject ok:true`になることを独立確認。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。P1×4を台帳上部へ記録。Task 7未承認、全体進捗58%、Task 8着手禁止を維持。
- 次担当: Cursor。

### 2026-07-16 23:22:53 JST — Cursor

```text
最終更新: 2026-07-16 23:22:53 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-schema/src/mp3-bytes.ts（新規）
- packages/project-schema/src/mp3-bytes.test.ts（新規）
- packages/project-schema/src/index.ts
- packages/project-schema/src/schema-gate.test.ts
- packages/project-service/src/verify-audio-bytes.ts
- packages/project-service/src/verify-audio-bytes.test.ts
- packages/sb3-tools/src/verify-media-bytes.ts
- packages/sb3-tools/src/canonical-io.ts
- packages/sb3-tools/src/index.ts
- packages/sb3-tools/test/canonical-io.test.ts
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1×4（第6ラウンド）すべて対応 — MP3全frame/60秒、SB3 input厳密化、mutation型検査、jpeg suffix正規化
テスト結果:
- project-schema 55/55、project-service 48/48、sb3-tools 41/41
- pnpm build / sb3:opcodes:check / gate0:test / V1 golden hash / git diff --check: すべて PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 7 第6ラウンド P1×4 対応完了。Codex 再レビュー待ち。全体進捗58%。
- 次担当: Codex。

### 2026-07-16 23:35:02 JST — Codex

- Task 7第6ラウンドを再レビュー。MP3全frame/60秒、input固定長と全string ref、prototype mutation基本shape、jpeg→jpg正規化は修正済み。
- `project-schema` test 55/55、`sb3-tools` test 41/41を独立実行しPASS。`git diff --check`もPASS。
- Scratch Adapterが生成する標準mode 3 primitive shadow 2件を現validatorが`INVALID_INPUT_ENCODING`で拒否することを独立確認。vendor serializerは全descriptor位置をprimitive arrayへ圧縮し得る。
- vendor corpus走査で`clear-color.sb3`の`procedures_call`に`warp:"null"`が実在することを確認。現validatorはこれを拒否する一方、call mutationが`{proccode:"x"}`だけでも受理する。
- 短い有効MP3に異なる正のSB3 metadataを与えると`MP3_METADATA_UNDERREPORT`で拒否され、Design §6.3のmetadata/frame scan分離契約に反することを確認。
- 公式ID3v2.4構造（有効frameを含むtag + footer flag + `3DI` footer + audio）を`MP3_GARBAGE`で拒否することを独立確認。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。P1×3を台帳上部へ記録。Task 7未承認、全体進捗58%、Task 8着手禁止を維持。
- 次担当: Cursor。

### 2026-07-16 23:40:12 JST — Cursor

```text
最終更新: 2026-07-16 23:40:12 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-schema/src/index.ts
- packages/project-schema/src/schema-gate.test.ts
- packages/project-schema/src/mp3-bytes.ts
- packages/project-schema/src/mp3-bytes.test.ts
- packages/project-service/src/verify-audio-bytes.test.ts
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1×3（第7ラウンド）すべて対応
テスト結果:
- project-schema 60/60、project-service 49/49、sb3-tools 41/41、scratch-adapter PASS
- pnpm build / gate0:test / git diff --check: すべて PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 7 第7ラウンド P1×3 対応完了。Codex 再レビュー待ち。全体進捗58%。
- 次担当: Codex。

### 2026-07-16 23:43:36 JST — Codex

- Task 7第7ラウンドを再レビュー。mode 1/2/3 primitive descriptor、vendor call必須fields + `warp:"null"`、MP3 actual/metadata duration分離は修正済み。
- 公式ID3v2.4ではtag sizeがheader/footerを除外するが、現parser/testはfooterをsize内に含めている。公式構造の有効fixture（11-byte tag data + footer）を`ID3_FOOTER`で拒否することを独立確認。
- `procedures_call`でplaceholder 0個のproccodeにargumentids/inputを1個与えても`validateProject ok:true`になることを独立確認。prototype/callのplaceholder↔argument整合が未検証。
- `git diff --check`はPASS。
- 判定: `NO_GO` / `CHANGES_REQUESTED`。P1×2を台帳上部へ記録。Task 7未承認、全体進捗58%、Task 8着手禁止を維持。
- 次担当: Cursor。

### 2026-07-16 23:52:30 JST — Cursor

```text
最終更新: 2026-07-16 23:52:30 JST
更新者: Cursor
状態: READY_FOR_CODEX_REVIEW
対象Task: Task 7
全体進捗: 58%
基準SHA: 8e59f5aec3609d7d90920cd1b943af236ff53fbe
再提出SHA: 未コミット
変更ファイル:
- packages/project-schema/src/mp3-bytes.ts
- packages/project-schema/src/mp3-bytes.test.ts
- packages/project-schema/src/index.ts
- packages/project-schema/src/schema-gate.test.ts
- docs/CURSOR_CODEX_HANDOFF.md
対応内容:
- P1×2（第8ラウンド）すべて対応
テスト結果:
- project-schema 66/66、gate0:test / git diff --check: PASS
未解決事項:
- なし
次の担当: Codex
```

- Task 7 第8ラウンド P1×2 対応完了。Codex 再レビュー待ち。全体進捗58%。
- 次担当: Codex。

### 2026-07-16 23:58:54 JST — Codex

- Task 7第8ラウンドを再レビュー。ID3v2.4のtag size/footer位置・footer整合・synchsafe検査、およびprocedure placeholder数・argument配列・call inputs・重複id整合は修正済み。
- 独立境界検査で通常、先頭placeholder、隣接placeholderの挙動を確認。vendor `sb2.js`と同じ分割契約であることを確認した。
- `project-schema` test 66/66・typecheck、`project-service` test 49/49・typecheck、`sb3-tools` test 41/41・build、`project-envelope` test 18/18・buildを独立実行しPASS。
- `pnpm build`、`pnpm sb3:opcodes:check`（208 opcodes）、`pnpm gate0:test`、`git diff --check`はすべてPASS。
- blocking findingなし。Task 7の未コミット差分をコードレビューGoとし、指定messageでのcommitを許可。
- `docs/ai-platform/design-brief-candidate.md`はTask 7 commitから除外する。
- commit SHA確認まではTask 7を正式承認せず、全体進捗58%を維持。Task 8着手禁止。
- 状態: `APPROVED_TO_COMMIT`。次担当: Cursor。
