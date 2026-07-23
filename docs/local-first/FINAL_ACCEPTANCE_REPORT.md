# Local-First Stage 5 受け入れレポート

| 項目 | 値 |
|---|---|
| 日時 | 2026-07-23 10:38:50 JST（Drive 本番確認を追記） |
| 対象 tip | `d179efff59827007cd84664a52234f188e88cb1b`（自動ゲート基準） |
| 本流ブランチ | `main` |
| 作業ブランチ | `cursor/release-gates-stage5-f431`（本レポート更新） |
| 製品名 | Syncratch（シンクラッチ） |
| Stage 5 状態 | **IN_PROGRESS** — 自動 PASS / A1–A4・B2 PASS / A5–A7・B1・B3 残り |
| オンライン検証 | `https://syncratch-production.up.railway.app/`（`/healthz` → `ok`） |
| Google Cloud | project `syncratch` / APP_ID `863099193805`（Picker） |
| 手動手順 | `docs/local-first/STAGE5_MANUAL_GATES.md` |

## 結論

Community Local-First の **自動ゲートは tip `d179eff` で再 PASS**。  
Railway へ `VITE_GOOGLE_*` を焼き込み、ユーザーが **Drive 連携（OAuth / Picker / 保存）を完了**した。

Stage 5 完了には、2 アカウント共有・leader 書き込み・権限取り消し・競合停止（A4–A7）と、
peer 切断表示・token 実機検査（B1 / B3）が残る。

## Drive 本番証跡（2026-07-23）

| 項目 | 結果 |
|---|---|
| Railway `/healthz` | PASS（`ok`） |
| production JS に Client ID / API key / APP_ID | PASS（APP_ID は数字 `863099193805`。project id 文字列ではない） |
| production JS に `drive.file` | PASS |
| ユーザー報告: Drive 連携完了 | PASS（A1–A3 / B2 を記録） |

## 自動ゲート結果（tip `d179eff`）

| ゲート | 結果 |
|---|---|
| `pnpm gate0:test` | PASS |
| `pnpm gate0:collab` | PASS（2/2） |
| `@blocksync/editor-web` typecheck | PASS |
| `@blocksync/editor-web` test | PASS（206/206） |
| `@blocksync/editor-web` build（production） | PASS |
| production `dist/index.html` あり / `collab-harness.html` なし | PASS |
| `BLOCKSYNC_BASE_PATH=/` `verify:static` | PASS |
| Playwright `e2e/editor.spec.ts` + `collab.spec.ts` | PASS（18/18） |
| `@blocksync/google-drive-sync` test | PASS（25/25） |
| `@blocksync/classroom-apps-script` test | PASS（14/14） |
| `@blocksync/collaboration-domain` test | PASS（43/43） |
| `@blocksync/collab-webrtc` test | PASS（35/35） |
| `@blocksync/collab-signaling` test | PASS（18/18） |
| `@blocksync/collab-invite` test | PASS（13/13） |
| `@blocksync/collab-host` test | PASS（4/4） |
| Frozen School: `pnpm r1:persist:test` | PASS |
| Frozen School: `pnpm r1:auth:test` | PASS |
| Railway `/healthz` | PASS（`ok`, HTTP 200） |
| `git diff --check` | PASS |

## tip `d179eff` までに含まれる主要マイルストーン

- PR #10: local-first 共同編集統合（bootstrap/reconnect、asset 同期、選択維持、Syncratch 改名、ja 漢字）
- PR #13: regular remote apply 時の local-only UI（tab / per-target Blockly viewport）保全
- PR #16: block-level collab Phase 1（per-block `Y.Map`、同一スプライト別 stack 共存）
- PR #17: Railway `collab-host`（static + same-origin `/signal`、TURN なし）
- PR #19: editor 読み込み高速化（async GUI、gzip、collab-host gzip）
- Frozen School/self-hosted track は buildable のまま Community 実行時必須依存にしない

## Stage 5 残作業（ユーザー）

済み: A1–A3（Drive ハッピーパス）、B2（Apps Script 未導入）。

残り（`STAGE5_MANUAL_GATES.md`）:

1. A4 二人の Google ユーザーで同じ共有 Drive ファイル
2. A5 logical leader だけが通常の Drive スナップショットを試みる
3. A6 権限取り消し後もローカル保存と SB3 が続く
4. A7 同時 Drive 変更で安全に競合停止
5. B1 peer 切断後に未受信変更を同期済みと言わない
6. B3 IndexedDB / SB3 / ログ等に token が残っていない実機検査

合格後、本レポートを `COMPLETE` にし `RELEASE_CHECKLIST.md` を埋める。

## 既知の限界（リリース告知に含めない／含めないもの）

受け入れ対象外・非目標（設計どおり）:

- 同一 block id / 同一接続辺の同時変更は per-block LWW（決定的勝者一方）。文字単位・操作 CRDT の意味的 merge は Phase 1 対象外
- AI / 中央バックアップ / 大規模 room / 新規 school directory
- Drive の厳密分散ロック・atomic CAS 保証なし（best-effort leader）
- TURN なし（制限の強い NAT / 学校ネットでは peer 接続が失敗し得る。ローカル編集と SB3 は継続）
- guest-initial / new / open で「前作品の UI」を復元しない（漏えい禁止）
- `currentCostume` 等の共有作品状態を peer 同期しない

## 本流化・公開メモ

1. GitHub default branch を `feat/local-first-pivot-impl` から `main` へ切り替える（ユーザー操作。API は 403）。
2. 残存 Draft PR は base を `main` へ付けるか、不要なら close する。
3. Drive ハッピーパスは確認済み。A4–A7 / B1 / B3 完了前に「Stage 5 完了」とは言わない。
4. 自動で default branch 変更は行わない。
