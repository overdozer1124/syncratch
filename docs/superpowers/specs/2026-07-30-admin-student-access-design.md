# Syncratch 管理者 / 児童生徒アクセス分離

**Status:** Draft for review

**Date:** 2026-07-30

**Related:**
- Local-First 主系: `docs/superpowers/specs/2026-07-19-blocksync-local-first-pivot-design.md`
- AI 支援: `docs/superpowers/specs/2026-07-23-ai-advice-assist-design.md`
- 共同編集招待: `packages/collab-invite`（fragment 招待。本仕様の生徒リンクとは別物）
- 凍結 School track: `r1-persist-server` / workspace-directory / roster RBAC（本仕様では復活させない）

**Compatibility constraint:** Community Local-First の単独編集（ログイン不要・IndexedDB 正本・`.sb3` 入出力）は維持する。本仕様は「教室運用向けの任意層」であり、未設定時の現行エディター挙動を壊さない。

## 1. Decision

本番デプロイ（例: `https://syncratch-production.up.railway.app/`）を次の 3 面に分ける。

| 面 | URL | 利用者 | 目的 |
|---|---|---|---|
| 公開トップ | `/` | 誰でも | 製品入口・ログイン導線。編集の自由試用は残してよい |
| 管理者 | `/admin`（要ログイン） | **事前登録アカウントのみ** | 詳細設定と生徒用リンクの発行 |
| 児童生徒 | `/s/{token}` | アカウント不要 | 管理者が固定した設定でのみエディターを使う |

アカウント名をパスに載せる方式（`/{アカウント}/`）は採用しない。テナント境界は URL の人名・スラッグではなく、**登録済み管理者 ID** と **不透明な生徒リンク token** で表す。

## 2. Problem

現状の Community ランタイムでは:

- `/` が全員向けのフルエディターである。
- AI 等の設定はブラウザー `localStorage` にあり、端末ごとに自由に変更できる。
- 共同編集の招待は `#blocksync-collab=…` fragment で「部屋への参加能力」だけを渡し、**管理者ポリシー（設定ロック）は持たない**。
- 学校向け RBAC / 名簿は凍結されており、Community 実行時依存ではない。

教室では「先生が決めた設定だけを生徒に使わせたい」「設定画面や API キーを生徒に触らせたくない」という要求がある。これを Local-First 主系を壊さずに満たす必要がある。

## 3. Goals

1. **管理者だけが詳細設定できる。** 設定 UI・API キー・ポリシー編集は事前登録アカウントのログイン後に限る。
2. **児童生徒用リンクを発行できる。** リンクを開いた利用者は、そのリンクに紐づくポリシーでのみエディターを使える。
3. **生徒側では設定を変更できない。** ポリシーで禁止された機能は UI を出さないか無効化する。localStorage の個人設定で上書きできない。
4. **生徒はアカウント不要。** リンクの知識（token）が入場能力になる。
5. **未登録者は管理者面に入れない。** 公開トップや生徒リンクは利用可。
6. **Local-First の単独編集は維持する。** 管理者層が未導入・未ログインでも、現行どおり `/` で編集できる（後方互換）。

## 4. Non-goals

本仕様の初回スライスには含めない。

- `/{アカウント名}/` や `/{slug}/` によるマルチテナント URL。
- 凍結 School track（Person / roster / class RBAC / `r1-persist-server` 必須化）の復活。
- 児童生徒アカウント、出席、成績、名簿の本格管理。
- 共同編集 fragment 招待の置き換え（併存する。生徒リンクは「設定付き入場」、collab 招待は「部屋参加」）。
- Drive 全体検索、管理者による作品一括取得、中央サーバーへの作品正本保存。
- 生徒リンク経由での課金・利用量課金 UI。
- 複数 IdP、パスワードレス以外の複雑な組織 SSO（初回は許可リスト + 単一 IdP でよい）。

## 5. URL and surface model

### 5.1 `/` — 公開トップ

- 製品の入口。ブランド・短い説明・「管理者ログイン」「試してみる（現行エディター）」への導線を置ける。
- **管理者専用トップにはしない。** 未ログイン訪問者を締め出すと、生徒リンクとの境界が曖昧になり、公開デモも失う。
- 当面は現行フルエディターを `/` に残してよい（開発中のまま可）。将来トップを案内ページに薄くしてもよいが、本仕様の必須ではない。

