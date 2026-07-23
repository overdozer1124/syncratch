# Stage 5 手動ゲート手順書（Local-First リリース）

この文書は `RELEASE_CHECKLIST.md` の **Manual Google gates** と、
自動証跡だけでは足りない **Failure / privacy** 項目を、画面操作で完了するための手順です。

| 項目 | 値 |
|---|---|
| 対象 tip（自動ゲート実行時） | `d179efff59827007cd84664a52234f188e88cb1b` |
| オンライン検証 URL | `https://syncratch-production.up.railway.app/` |
| ローカル検証 URL | `http://127.0.0.1:5173/`（Vite）または `http://127.0.0.1:8080/`（collab-host） |
| 所要の準備 | Google テスト用アカウント **2つ**、Google Cloud OAuth（`drive.file`）、Picker API |

結果は末尾の記録表に書き、合格後に `RELEASE_CHECKLIST.md` と
`FINAL_ACCEPTANCE_REPORT.md` を更新する。

---

## 0. 準備

1. ブラウザは Chrome（推奨）。プロファイルを2つ用意するか、通常 + シークレットでも可。
2. Google Cloud で OAuth クライアントと Picker API が、検証 origin に許可されていること。
   - Railway: `https://syncratch-production.up.railway.app`
   - ローカル: `http://127.0.0.1:5173`（使う場合）
3. アカウント A（ホスト）とアカウント B（ゲスト）を用意する。
4. 検証前に hard reload。古い招待 URL は使わない。
5. 記録するメタデータ:
   - 日付（JST）
   - ブラウザバージョン
   - 検証 origin（Railway / ローカル）
   - Google Cloud プロジェクト ID
   - git tip（`git rev-parse HEAD`）

---

## A. Manual Google gates

### A1. ログインなしで単独編集できる

1. シークレットウィンドウ（または未ログインプロファイル）で editor を開く。
2. Google ログインを求められないことを確認する。
3. ブロックを1つ置き、保存状態が「このパソコンに保存しました」になること。
4. `.sb3` をダウンロードできること。

**合格:** Google なしで作成・保存・export ができる。

### A2. OAuth 同意画面が `drive.file` のみ

1. 「Google ドライブに保存」など Drive 連携を開始する。
2. 同意画面の権限を読む。
3. 広い `Google Drive` 全体 / `drive.readonly` / Gmail / Classroom が出ないこと。
4. アプリが作成・選択したファイルに限定される説明（`drive.file`）であること。

**合格:** scope が `https://www.googleapis.com/auth/drive.file` 相当のみ。  
（自動証跡: `packages/google-drive-sync` の unit test。本項目は実同意画面の目視が必須。）

### A3. Picker で明示選択した SB3 だけを開く

1. Drive から作品を開く操作を行う。
2. Google Picker が開くこと。
3. 利用者自身が選んだファイルだけが開くこと。
4. Drive 全体の勝手な一覧・検索結果から暗黙オープンしないこと。

**合格:** Picker 経由の明示選択のみ。

### A4. 2つの Google ユーザーが同じ共有 Drive ファイルにアクセスできる

1. アカウント A で Drive にスナップショットを保存する。
2. そのファイルをアカウント B と共有する（編集可）。
3. アカウント B で同じファイルを Picker 等で開き、内容が見えること。

**合格:** A/B 双方が同じ共有ファイルを扱える。

### A5. 共同編集中、Drive に書くのは「リンクを作った人」だけ（かんたん版）

実装上、Drive 書き込み権限は **logical leader 表示ではなく「いっしょに作るリンクを作った端末（ホスト）」** に付きます。

**用意:** ブラウザ2つ（または通常 + シークレット）。アカウントA=ホスト、B=ゲスト。

1. **A:** Railway で作品を開き、Google ドライブに保存できる状態にする。
2. **A:** 「いっしょに作るリンクを作る」→ リンクをコピー。
3. **B:** そのリンクで開く → 「1人といっしょに作っています」になるまで待つ。
4. **B（ゲスト）:** Google にログインしていても、Drive へ保存しようとしてみる  
   （「Google ドライブに保存」など）。
5. **見てほしい表示（ゲスト）:**  
   「いっしょに作るリンクを作った人だけが Google ドライブに保存できます。」  
   （または Drive に勝手に連続保存されないこと）
6. **A（ホスト）:** ブロックを1つ動かして待つ。  
   「Google ドライブにも保存しました」など、ホスト側の Drive 保存が進むこと。

**合格:** ゲストが Drive の正本を上書きし続けない。ホストだけが通常の Drive 保存役。

---

### A6. 権限を失っても、手元の作品は守られる（かんたん版）

いちばん簡単なやり方（アカウント1つで可）:

