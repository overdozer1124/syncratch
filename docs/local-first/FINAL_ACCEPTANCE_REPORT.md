# Local-First Stage 5 受け入れレポート

| 項目 | 値 |
|---|---|
| 日時 | 2026-08-02 JST（手動ゲート完了） |
| 対象 tip | 自動ゲート基準 `d179eff…` / 手動完了時 main `6267f59…` |
| 本流ブランチ | `main` |
| 製品名 | Syncratch（シンクラッチ） |
| Stage 5 状態 | **COMPLETE** — 自動 PASS + 手動 A1–A7 / B1–B3 すべて PASS |
| オンライン検証 | `https://syncratch-production.up.railway.app/`（`/healthz` → `ok`） |
| Google Cloud | project `syncratch` / APP_ID `863099193805`（Picker） |
| 手動手順 | `docs/local-first/STAGE5_MANUAL_GATES.md` §C.1.2 |

## 結論

Community Local-First の **Stage 5 受け入れは完了**。

- 自動ゲート: tip `d179eff` で PASS（`RELEASE_CHECKLIST.md` §Automated gates）
- 手動 Google gates A1–A7: PASS（最終確認 2026-08-02、記録 `STAGE5_MANUAL_GATES.md` §C.1.2）
- Failure / privacy B1–B3: PASS（B2 は Apps Script 未導入で 2026-07-23 から PASS）

Railway 本番で Drive 連携（OAuth `drive.file` / Picker / 保存）、共同編集ホスト限定 Drive 書き込み、
権限取り消し後のローカル継続、Drive 競合停止、peer 切断表示、token 非永続化を実機確認した。

## Drive 本番証跡

| 項目 | 結果 |
|---|---|
| Railway `/healthz` | PASS |
| production JS に Client ID / API key / APP_ID | PASS |
| production JS に `drive.file` | PASS |
| ユーザー実機 A1–A7 | PASS（2026-08-02） |
| ユーザー実機 B1 / B3 | PASS（2026-08-02） |

## 自動ゲート結果（tip `d179eff`）

| ゲート | 結果 |
|---|---|
| `pnpm gate0:test` | PASS |
| `pnpm gate0:collab` | PASS（2/2） |
| `@blocksync/editor-web` typecheck | PASS |
| `@blocksync/editor-web` test | PASS（206/206） |
| `@blocksync/editor-web` build（production） | PASS |
| Playwright `e2e/editor.spec.ts` + `collab.spec.ts` | PASS（18/18） |
| `@blocksync/google-drive-sync` test | PASS（25/25） |
| その他 packages（collab / classroom-apps-script 等） | PASS（`RELEASE_CHECKLIST.md` 参照） |
| Railway `/healthz` | PASS |

## 手動ゲート結果（2026-08-02）

| ゲート | 結果 |
|---|---|
| A5 Creator-only Drive write | PASS |
| A6 Revoke keeps local/SB3 | PASS |
| A7 Conflict safe stop | PASS |
| B1 Peer disconnect honesty | PASS |
| B3 No persisted tokens | PASS |

詳細メモ: `STAGE5_MANUAL_GATES.md` §C.1.2

## 既知の限界（リリース告知に含めない／含めないもの）

受け入れ対象外・非目標（設計どおり）:

- 同一 block id / 同一接続辺の同時変更は per-block LWW（決定的勝者一方）
- AI / 中央バックアップ / 大規模 room / 新規 school directory
- Drive の厳密分散ロック・atomic CAS 保証なし（best-effort leader）
- TURN なし（制限の強い NAT / 学校ネットでは peer 接続が失敗し得る）
- guest-initial / new / open で「前作品の UI」を復元しない
- `currentCostume` 等の共有作品状態を peer 同期しない

## 本流化・公開メモ

1. Stage 5 完了。`RELEASE_CHECKLIST.md` の Manual / Failure 項目は 2026-08-02 時点ですべてチェック済み。
2. ローカル保存完了は toolbar ステータスアイコンの tooltip（sr-only テキスト）で確認する UI 設計。
3. 生徒リンク `/s/{token}` は ClassroomPolicy に従う（`drive.allow` / `collab.allow`）。