### 5.2 `/admin` — 管理者面

- ログイン必須。未ログインはログイン導線へ。
- **許可リストに無い主体は拒否**（アカウント自動作成はしない）。
- できること（初回）:
  - 自分の管理者セッションの確認・ログアウト
  - **教室ポリシー**の作成・編集・無効化
  - ポリシーに紐づく **生徒用リンク**の発行・再発行・失効
  - 発行済みリンクの一覧（表示名・作成日・失効状態。token 全文の再表示は再発行時のみでもよい）
- 管理者面の実装完成度は「開発中のままでよい」。本仕様は契約と境界を固定する。

### 5.3 `/s/{token}` — 児童生徒面

- `token` は推測困難な不透明文字列（下記 Security）。
- 有効な token のときだけエディターを起動し、紐づく **ClassroomPolicy** を適用する。
- 無効・失効・不明 token はエラー画面（編集 UI を出さない）。
- 生徒面では管理者設定パネル・API キー入力・ポリシー編集を出さない。

### 5.4 Rejected: `/{account}/`

採用しない理由:

1. 現行は Vite SPA + `BLOCKSYNC_BASE_PATH` 前提で、アカウント名前空間ルーティングが無い。
2. 人名・組織名が URL に載り、改名・衝突・漏洩面が増える。
3. 生徒に「誰のアカウント配下か」を意識させる必要がない。
4. テナント分離は token / admin id で足りる。

## 6. Actors and auth

### 6.1 AdminAccount（事前登録）

| フィールド（論理） | 説明 |
|---|---|
| `adminId` | 安定 ID |
| `subject` | IdP の安定 subject（例: Google `sub`） |
| `email` | 表示・許可リスト照合用（正規化済み） |
| `displayName` | 任意 |
| `status` | `active` \| `disabled` |
| `createdAt` / `updatedAt` | 監査用 |

- 新規管理者は **運用者が許可リストへ追加**して初めてログインできる。自己登録フォームは持たない。
- 初回 IdP は既存の Google OAuth 面を流用してよい（Drive 用 OAuth とセッションを混同しないこと。管理者セッションは別 cookie / 別 scope 境界を推奨）。
- `disabled` またはリスト外は `/admin` を拒否する。

### 6.2 Student (anonymous)

- 永続アカウントを持たない。
- 能力は「有効な `/s/{token}` を知っていること」のみ。
- 表示名が必要な共同編集では、現行どおりローカル表示名を使ってよい（ポリシーで禁止しない限り）。

### 6.3 Session

- 管理者: サーバー発行セッション（HttpOnly cookie 推奨）+ CSRF 対策。
- 生徒: 原則セッション不要。token 解決で得たポリシーをクライアントが適用する。必要なら短命の「policy grant」cookie を使ってもよいが、token を query に残し続けない（Referer 漏洩対策。初回解決後は path のみ、または置換）。

## 7. ClassroomPolicy（設定ロックの正本）

管理者が定義し、生徒リンクが参照する設定束。

### 7.1 初回に含める項目

| キー | 型 | 意味 |
|---|---|---|
| `policyId` | string | 安定 ID |
| `ownerAdminId` | string | 所有管理者 |
| `title` | string | 管理画面用表示名（生徒に見せなくてもよい） |
| `status` | `active` \| `disabled` | disabled なら紐づくリンクも無効 |
| `aiAssist.enabled` | boolean | AI 支援の可否 |
| `aiAssist.level` | 0–6 または subset | 許可レベル上限（既存 AI 仕様に整合） |
| `aiAssist.allowStudentApiKey` | boolean | 既定 `false`。生徒が自分の API キーを入れることを許すか |
| `editor.showSettingsPanel` | boolean | 既定 `false`（生徒）。管理者は常に可 |
| `editor.allowSb3Export` | boolean | `.sb3` 書き出し |
| `editor.allowSb3Import` | boolean | `.sb3` 読み込み |
| `collab.allow` | boolean | 共同編集開始・参加 UI |
| `drive.allow` | boolean | Drive 連携 UI |
| `createdAt` / `updatedAt` | timestamp | |

