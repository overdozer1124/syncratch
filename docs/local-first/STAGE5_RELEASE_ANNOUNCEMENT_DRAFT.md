# Syncratch Local-First Stage 5 リリース告知（ドラフト）

> **ステータス: DRAFT — ユーザー承認前。公開・配信・デプロイ操作は行わない。**

| 項目 | 値 |
|---|---|
| ドラフト版 | 2026-08-02 |
| 対象 | Community 版 Syncratch（シンクラッチ） |
| 検証 URL | https://syncratch-production.up.railway.app/ |
| 受け入れ根拠 | `FINAL_ACCEPTANCE_REPORT.md` / `STAGE5_MANUAL_GATES.md` §C.1.2 |
| main tip（告知起草時） | `9685439` 以降 |

---

## 公開用見出し（案）

**Syncratch Community 版：Local-First 基盤の Stage 5 受け入れを完了しました**

---

## 本文（案）

Syncratch（シンクラッチ）Community 版について、Local-First ロードマップ **Stage 5** の受け入れ試験を完了しました。  
本告知が示すのは **ブラウザ上の作品編集・保存・共同編集・Google ドライブ連携** までを対象とした基盤の完成です。

### このリリースでできること

- **ログインなしで作品を作る** — Google アカウントがなくても、ブラウザだけで Scratch 作品の作成・編集ができます。
- **このパソコンへの自動保存** — 編集内容は端末内（IndexedDB）に保存され、ページを開き直しても作品が残ります。
- **作品ファイル（.sb3）の書き出し** — 「作品ファイルをダウンロード」で `.sb3` を取得できます。
- **Google ドライブ連携（任意）** — 接続したい人だけ「Google とつなぐ」から始められます。権限は Google 推奨の **`drive.file`**（アプリが作成・選択したファイルのみ）に限定しています。
- **いっしょに作る（P2P 共同編集）** — リンクを作った人（ホスト）が Google ドライブへの保存役です。ゲストはローカル保存のみで、ホストの Drive 作品を上書きしません。
- **切断・競合・権限変更への耐性** — 友だちとの接続が切れても、ローカル作品と `.sb3` は使えます。Drive 側の内容が外から変わった場合は、黙って上書きせず競合を知らせます。Google 連携を外しても、このパソコンへの保存は続きます。

### まだ含まれないもの（告知で誤解しないため）

以下は **Stage 5 の範囲外** です。本リリース告知に「全部そろった」とは書きません。

| 区分 | 状態 |
|---|---|
| **AI 作品診断（local-diagnostics）** | Milestone A まで main 済み。**Phase 4（Transformers.js 等）・外部 AI への成人向け分離は未着手** |
| **AI にきく（助言）** | 試作として存在するが、Stage 5 完了の定義には含めない |
| **中央バックアップ / 大規模 room** | 対象外 |
| **TURN サーバー** | 未提供。学校ネットワーク等の厳しい NAT では、共同編集の P2P 接続が失敗する場合があります（ローカル編集は継続） |
| **Drive の厳密分散ロック** | best-effort。競合検知と明示保存で安全側に倒す設計 |
| **Apps Script 教室アダプタ** | 未導入（未設定でも Community は動作） |
| **School Server 本流化** | 別 track。buildable のまま凍結 |

### 先生・管理者の方へ

- 生徒向けリンク（`/s/{token}`）は **ClassroomPolicy** で Drive・共同編集の可否を制御します。共同編集を有効にしたリンクでは、ホスト向け Drive 保存 UI が表示されます。
- 検証用の生徒リンク URL や token を公開資料に載せないでください。必要なら管理画面（`/admin`）から再発行してください。

### 使い方

1. https://syncratch-production.up.railway.app/ を開く  
2. そのまま作品を作る（Google 連携は任意）  
3. 「いっしょに作る」で友だちを招待する場合は、**リンクを作った端末**が Drive 保存役になる点に注意  

保存状態は画面上部のステータスアイコン（マウスを乗せると説明が出ます）で確認できます。

---

## 短い告知（SNS / お知らせ1段落用・案）

Syncratch Community 版で、Local-First 基盤の Stage 5 受け入れが完了しました。ログインなしの編集、端末内保存、`.sb3` 書き出し、任意の Google ドライブ連携（`drive.file`）、ホスト限定の Drive 保存付き共同編集までを本番で確認済みです。**AI 作品診断の Phase 4 以降や TURN 等は今回の範囲外**です。詳細: https://syncratch-production.up.railway.app/

---

## 内部メモ（公開文にそのまま載せない）

- ローカル保存完了メッセージは sr-only + アイコン tooltip 設計（「このパソコンに保存しました」はホバーで確認）
- 受け入れ記録: `docs/local-first/STAGE5_MANUAL_GATES.md` §C.1.2
- 禁止事項（本ドラフト作業時）: 公開配信、追加 deploy、git 履歴 scrub、token 再掲、AI Phase 4 着手

---

## 承認チェックリスト（ユーザー）

- [ ] スコープ表現（Local-First 完了 vs AI Milestone A 止まり）が意図どおりか
- [ ] 既知の限界（TURN / NAT / Drive best-effort）のトーンが許容範囲か
- [ ] 公開チャネル（ブログ / リリースノート / SNS）を決定
- [ ] 承認後にのみ公開・配信する
