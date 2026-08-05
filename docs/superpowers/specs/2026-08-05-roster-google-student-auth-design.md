# Syncratch 名簿 Google 生徒認証（設計改定）

**Case ID:** `roster-google-student-auth`

**Status:** `SPEC_REVIEW` — Hermes レビュー待ち

**Date:** 2026-08-05

**Related:**
- 親案件（実装完了）: `docs/superpowers/specs/2026-08-02-classroom-roster-drive-submissions-design.md`（`classroom-roster-drive-submissions`）
- 教室ポリシー / 生徒リンク: `docs/superpowers/specs/2026-07-30-admin-student-access-design.md`
- Local-First 主系: `docs/superpowers/specs/2026-07-19-blocksync-local-first-pivot-design.md`
- 契約パッケージ: `packages/classroom-access`
- Admin DB migration ledger: `apps/collab-host/src/admin-db-migrations/`

**Supersedes（部分）:** `classroom-roster-drive-submissions` 設計 §8（生徒ローカルアカウントを **主路線** とする記述）。本 case は **Google ログイン + Sheet メール照合** を主路線とし、ローカルアカウントは **フォールバック** とする。

**Compatibility constraint:**
- Phase 2 **匿名生徒リンク**（`studentAuth.required === false`）は変更しない。
- Community `/` の Local-First 単独編集（ログイン不要・IndexedDB 正本）は維持する。
- `classroom-roster-drive-submissions` で main 済みの API / UI は、本 case 着手まで **後方互換** を保つ（feature flag OFF 時の挙動を壊さない）。
- 凍結 School track（Person / enrollment RBAC / `r1-persist-server`）は復活させない。

---

## 1. Decision

教室運用レイヤー（名簿・本人確認・提出・Drive）を **Google エコシステム基盤** に統一する。

| レイヤー | 正本 / 手段 | 変更 |
|---|---|---|
| 名簿フィールド | Google Sheet | **`google_email` 列を追加** |
| 生徒本人確認（主） | **Google ログイン + Sheet メール照合** | 新規（現行の enrollment + passphrase から改定） |
| 生徒本人確認（副） | ローカルアカウント（enrollment + passphrase） | **フォールバックとして残す**（教室ポリシーで選択可） |
| メールドメイン制限 | **管理者が教室ごとに設定** | 新規。空 = 制限なし（フリー利用） |
| 提出 SB3 | 教員 Drive（`drive.file`） | 変更なし |
| 編集 WIP | IndexedDB（端末） | 変更なし（Google 正本にしない） |

**Product thesis（ユーザー合意）:** Drive 連携・共同作業・Spreadsheet 名簿を使う教室では、生徒も **Google アカウント前提** とする。生徒に登録コード・パスフレーズ設定などの複雑な操作は **主路線では課さない**。

---

## 2. Problem

### 2.1 現行実装と利用者イメージの乖離

`classroom-roster-drive-submissions` では次を採用した:

- Sheet 列 `login_name` = Syncratch **ローカルログイン ID**（Google メールではない）
- 生徒認証 = enrollment code → passphrase（Google OAuth **非使用**）
- 管理 UI「状態」= ローカルアカウントの activation 状態（「未登録 / ログイン未設定」）

一方、教室運用者（Product Owner）のイメージは:

- Sheet に載せた **Google アカウント（メール）** でそのままログインしたい
- 名簿追加 = その Google アカウントで使えるようになること
- 学校利用時は **学校ドメインのみ** に制限したい
- フリー利用（個人・PoC）は **ドメイン制限なし** で自由に使いたい

### 2.2 現行 UX で起きている混乱

- 「＋ 生徒を追加」で名簿に載ったのに「未登録（ログイン未設定）」のまま → **名簿登録とログイン設定が別概念** であることが伝わりにくい
- Sheet 同期プレビュー（「変更なし / プレビューを適用」）と名簿追加が別操作であることも混同されうる

本 case は **認証モデルの改定** により、名簿（Sheet メール）と本人確認（Google ログイン）を一致させる。

---

## 3. Goals