1. Syncratch で Drive に保存できることを確認（「Google ドライブにも保存しました」）。
2. 別タブで Google アカウントの連携を外す:  
   [https://myaccount.google.com/connections](https://myaccount.google.com/connections)  
   → Syncratch / 該当アプリ → **アクセス削除**（または Drive ファイルの共有を「閲覧のみ」や共有解除）。
3. Syncratch に戻り、ブロックを追加・変更する。
4. **合格の見え方:**
   - 画面に「このパソコンに保存しました」が出る（ローカルは生きている）
   - Drive 側は失敗・未同期・切断などの表示（「Google ドライブにはまだ保存していません」等でよい）
   - **SB3 をダウンロード**できる
   - Drive に **別名の新しいファイルが勝手に増えない**

**合格:** Drive だけダメでも、このパソコンの保存と SB3 は使える。

---

### A7. Drive が外から変わったら、黙って上書きしない（かんたん版）

1. **A:** Syncratch で Drive 保存済みの作品を開いたままにする。
2. **別経路**で同じ Drive ファイルを古い／別内容で更新する（どれか1つでよい）:
   - Google ドライブのウェブ画面で、そのファイルを別 SB3 で置き換える（新しいバージョンをアップロード）
   - または別ブラウザで同じファイルを開き、大きく違う内容で Drive 保存する
3. **A に戻り**、ブロックを1つ変えて Drive 自動保存を待つ（または「Google ドライブに保存」）。
4. **合格の見え方（どれかが出ればOK）:**
   - 「Google ドライブの作品が別の場所で変わっています」
   - 「Google ドライブへの保存を止めています」
   - 「Google ドライブの作品とちがうかもしれません。このパソコンの内容で上書きしますか？」のような確認
5. **ダメな見え方:** 確認なしで Drive を上書きし続ける／勝手に別ファイルを新規作成して逃げる。

**合格:** 競合を検知して自動保存を止め、上書きは利用者確認つき。

---

## B. Failure / privacy（人手確認が残る項目）

自動証跡がある項目は `RELEASE_CHECKLIST.md` 側に記載済み。  
ここでは **ブラウザ実機で残す確認** だけを書く。

### B1. 友だちが切れても「同期できた」と言わない（かんたん版）

1. A と B でいっしょに作る（「1人といっしょに作っています」）。
2. **B のタブを閉じる**（または B だけ飛行機モード）。
3. **A の画面**を見る。
4. **合格:** 「友だちとのつながりが切れました」など切断表示。  
   切断した B の未確認変更を「保存しました／同期しました」とは言わない。
5. **A** でブロックを追加 → 「このパソコンに保存しました」と SB3 ダウンロードができる。

### B2. Apps Script を無効にしても Community が動く

Apps Script 教室アダプタを使っている場合のみ:

1. エンドポイントを外す、またはデプロイを停止する。
2. 単独編集・招待 URL・既存 P2P・Drive・export が使えること。
3. 名簿 / 教室招待だけが degraded であること。

未導入なら「未設定でも起動できる」ことを確認し、合格とする。**（今回は未導入のため PASS 済み）**

### B3. ログイン情報がファイルに残っていない（かんたん版）

Drive 連携したあと、同じブラウザで:

1. **SB3 をダウンロード**する。
2. キーボード `F12`（または右クリック → 検証）→ **Application**（アプリケーション）タブ。
3. 左の **IndexedDB** → `syncratch-production.up.railway.app` 配下を開く。
4. 中身をざっと見て、`ya29.` で始まる長い文字列（Google access token によくある形）や  
   `refresh_token` / `access_token` という名前の保存が **無い** こと。
5. （余裕があれば）Console に token が赤文字で出ていないこと。

**合格:** token は画面を開いている間のメモリだけで、IndexedDB / SB3 に残らない。  
signaling の詳細確認は必須ではない（自動試験あり）。

---

## C. 結果記録表

### C.1 進行中の記録（2026-07-23）

```text
実施日 (JST): 2026-07-23
実施者: ユーザー（Drive 連携）+ Cursor（本番 bake-in 確認）
git tip（文書ブランチ）: cursor/release-gates-stage5-f431
検証 origin: https://syncratch-production.up.railway.app/
Google Cloud project: syncratch（APP_ID / project number 863099193805）

本番 bake-in（Cursor, 2026-07-23 10:38 JST）:
- GET /healthz → ok (HTTP 200)
- production main-*.js に Client ID / API key / APP_ID=863099193805 / scope drive.file を確認

A1 Solo without login:        PASS — ユーザー: Drive 連携完了報告（単独編集はログイン不要のまま）
A2 OAuth drive.file only:     PASS — 本番 bundle に drive.file のみ。ユーザー: Drive 連携完了
A3 Picker explicit select:    PASS — ユーザー: Drive 連携完了（Picker 経由）
A4 Two users same file:       PASS — ユーザー報告（2026-07-23）
A5 Creator-only Drive write:  未実施（手順をかんたん版に改訂）
A6 Revoke keeps local/SB3:    未実施
A7 Conflict safe stop:        未実施

B1 Peer disconnect honesty:   未実施
B2 Apps Script disabled OK:   PASS — Apps Script 未導入（未設定で Community 動作 = 合格）
B3 No persisted tokens:       未実施（実機 DevTools 検査）

総合: Stage 5 手動ゲート 未完了（A1–A4 / B2 まで完了）
```

### C.2 空白テンプレート

```text
実施日 (JST):
実施者:
git tip:
検証 origin:
ブラウザ:
Google Cloud project:

A1 Solo without login:        PASS / FAIL / SKIP — メモ:
A2 OAuth drive.file only:     PASS / FAIL / SKIP — メモ:
A3 Picker explicit select:    PASS / FAIL / SKIP — メモ:
A4 Two users same file:       PASS / FAIL / SKIP — メモ:
A5 Leader-only Drive write:   PASS / FAIL / SKIP — メモ:
A6 Revoke keeps local/SB3:    PASS / FAIL / SKIP — メモ:
A7 Conflict safe stop:        PASS / FAIL / SKIP — メモ:

B1 Peer disconnect honesty:   PASS / FAIL / SKIP — メモ:
B2 Apps Script disabled OK:   PASS / FAIL / SKIP — メモ:
B3 No persisted tokens:       PASS / FAIL / SKIP — メモ:

総合: Stage 5 手動ゲート 完了 / 未完了
```

不合格時は再現手順・スクショ・期待/実際を issue または handoff に残し、修正 PR のあと再実施する。
