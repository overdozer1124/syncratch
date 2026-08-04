# Syncratch Community v0.1.0 — Release Notes

| 項目 | 値 |
|---|---|
| Tag | `v0.1.0-community` |
| Date | 2026-08-04 |
| Commit | `81a290d`（main @ merge #212） |
| Product | Syncratch Community（シンクラッチ） |
| Production URL | https://syncratch-production.up.railway.app/ |
| Acceptance | `FINAL_ACCEPTANCE_REPORT.md` / `STAGE5_MANUAL_GATES.md` §C.1.2 |

## Summary

Syncratch Community の初回公開リリースです。Local-First Stage 5 受け入れ完了に加え、教室運用向けの任意レイヤ（管理者ポリシー・名簿・生徒認証・教師 Drive 提出）が feature flag 付きで main に取り込まれています。**すべての classroom 機能はデフォルト OFF** で、従来の `/` 単独編集は Phase 2 互換のままです。

## What's included

### Local-First core（Stage 5 — 受け入れ完了）

- ログインなしの Scratch 作品編集（IndexedDB 正本）
- `.sb3` インポート / エクスポート
- 任意の Google Drive 連携（OAuth scope: `drive.file` のみ）
- P2P 共同編集（ホスト限定 Drive 保存、ゲストはローカル保存のみ）
- Drive 競合検知・権限取り消し後のローカル継続
- 手動ゲート A1–A7 / B1–B3 PASS（2026-08-02）

### Admin / student access（Phase 2 — main 済み）

- `/admin` — 許可リスト管理者のみ（Google ID token）
- ClassroomPolicy + 生徒リンク `/s/{token}`
- Grant 交換（HttpOnly cookie）・リンク失効 / 再発行 / 有効期限
- 生徒面での設定ロック（AI / Drive / collab / extensions 等）

### Classroom roster & submissions（8 PR — main 済み、flag OFF 既定）

- 名簿 CSV import / Google Sheet sync（任意）
- 生徒ローカル認証（identity session）
- 教師 Drive への SB3 提出（メタデータ SQLite、bytes Drive）
- `/admin` 提出一覧・詳細・SB3 ダウンロード
- `/admin/submissions/{id}/preview` 読み取り専用プレビュー（`SYNCRATCH_SUBMISSION_PREVIEW_ENABLED`）

詳細: `docs/local-first/DEPLOYMENT.md` §Classroom admin

## Known limitations（告知に含める）

| 項目 | 状態 |
|---|---|
| TURN サーバー | 未提供（厳しい NAT では P2P 失敗し得る） |
| Drive 分散ロック | best-effort（競合検知 + 明示保存） |
| AI 作品診断 Phase 4+ | 未着手（Milestone A まで main 済み） |
| admin-student-access Phase 3 | 未着手（生徒 AI プロキシ等は別仕様） |
| School Server track | buildable のまま凍結 |
| 中央バックアップ / 大規模 room | Community 初回対象外 |

## Upgrade / deploy notes

- Railway 本番は `main` 追従デプロイ。classroom 機能を使う場合は `DEPLOYMENT.md` の feature flag チェーンを順に有効化。
- 既存 `/` 利用者: flag 未設定時は挙動変更なし。
- 検証用生徒リンク token を公開資料に載せないこと。

## References

- Announcement draft: `STAGE5_RELEASE_ANNOUNCEMENT_DRAFT.md`（内容承認 2026-08-02）
- Project status: `PROJECT_COMPLETION_STATUS.md`
- Handoff: `docs/CURSOR_CODEX_HANDOFF.md`
