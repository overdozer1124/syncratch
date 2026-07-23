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

### A5. 通常時は logical leader だけが Drive スナップショットを試みる

1. A をホスト、B を招待 URL で共同編集に入れる（Drive 連携ありの構成）。
2. 双方の UI で leader / follower（または同等の役割表示）を確認する。
3. 通常編集中、follower 側が勝手に Drive へ連続書き込みしないこと。
4. leader 側の通常保存パスだけが Drive 更新を担うこと。

**合格:** best-effort の logical single writer として振る舞う。  
厳密な分散ロック保証は対象外（失敗してもローカルは守る）。

### A6. 権限取り消し後もローカル保存と SB3 は続く

1. A が Drive に保存できる状態にする。
2. Drive / 共有設定で A または B のファイル権限を外す（またはトークン失効を模擬）。
3. 権限を失った側で編集を続ける。
4. Drive 書き込みは失敗または停止すること。
5. 「このパソコンに保存しました」と `.sb3` ダウンロードは使えること。
6. 別ファイルへ自動退避しないこと。

**合格:** Drive だけ劣化する。ローカル正本と export は維持。

### A7. 同時 Drive 変更で安全に競合停止する

1. 同じ Drive ファイルを、可能な範囲で2経路から更新する  
   （例: 別セッション / Drive 上で直接差し替え / 競合を起こす制御された更新）。
2. クライアントが競合または split-brain 疑いを検出すること。
3. 自動 Drive 保存が止まること。
4. 黙って上書きしないこと。別ファイルを自動作成して逃げないこと。
5. ローカル copy と利用可能な Drive revision が残り、利用者確認後だけ再保存できること。

**合格:** 競合時は自動保存停止 + 保持 + 明示確認。  
（自動証跡: `collab-session` conflict 試験。本項目は実 Drive での目視が必須。）

---

## B. Failure / privacy（人手確認が残る項目）

自動証跡がある項目は `RELEASE_CHECKLIST.md` 側に記載済み。  
ここでは **ブラウザ実機で残す確認** だけを書く。

### B1. peer 切断後、未受信変更を「同期済み」と言わない

1. ホストとゲストで共同編集を開始する。
2. ゲスト側タブを閉じる、またはネットワークを切る。
3. ホスト側 UI が、切断ゲストの未確認変更を保存済み／同期済みと主張しないこと。
4. ホストのローカル保存と `.sb3` は継続できること。

### B2. Apps Script を無効にしても Community が動く

Apps Script 教室アダプタを使っている場合のみ:

1. エンドポイントを外す、またはデプロイを停止する。
2. 単独編集・招待 URL・既存 P2P・Drive・export が使えること。
3. 名簿 / 教室招待だけが degraded であること。

未導入なら「未設定でも起動できる」ことを確認し、合格とする。

### B3. トークンが永続成果物に残っていない（実機検査）

Drive 連携後に次を確認する（DevTools / ダウンロードファイル）:

| 場所 | 確認 |
|---|---|
| IndexedDB（当該 origin） | access / refresh / Picker token 文字列が無い |
| ダウンロードした `.sb3` | 同上（バイナリ内検索でも可） |
| 画面ログ / console | token を吐き出していない |
| signaling フレーム（WS） | offer/answer/ICE と短命 room 情報のみ。作品本文なし |

**合格:** トークンはメモリ上のセッションに留め、永続成果物へ書かない。  
（自動証跡: google-drive-sync が token を memory のみ保持。本項目は実機サンプル検査。）

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
A4 Two users same file:       未実施
A5 Leader-only Drive write:   未実施
A6 Revoke keeps local/SB3:    未実施
A7 Conflict safe stop:        未実施

B1 Peer disconnect honesty:   未実施
B2 Apps Script disabled OK:   PASS — Apps Script 未導入（未設定で Community 動作 = 合格）
B3 No persisted tokens:       未実施（実機 DevTools 検査）

総合: Stage 5 手動ゲート 未完了（Drive ハッピーパスまでは完了）
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