サーバー側で管理者の API キーを預かる場合の扱いは **Follow-up**（下記）。初回は「AI を許可するなら管理者がホスト側にプロキシ用キーを設定する」または「AI を生徒リンクではオフ」のどちらでもよく、**生徒 localStorage へのキー入力を既定禁止**とする。

### 7.2 適用規則（生徒面）

1. `/s/{token}` 解決で得たポリシーが唯一の設定ソースになる。
2. `blocksync.ai-assist.settings.v1` 等の localStorage 値は、ポリシーと矛盾する範囲で **無視または上書き不可**。
3. ポリシーで `enabled=false` の機能は UI 非表示または disabled。バイパス用の隠しパネルを出さない。
4. ポリシー更新後、新規ロードした生徒クライアントは新ポリシーを得る。既に開いているタブの即時強制は best-effort（初回はリロードで反映で可）。

### 7.3 管理者面での編集

- 管理者は自分の `ownerAdminId` のポリシーだけ CRUD できる（他管理者のポリシーは見えない／触れない）。
- 共有オーガニゼーション権限は非目標（School track へ委譲）。

## 8. StudentLink（児童生徒用リンク）

### 8.1 モデル

| フィールド（論理） | 説明 |
|---|---|
| `linkId` | 安定 ID |
| `policyId` | 参照する ClassroomPolicy |
| `token` | 不透明な高エントロピー秘密（URL に載る） |
| `label` | 管理画面用（例:「3年A組 5/12」） |
| `status` | `active` \| `revoked` |
| `expiresAt` | 任意。過ぎたら無効 |
| `createdAt` / `revokedAt` | |

公開 URL: `{origin}/s/{token}`

### 8.2 ライフサイクル

1. 管理者がポリシーを選び「リンク作成」→ token 生成 → URL を一度表示・コピー可能にする。
2. 再発行: 旧 token を `revoked` にし、新 token を発行（授業の切り替わり・漏洩時）。
3. 失効: `revoked` またはポリシー `disabled`、または `expiresAt` 超過。
4. 一覧: label / 状態 / 有効期限。token の恒久表示は必須ではない。

### 8.3 共同編集招待との関係

| | StudentLink `/s/{token}` | Collab invite `#blocksync-collab=` |
|---|---|---|
| 目的 | 設定ロック付き入場 | 部屋参加能力 |
| 秘密の置き場 | path token（サーバーが解決） | URL fragment（サーバーに送らない） |
| 設定 | ClassroomPolicy | なし |
| 併存 | 可。生徒面で collab が許可されていれば、従来どおり fragment 招待を発行・参加できる |

生徒リンクが collab の room/secret を兼ねる必要はない（初回は分離）。将来「1 リンクで部屋 + ポリシー」を足す場合は別スライスとする。

## 9. Runtime architecture

現行スタック（Vite SPA + `collab-host`）を前提とする。Next.js やアカウントスラッグ router は導入しない。

```text
Browser
  ├─ /              → 公開トップ / 現行エディター（互換）
  ├─ /admin         → 管理者 SPA 面（要 Admin session）
  └─ /s/:token      → 生徒 SPA 面（token → policy 解決後に editor）

collab-host (or thin admin API)
  ├─ Admin auth     → allowlist + session
  ├─ Policy CRUD    → 永続化（下記）
  ├─ Link CRUD      → token 発行・失効
  └─ GET policy-by-token → 生徒面用（秘密に足りる最小フィールドのみ返す）
```

### 9.1 永続化

初回は次のいずれかでよい（実装計画で dual を避けるため一つに決める）:

- **A. ホストローカル SQLite（推奨候補）** — 単一 Railway デプロイ向け。管理者・ポリシー・リンクのみ。作品正本は置かない。
- **B. 環境変数 / ファイルの許可リスト + ホスト KV** — 極小構成。スケールしないが試作向き。

作品・Yjs・Drive は従来どおり。ポリシー DB にプロジェクト payload を入れない。

### 9.2 クライアント適用ポイント

- `apps/editor-web` 起動時に「モード」を決定: `community`（現行）| `admin` | `student`。
- `student` モードは policy grant を読み、AI / 設定 / Drive / collab の各 UI インストーラに制約を渡す。
- Community モードは現行どおり localStorage 設定を使う（回帰禁止）。

## 10. Security