1. **Sheet `google_email` を名簿と Google 本人確認の結合点**とする。
2. **生徒の主認証**を `Google ログイン → email が roster ミラーと一致` に変更する。
3. **教室管理者**が `allowedEmailDomains` を設定でき、**空 = ドメイン制限なし**（フリー）とする。
4. **ローカルアカウント**（enrollment + passphrase）を **フォールバック** として残し、ポリシーで選択可能にする。
5. **student grant / student identity 分離**（Phase 2 + roster case）は維持する。
6. **WIP = IndexedDB**、**提出 = 教員 Drive**、**Railway SQLite = メタのみ** の正本分離は維持する。
7. feature flag で段階ロールアウトし、flag OFF 時は現行挙動を維持する。

---

## 4. Non-goals

- 凍結 School track の復活。
- 編集中 ProjectDocument / Yjs state の Google 正本化。
- 教員 admin login と生徒 Google login の cookie / セッション統合。
- Classroom API / Gmail scope / Drive 全体検索。
- 児童生徒向け **非 Google** 認証の新規追加（ローカル fallback 以外）。
- 本 design スライスでの **実装**（本 PR は仕様のみ。実装は Hermes GO 後の follow-on PR）。

---

## 5. Architecture — 二層モデル（維持）

```text
┌─────────────────────────────────────────────────────────┐
│ 編集コア（Local-First）                                    │
│  WIP 正本: IndexedDB / ログイン不要の / と匿名リンク可        │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ 任意レイヤ（教室ポリシー ON 時）
┌─────────────────────────────────────────────────────────┐
│ 教室運用（Google ベース）                                   │
│  名簿: Google Sheet (+ google_email)                      │
│  本人確認: Google ログイン + メール照合 + 任意ドメイン制限      │
│  提出: 教員 Drive (drive.file)                            │
│  サーバー: SQLite ミラー・セッション・監査（payload 非保存）   │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Sheet 列契約（改定）

### 6.1 追加列

| 列名 | 必須 | 型 | 説明 |
|---|---|---|---|
| `google_email` | 条件付き※ | string | 生徒の Google アカウントメール。正規化後に roster 照合キー |

※ **Google 主認証が有効な教室**では実質必須。ローカル fallback のみの教室では省略可。

**日本語ヘッダー:** `Google メール`（`ROSTER_SHEET_COLUMN_LABELS` に追加）

### 6.2 既存列 `login_name` の位置づけ

| 列 | 改定後の意味 |
|---|---|
| `login_name` | **ローカル fallback 認証**用 ID。Google 主路線では表示用・互換用。空なら `student_code` |
| `google_email` | **Google 主認証**用。Sheet / インライン追加 / append の照合キー |

`login_name` を Google メールの代用に **しない**（混同防止）。

### 6.3 Import / sync ルール（追加）

- `google_email` は **trim + lowercase** で正規化して保存。
- 同一 `owner_admin_id` + roster 内（または owner 全体 — **要 Hermes 確認 §12 Q1**）で **重複メールは blocking**。
- メール形式バリデーション: 簡易 `@` + domain（RFC 完全準拠は non-goal）。
- CSV / Sheet 同期 / インライン追加フォーム / Sheet append **すべて同列を読み書き**。

### 6.4 定数

- `ROSTER_SHEET_COLUMNS` に `google_email` を追加（順序: `login_name` の後、`group_label` の前を推奨）。
- `canonicalRosterSheetHeader` に日本語エイリアス `Google メール` を追加。

---

## 7. Student access modes（拡張）

既存 `StudentAccessMode` に加え、認証 **方式** をポリシーで指定する。

### 7.1 ClassroomPolicy 拡張（案）

```typescript
studentAuth: {
  required: boolean;           // 既存: roster-login vs shared-anonymous
  method: "google" | "local" | "google-or-local";  // 新規（既定: "google-or-local"）
  allowedEmailDomains: string[];  // 新規（既定: [] = 制限なし）
}
```

| フィールド | 既定 | 意味 |
|---|---|---|
| `required` | `false` | Phase 2 互換。`true` で roster-login |
| `method` | `"google-or-local"` | 主 Google + 副ローカル（移行期推奨） |
| `allowedEmailDomains` | `[]` | **空 = フリー（任意 Gmail 可）**。非空 = サフィックス一致リスト |

**ドメイン比較:** ログインメール `@` 以降を lowercase し、リスト各要素（先頭 `@` なし）と **完全一致**。ワイルドカードは **初版非対応**。

**例:**

| allowedEmailDomains | 許可 | 拒否 |
|---|---|---|
| `[]` | `tarou@gmail.com`（名簿にあれば） | 名簿に無いメール |
| `["school.example"]` | `a@school.example` | `tarou@gmail.com` |

### 7.2 利用シナリオ

| シナリオ | required | method | allowedEmailDomains |
|---|---|---|---|
| 匿名リンク（Phase 2） | false | — | — |
| フリー名簿教室 | true | google-or-local | `[]` |
| 学校正式運用 | true | google | `["○○.ed.jp"]` |
| Google 不可環境（例外） | true | local | — |

---

## 8. Student auth flow（Google 主路線）

### 8.1 フロー

```text
/s/{token}
  → POST /api/student/grant（既存）
  → policy.studentAuth.required ?
       false → エディター（shared-anonymous）
       true  → 認証 UI
  → method が google / google-or-local を含む ?
       → 「Google でログイン」
       → OAuth callback / token exchange
       → ID token から email 取得・検証
       → roster ミラーで google_email 一致 & active ?
            NO → AUTH_FAILED（名簿に無い）
            YES → allowedEmailDomains チェック
            → student identity cookie 発行
  → method が local / google-or-local を含む ?
       → 従来 activate / login UI（フォールバック）
