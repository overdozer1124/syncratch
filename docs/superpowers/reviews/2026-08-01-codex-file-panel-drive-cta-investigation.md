# Codex 調査依頼: ファイルパネルで Drive 保存ボタンが見えない / スクロールできない

## 依頼種別

**実装レビューではなく、再現調査 + 根因特定 + 最小修正方針の提案。**  
ユーザー実機で Stage 5 A5 がブロックされている。Cursor は仮説整理まで行い、修正実装は本調査の結論後に行う。

## ユーザー報告（一次情報）

1. ファイルパネルを**下にスクロールできない**。
2. そもそも **「Drive にも保存」ボタンが存在しない**（見えない）。
3. 一方で Drive ステータス文言は見える（例:「Google ドライブにはまだ保存していません：このパソコンと Google ドライブの内容がちがいます…」）。
4. 文脈: 「いっしょに作る」リンク作成後のホスト。Community 本番 URL で検証中。

スクショ上は Drive セクションの**見出し・ステータス・説明文まで**見えており、その直下にあるはずの `drive-controls` ボタン列に到達できていないように見える。

## 本番で確認済みの事実（Cursor・2026-08-01）

| 項目 | 値 |
|---|---|
| 検証 URL | `https://syncratch-production.up.railway.app/` |
| main tip（期待） | `925e1c949414e4f98387d6b253a9e61903c793a5`（PR #183 merge） |
| Railway deploy #183 | **Failure**（`Deployment failed`）。本番は旧アセットのままの可能性大 |
| 本番 HTML | `#save-drive` **は存在する**（ラベルは旧表記 `ドライブにも保存`） |
| 本番 HTML 構造 | `file-panel` → `.panel-content` → `.drive-section` → `.drive-controls` → `#save-drive` |

つまり「HTML からボタンが消えた」わけではなく、**描画・クリップ・hidden・スクロール不能のいずれかでユーザーに届いていない**可能性が高い。

## 関連コード（優先読取順）

1. `apps/editor-web/index.html`（`file-panel` / `drive-section` / `#save-drive`）
2. `apps/editor-web/src/style.css`
   - `html, body, #app { overflow: hidden }`
   - `.panel-content` / `.file-panel .panel-content`（`max-height` + `overflow: auto`）
   - `.toolbar`（`height: 3rem` / `pointer-events`）
   - `.toolbar-menu-backdrop`
   - `button[hidden] { display: none !important }`
   - `.drive-section` / `.drive-controls`
3. `apps/editor-web/src/main.ts`（`renderDriveStatus` / `driveControlFlags` 適用。`#save-drive` は `disabled` のみで、通常は `hidden` にしない）
4. `apps/editor-web/src/collab-role-ui.ts`（`driveControlFlags`）
5. `apps/editor-web/src/classroom-policy-apply.ts`（`!policy.drive.allow` で4ボタンを `hidden`）
6. `packages/classroom-access/src/policy.ts`（default `drive.allow: false`）
7. PR 履歴: #181 / #182 / #183（CTA 文言・baseline push。ボタン削除はしていない）

## 仮説（確度順・要検証）

### H1. パネルがビューポート外へ伸び、内部スクロールが効いていない（最有力）

- `.panel-content` は toolbar 内 `.tool-panel` 起点の `position: absolute; top: calc(100% + 6px)`。
- `max-height: min(70vh, 720px); overflow: auto` があるが、実機で
  - スクロールバーが出ない
  - ホイール/トラックパッドが `#scratch-gui` や backdrop に吸われる
  - タッチで縦スクロールできない
  のいずれかなら、説明文の直下にある `drive-controls` が画面外で「存在しない」ように見える。
- `body/#app { overflow: hidden }` との相互作用を疑う。

### H2. 生徒ポリシーでボタンだけ `hidden`（ステータス文言は残る）

- `/s/{token}` 学生面で `drive.allow === false`（default）のとき、`classroom-policy-apply.ts` が `#connect-google` / `#open-drive` / `#save-drive` / `#disconnect-google` を `hidden` にする。
- `data-testid="drive-panel"` は HTML から既に無く、セクション見出し・help は残る → **「Drive 説明は見えるがボタンが無い」**に一致しうる。
- ユーザーが Community ルート（`/`）か生徒リンク（`/s/...`）かを必ず確認すること。

### H3. ボタンはあるが disabled 灰色で「無い」と誤認

- 未接続・ゲスト・`driveReady` 前は `saveDisabled: true`。
- ただしユーザー報告のステータスは unsynced 系で、ホストなら本来 save は有効なはず。H1/H2 より弱い。

### H4. Railway 未反映 / キャッシュ

- #183 の deploy は失敗しているが、**旧 HTML にも `#save-drive` はある**。ラベル不一致の説明にはなるが、「ボタンが存在しない」の主因にはならない。

## Codex への問い（この順で答えてほしい）

1. **再現手順**を Community `/` と生徒 `/s/{token}` の両方で切り分けよ。どちらで「ボタン無し」になるか。
2. 実 DOM（DevTools）で `#save-drive` の有無、`hidden` / `display` / `disabled`、親 `.panel-content` の `scrollHeight` vs `clientHeight` を記録せよ。
3. H1 が真なら、**最小 CSS/構造修正**を提案せよ（例: ファイルパネルで Drive CTA を説明文より上へ、パネルを viewport 内に clamp、スクロールコンテナの hit-testing 修正など）。実装は方針 GO 後でよい。
4. H2 が真なら、生徒面で Drive を塞ぐのが仕様かバグか、Stage 5 A5（Community ホスト）手順との食い違いを指摘せよ。
5. Railway `#183` Deployment failed の影響範囲（CTA リネーム/自動 baseline push 未反映）を短く整理せよ。今回の「ボタンが無い」とは切り分けた結論を出せ。

## 非ゴール

- local-diagnostics Phase 4 / Transformers.js に触れない。
- Drive concurrency モデルの再設計はしない（本調査は「ボタン到達性」に限定）。
- ユーザーに「下にスクロールして旧ラベルを押せ」とだけ返して閉じない。スクロール不能が報告の核。

## 期待する成果物

台帳 `docs/CURSOR_CODEX_HANDOFF.md` の本案件ログへ:

- `GO`（根因特定 + 修正方針）または `NO_GO`（追加情報が必要なら質問を明示）
- 採用した仮説（H1–H4）と棄却理由
- 推奨パッチのファイル単位概要（Cursor が実装できる粒度）

## 関連 PR / tip

| 項目 | 値 |
|---|---|
| 調査時点 main | `925e1c9`（#183 merge commit） |
| #181 | local save を Drive conflict と誤表示しない |
| #182 | Drive status re-render の文言破壊 + reconnect diverge を unsynced に |
| #183 | リンク作成時 baseline push + CTA リネーム/強調（**Railway deploy failed**） |
| 案件ID | `file-panel-drive-cta-visibility` |