1. **token エントロピー:** 少なくとも 128 bit 相当の暗号論的乱数（例: 16+ bytes → base64url）。連番・短いクラスコードのみは不可（別用途なら rate limit 付きの短いコードを将来検討）。
2. **許可リスト:** 管理者の自己登録禁止。リスト外 Google ログイン成功でも `/admin` API は 403。
3. **秘匿分離:** 生徒向け `policy-by-token` レスポンスに、管理者 API キー・他リンクの token・他管理者メールを含めない。
4. **Referer / ログ:** access log に raw token を残さない工夫（ハッシュ化ログ）、または短命 grant へ交換して URL から token を落とす。
5. **XSS:** 生徒面でも管理者キーが DOM/localStorage に載らないこと。
6. **混同禁止:** Drive OAuth セッションを管理者権限とみなさない。管理者セッション cookie 名と path を分ける。
7. **失効の即時性:** revoke 後の `policy-by-token` は失敗する。クライアントキャッシュを持つなら短い TTL。

## 11. UX outline

### 11.1 管理者（開発中で可）

1. `/admin` → ログイン（許可リスト）
2. ポリシー一覧 / 新規
3. トグル類（AI 可否、設定パネル、sb3、Drive、collab）
4. 「生徒リンクを作成」→ URL 表示 → コピー
5. リンクの失効 / 再発行

### 11.2 児童生徒

1. 配布された URL を開く
2. エディターがそのまま起動（余分なダッシュボードやカード群を置かない）
3. ポリシーで許された操作だけが見える
4. 設定変更や API キー入力は出ない（既定）

### 11.3 エラー

| 状況 | 表示 |
|---|---|
| token 不明 / 失効 / 期限切れ / ポリシー disabled | 「このリンクは使えません」＋管理者へ連絡の案内 |
| 管理者ログイン失敗（リスト外） | 「このアカウントは管理者として登録されていません」 |
| 管理者 API 401 | 再ログイン |

## 12. Phased delivery

### Phase 0 — 仕様と契約（本ドキュメント）

- URL 面、ポリシー項目、リンク寿命、非目標を固定する。

### Phase 1 — 最小実装

- Admin allowlist + ログイン
- Policy / StudentLink の永続化と API
- `/admin` の最小 UI（設定 + リンク発行）
- `/s/{token}` で policy 適用付きエディター
- AI / 設定パネルのロック（最優先の教室価値）

### Phase 2 — 運用品質

- リンク失効・再発行・有効期限
- ログの token 秘匿
- 生徒面からの grant 交換（URL 秘匿強化）
- ポリシー項目の追加（拡張機能など）

### Phase 3 — 任意の発展（別仕様）

- 管理者ホスト API キーによる生徒 AI プロキシ
- 生徒リンクと collab 部屋の一体発行
- 複数教師の共有ワークスペース（School track との接続）

## 13. Testing requirements

- Allowlist: リスト内のみ `/admin` API 成功。リスト外は 403。
- Link resolve: active token → 期待ポリシー。revoked / expired / unknown → 失敗。
- Student mode: ポリシー `aiAssist.enabled=false` のとき AI UI が出ない／呼べない。localStorage に enabled=true を書いても無視。
- Community mode: `/` は従来どおり設定変更可（回帰）。
- Token: 生成エントロピーと revoke 後の拒否。
- 生徒 API レスポンスに秘密フィールドが混入しないこと。

## 14. Open questions

実装前に決める事項（本仕様の採用後、計画書でクローズする）。

1. 管理者 IdP を Google のみに固定するか。
2. 永続化を SQLite (A) と極小 KV (B) のどちらにするか。
3. 生徒 AI を「常にオフ」「管理者プロキシキー」「（例外）生徒キー許可」のどれを既定にするか。
4. `/` を案内ページ化するタイミング（Phase 1 では現行エディター維持でよいか）。

## 15. Summary

- **管理者面**は事前登録アカウント専用の `/admin`。
- **児童生徒**はアカウント不要の `/s/{token}` で、ClassroomPolicy により設定固定。
- **`/{アカウント}/` は採用しない。**
- **Local-First Community の `/` 編集は維持**し、教室層は任意追加とする。
- 共同編集 fragment 招待とは役割を分けて併存させる。
