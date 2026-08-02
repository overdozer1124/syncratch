---
name: hermes-review-loop
description: Cursor 実装 → Hermes 決裁 → CI green → マージのレビューループ。classroom-roster-drive-submissions 等で PR 提出前・マージ前に必ず適用する。
---

# Hermes レビューループ

Hermes（Codex 週次制限時の代行レビュア）による PR 決裁フロー。Cursor が実装し、Hermes が GO/NO-GO を出し、GO 後に CI green を確認して `main` へマージする。

## いつ使うか

- `classroom-roster-drive-submissions` など 8 PR 分割案件の各 PR 完了時
- `docs/CURSOR_CODEX_HANDOFF.md` のレビュー主体が Hermes のとき
- ユーザーが「skill 化」「Hermes レビュー」「PR N へ進めて」と指示したとき

## フロー概要

```text
Cursor 実装
  → 自己レビュー 2 周（台帳ルーブリック）
  → READY_FOR_HERMES_REVIEW（自動マージ禁止）
  → Hermes GO / NO-GO
  → [NO-GO] Cursor 修正 → 再提出
  → [GO] CI green 確認 → draft 解除 → main マージ
  → 台帳更新（PHASEn_COMPLETE / mergedAt）
```

## Cursor 実装担当 — 完了チェックリスト

作業完了時、**自動マージしない**。以下をすべて満たしてから `READY_FOR_HERMES_REVIEW` で停止する。

### 1. 一次情報に接地

- DB: `sqlite_master` + `PRAGMA table_info` でスキーマを dump
- migration ledger: `schema_migrations` 行と `PRAGMA user_version` の一致
- 生成物・暗号化 blob は実バイト/実 SQL を正とする（プラン文書だけを信じない）

### 2. 7 点受け入れ基準（PR 1 で確立、以降 PR でも該当項を確認）

| # | 観点 | 確認 |
|---|---|---|
| 1 | Phase 2 互換 | 全 flag OFF 時、既存 `/`, `/admin`, `/s/{token}`, grant/policy が Phase 2 と同一 |
| 2 | migration 原子性 | `db.transaction()` で DDL + ledger + `user_version` が原子的 |
| 3 | fail closed | unknown/partial schema、checksum 不一致、ledger gap で起動失敗 |
| 4 | feature flags | 依存チェーン不正 → 全 flag OFF 降格（起動継続） |
| 5 | 秘密値非保存 | refresh token / passphrase / API key を SQLite 平文保存しない |
| 6 | scope 境界 | Google OAuth は `drive.file` のみ（admin credential / editor Drive 分離） |
| 7 | テスト証跡 | 対象 package test/typecheck PASS、`git diff --check` PASS |

### 3. PR 固有の Hermes 必須項（該当 PR の plan §Verification を読む）

例 — PR 2 Admin Google OAuth:

- OAuth `state` は SQLite + TTL + **原子的単回消費**（in-memory Map 禁止）
- テスト: start → DB/プロセス再起動 → callback 成功
- テスト: 同一 state 並行 2 件 → 片方のみ成功
- scope リクエストに `drive.file` のみ（`DRIVE_AUTH_SCOPES` 使用禁止）
- refresh token は AES-256-GCM 暗号化（`SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON`）
- `resolveClassroomFeatureFlagsForStartup()` を起動時 1 回束縛（リクエスト毎 `process.env` 再読禁止）

### 4. 検証コマンド（plan の Verification 節を正とする）

```bash
pnpm --filter @blocksync/classroom-access test
pnpm --filter @blocksync/classroom-access typecheck
pnpm --filter @blocksync/collab-host test
pnpm --filter @blocksync/collab-host typecheck
git diff --check
```

Gate 0 は CI を判定根拠とする（ローカル vendor VM 不足で scratch-adapter FAIL しうる）。

### 5. 台帳更新

`docs/CURSOR_CODEX_HANDOFF.md` に追記:

```text
案件ID: classroom-roster-drive-submissions
状態: READY_FOR_HERMES_REVIEW
次の担当: Hermes
branch: cursor/...
PR: #N head <sha>
検証: ... PASS
禁止: 自動マージ / 次 PR 先行
```

## Hermes 決裁担当

1. `docs/CURSOR_CODEX_HANDOFF.md` のアクティブ案件IDと最新ログを読む
2. PR diff・テスト・一次情報（スキーマ dump 等）を敵対的にレビュー
3. 判定を台帳に記録:

```text
Reviewer: Hermes（Codex 代行）
判定: GO | NO-GO（差し戻し）
Blocker: N-* / Major: M-*
次の担当: Cursor | （GO 時）Cursor（マージ実行）
```

## GO 後 — Cursor マージ担当

workspace ルール `always-merge-prs` に従う:

1. PR が draft なら **ready for review**
2. CI green になるまで待つ（失敗時は修正して再 push）
3. **`main` へマージ**（`gh pr merge --merge` 等）
4. `mergedAt` 確認
5. `git checkout main && git pull origin main`
6. 台帳を `PHASEn_COMPLETE` / `PR N MERGED` に更新

**禁止:** マージ可能な PR を開いたまま終了、「マージしてください」とユーザーに依頼して終了。

## Engineering Integrity — 台帳・決裁の改変禁止

1. **Hermes 決裁エントリは逐語コピーする。** `docs/CURSOR_CODEX_HANDOFF.md` への Hermes 判定は、Hermes 出力を要約・取捨選択して書かない。Blocker を Minor だけ残して GO に書き換える等は **決裁の改変** であり禁止。
2. **「条件付き GO」≠ マージ許可。** 状態名は Hermes の判定語をそのまま使う（例: `PR2_CHANGES_REQUESTED`、`CONDITIONAL_GO`）。`GO` / `APPROVED_PENDING_CI` 以外ではマージしない。
3. **マージ前に決裁照合を 1 回行う。** 台帳の最新 Hermes エントリが無条件 `GO` または `APPROVED_PENDING_CI` であることを確認し、Blocker / Major の未解消がないことを diff で検証してから `gh pr merge` する。

## NO-GO 後 — Cursor 修正

1. Hermes の Blocker/Major を 1 件ずつ対応
2. 同一ルーブリックで自己レビュー 2 周
3. 再 push → `READY_FOR_HERMES_REVIEW` → Hermes 再決裁

## 参照

- 台帳: `docs/CURSOR_CODEX_HANDOFF.md`
- 設計: `docs/superpowers/specs/2026-08-02-classroom-roster-drive-submissions-design.md`
- 計画: `docs/superpowers/plans/2026-08-02-classroom-roster-drive-submissions-plan.md`
- Cursor 自己レビュー: 台帳「Cursor 内レビュー・ルーブリック」節