```

### 8.2 student identity セッション

- 既存 `syncratch_student_identity` cookie を **再利用**（中身の根拠が passphrase → Google subject + student_id に変わる）。
- identity は **grant に紐づく rosterId** 上の `student_id` を表す（既存モデル維持）。
- Google `sub`（subject）を SQLite に保存し、再ログイン時の高速照合に使う（**平文メールのみに依存しない**）。

### 8.3 新テーブル / 列（案）

**Option A（推奨）:** `classroom_students` に列追加

| 列 | 型 | 説明 |
|---|---|---|
| `google_email` | TEXT NULL | 正規化メール（Sheet ミラー） |
| `google_subject` | TEXT NULL | 初回 Google ログイン時に確定。UNIQUE(owner_admin_id, google_subject) |

**Option B:** `student_accounts` を Google / local 兼用に拡張

→ migration 複雑。Option A を推奨（Hermes 確認 §12 Q2）。

### 8.4 ローカル fallback（縮小）

- 既存 `student_accounts` / enrollment / passphrase **API は削除しない**。
- `method === "local" | "google-or-local"` のときのみ UI 表示。
- 新規教室の **推奨既定**は `google-or-local`（移行）→ 将来 `google` へ。

---

## 9. Google OAuth boundaries（改定）

現行 3 境界に **4 つ目** を追加する。

| セッション | Cookie / 経路 | Scope | 用途 |
|---|---|---|---|
| Admin login | `syncratch_admin_session` | OpenID（ID token） | `/admin` |
| Teacher credential | server SQLite | `drive.file` | Sheet / 提出フォルダ |
| Editor Drive | `syncratch_drive_session` | `drive.file` | 個人 Drive 保存 |
| **Student Google identity** | **`syncratch_student_google`** または callback 経由で identity 発行 | **`openid` + `email`**（**`drive.file` 不含**） | 名簿照合・identity 確立 |

**禁止（維持）:** 教員 credential に Gmail / Classroom scope。Student identity OAuth で Drive 全体アクセスを取らない。

**分離:** 生徒が作品を自分 Drive に保存したい場合は、**既存 Editor Drive 連携**（別 UI・別 cookie）とする。名簿ログインと混同しない。

---

## 10. Admin UI 改定

### 10.1 教室ポリシー（`/admin` 教室設定）

- **生徒認証方式:** `Google / ローカル / 両方`（=`method`）
- **許可ドメイン:** タグ入力（空 = 制限なし）。例: `school.example`
- ヘルプ: 「空のまま = 個人 Gmail も可。学校運用では学校ドメインを追加」

### 10.2 名簿ペイン

| 項目 | 改定 |
|---|---|
| Sheet テンプレ / CSV | `Google メール` 列追加 |
| インライン追加フォーム | `Google メール` 入力欄追加 |
| 状態バッジ | **「名簿一致 / ログイン済」** 等、Google 主路線の語彙に変更 |
| 初回登録列 | Google identity 確立日時 |

**廃止する案内:** 「登録コードを発行してください」のみが主導線、という UX。

### 10.3 教員 admin allowlist との関係

- 教員 `/admin` ログイン allowlist（`AdminAuthConfig.allowlist`）と、生徒 `allowedEmailDomains` は **別設定**（混同禁止）。

---

## 11. Feature flags（案）

| Flag | Env | 依存 | 説明 |
|---|---|---|---|
| `rosterGoogleStudentAuthEnabled` | `SYNCRATCH_ROSTER_GOOGLE_STUDENT_AUTH_ENABLED` | `classroomRosterEnabled`, `studentLocalAuthEnabled` | Google 主認証 UI + API |

- flag OFF: 現行ローカル認証のみ（現 main 挙動）。
- flag ON + policy.method 許可: Google ログイン UI 有効。

**validateClassroomFeatureFlagDependencies** に依存チェーン追加。

---

## 12. Open questions（Hermes レビュー用）

| ID | 論点 | 提案 | 代替 |
|---|---|---|---|
| Q1 | `google_email` 一意性スコープ | `UNIQUE(owner_admin_id, google_email)` | roster 単位 UNIQUE |
| Q2 | Google `sub` 保存場所 | `classroom_students.google_subject` | `student_accounts` 拡張 |
| Q3 | 初版 `method` 既定 | `google-or-local`（移行） | 即 `google` のみ |
| Q4 | Student OAuth callback URL | `/api/student/auth/google/callback` | 教員 callback 共用（**非推奨**） |
| Q5 | Sheet 既存教室の移行 | `google_email` 空行は Google ログイン不可、local fallback | 強制移行モード |
| Q6 | identity cookie 名 | 既存 `syncratch_student_identity` 継続 | 新 cookie 名 |

---

## 13. Implementation plan（Hermes GO 後・概要）

| PR | 内容 | 依存 |
|---|---|---|
| G1 | 契約: `google_email` 列、policy 型、migration、`classroom-access` | — |
| G2 | collab-host: roster import/sync/inline add + `google_email` | G1 |
| G3 | Student Google OAuth（openid+email）+ roster 照合 + identity | G1, G2 |
| G4 | Admin UI: ポリシー（ドメイン・method）+ 名簿 UI + 状態表示 | G2, G3 |
| G5 | ローカル fallback 整理、DEPLOYMENT.md、回帰テスト | G3, G4 |

各 PR: feature flag OFF 互換、Gate 0、Hermes 決裁、**自動マージ禁止**。

---

## 14. Verification（設計受け入れ — 実装 PR 用）

実装フェーズで満たす条件（設計レビュー時点では **仕様の完全性** で判定）:

1. Phase 2 匿名リンク + 全 flag OFF が現行と同一。
2. `allowedEmailDomains: []` で個人 Gmail が通る（名簿一致時）。
3. 非空ドメインリストで outsiders 拒否。
4. Sheet / CSV / inline / append が `google_email` を一貫读写。
5. Student Google OAuth が `drive.file` を要求しない。
6. ローカル fallback が `method` で OFF にできる。
7. Railway SQLite に refresh token / passphrase 平文を増やさない（Google student flow も token 最小保存）。

---

## 15. Relationship to parent case

| 項目 | `classroom-roster-drive-submissions` | 本 case |
|---|---|---|
| 状態 | COMPLETE（PR 1–8） | SPEC_REVIEW |
| Sheet 同期 / 提出 / 教員 OAuth | 実装済み | 利用（変更最小） |
| 生徒認証 | ローカル主 | **Google 主 + local fallback** |
| Sheet 列 | 6 列 | **7 列（+google_email）** |

親設計 §8「Google OAuth は使わない」は、**生徒 identity 確立**に限り本 case で **改定**する。教員 `drive.file` 境界は維持。

---

## 16. Summary for Hermes

**判定依頼:** 本設計を `roster-google-student-auth` の実装前仕様として **GO / NO-GO**。

**期待する Hermes 確認観点:**
- Phase 2 / flag OFF 互換
- OAuth scope 境界（第 4 境界の openid+email）
- `google_email` 列契約と DB 一意性（Q1–Q2）
- フリー（空ドメイン）vs 学校（ドメインリスト）のポリシーモデル
- ローカル fallback 縮小方針
- PR 分割（§13）の粒度

**禁止:** 本 design PR のマージを「実装完了」とみなすこと。実装は別 PR 群。
