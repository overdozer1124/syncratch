# Syncratch 教室名簿・Drive 提出（Community 拡張）

**Case ID:** `classroom-roster-drive-submissions`

**Status:** Phase 0 — PR 1 foundation spec (contracts / migration ledger / feature flags / import gate only)

**Date:** 2026-08-02

**Related:**
- 教室ポリシー / 匿名生徒リンク: `docs/superpowers/specs/2026-07-30-admin-student-access-design.md`（Phase 2 実装済み）
- Local-First 主系: `docs/superpowers/specs/2026-07-19-blocksync-local-first-pivot-design.md`
- Admin DB migration ledger パターン: `apps/collab-host/src/admin-db-migrations/`（Phase 2 baseline + 本 case foundation）
- 契約パッケージ: `packages/classroom-access`
- 凍結 School track: `r1-persist-server` / workspace-directory / roster RBAC（本仕様では復活させない）

**Compatibility constraint:** Phase 2 admin-student-access の **匿名生徒リンク**（`/s/{token}` → grant 交換 → ClassroomPolicy 適用）は、本 case の **全 feature flag が OFF** のとき **挙動・URL・cookie 名を一切変更しない**。Community Local-First の単独編集（ログイン不要・IndexedDB 正本・`.sb3` 入出力）も維持する。本仕様は「教室運用向けの任意層」であり、未設定時の現行エディター挙動を壊さない。

## 1. Decision

Community 教室運用に、次の 4 正本を **役割分担** して追加する。

| 正本 | 置き場 | 保持するもの |
|---|---|---|
| 名簿フィールド | **Google Sheet**（教員が編集） | `student_code`, `display_name`, `attendance_number`, `login_name`, `group_label`, `active` |
| 認証・提出メタデータ | **Railway SQLite**（`ADMIN_DB_PATH`） | 名簿ミラー、生徒ローカルアカウント、提出一覧・監査、Sheet 同期状態 |
| 提出 `.sb3` | **Google Drive**（教員アカウント、`drive.file` のみ） | 生徒が提出した SB3 ファイル本体 |
| 編集中作品 | **IndexedDB**（端末ローカル） | WIP プロジェクト。提出前の正本は従来どおり端末内 |

生徒の入場は Phase 2 と同様 **StudentLink token** が起点とする。名簿ログインが有効なポリシーでは、token 解決（**student grant**）の後に **student identity** セッションで「誰として提出するか」を確定する。

Google OAuth は **既存の `drive.file` scope のみ** を要求する。Drive 全体検索、readonly 拡張、Classroom API、Gmail 等は採用しない。教員用 OAuth（Sheet 読取・提出フォルダ作成）と、生徒用 Drive 連携（既存 editor クライアント）は **別 cookie / 別 API 境界** とする。

ロールアウトは **8 PR** に分割し、**全 feature flag は既定 OFF**。PR 1 は契約・DB migration ledger・flag 定義・CSV/XLSX 安全ゲートのみとし、**UI / API の有効化は行わない**。

## 2. Problem

Phase 2 admin-student-access では:

- 管理者は ClassroomPolicy と匿名 `/s/{token}` を発行できる。
- 生徒はアカウント不要で、リンクの policy ロック下で編集できる。
- 作品の WIP は IndexedDB、任意の Drive 保存は各利用者の `drive.file` 連携に委ねる。

教室現場では追加で:

- **誰が誰の作品か** を教員が把握したい（匿名リンクだけでは提出物の名寄せができない）。
- **名簿** は学校が既に Google スプレッドシートで管理していることが多い。
- **提出** は教員の Drive フォルダへ `.sb3` を集約したいが、作品 payload を Railway SQLite に正本保存したくない。
- **生徒ログイン** はフル IdP ではなく、配布コード + パスフレーズ程度の軽量さが欲しい。

凍結 School track（Person / enrollment / workspace RBAC）を Community runtime に戻すのではなく、Phase 2 の匿名リンクモデルの上に **任意で** 名簿・認証・提出を載せる必要がある。

## 3. Goals

1. **Google Sheet を名簿フィールドの正本**とし、列契約を固定する。
2. **Railway SQLite にミラー**（名簿・ローカルアカウント・提出メタ・監査）を持ち、Sheet / Drive 本体は置かない。
3. **生徒ローカルアカウント**: 初回は enrollment code、以降は passphrase（`login_name` + パスフレーズ）で認証できる。
4. **student grant と student identity を分離**する。grant は Phase 2 どおりリンク由来の policy 入場。identity は roster 上の `student_id` を表す別セッション。
5. **提出 `.sb3` は教員 Drive**（`drive.file` で教員が選択・作成したフォルダ）へ保存し、SQLite にはメタデータと content SHA のみ。
6. **WIP は IndexedDB 正本**のまま。提出は明示操作でのみ Drive へコピーする。
7. **8 PR + feature flag** で段階的に有効化でき、flag OFF 時は Phase 2 と Community `/` が回帰しない。
8. **PR 1** で契約・migration ledger・flag・CSV/XLSX ゲートを先に固定し、後続 PR の API/UI 実装の土台にする。

## 4. Non-goals

本 case 全体の初回スライス（および PR 1）に含めない。

- 凍結 School track（`r1-persist-server`、workspace-directory RBAC、Person/enrollment モデル）の復活。
- `/{アカウント名}/` マルチテナント URL。
- Drive 全体検索、教員による Drive 内一括検索 UI、readonly / 広域 Drive scope。
- 作品 payload の Railway 中央正本保存、Yjs room への提出混在。
- 児童生徒向け Google OAuth ログイン（生徒はローカルアカウントのみ）。
- 出席・成績・保護者連絡・課金。
- Phase 2 匿名リンクの削除または token 形式の変更。
- **PR 1 時点**: 名簿 CRUD API、Sheet 同期、生徒ログイン UI、提出 UI、管理画面の名簿タブ — **すべて未提供（flag OFF + ルート未配線）**。

## 5. Data sources of truth

### 5.1 Google Sheet（名簿フィールド正本）

教員が学校運用で編集するスプレッドシート。Syncratch は **読取同期**（PR 4+）または **CSV エクスポートの手動 import**（PR 3+）で SQLite ミラーを更新する。Sheet 列が正で、SQLite の表示フィールドはミラーである。

### 5.2 Railway SQLite（認証・提出メタデータ正本）

単一 Railway デプロイの `ADMIN_DB_PATH`（`collab-host` admin DB）。Phase 2 の `admin_accounts`, `classroom_policies`, `student_links`, `student_grants` に加え、本 case で次を追加する（PR 1 migration のみ。利用は後続 PR）:

| テーブル（論理） | 役割 |
|---|---|
| `classroom_rosters` | 名簿コンテナ、Sheet 接続メタ、`roster_revision` |
| `classroom_students` | 生徒レコード（`student_code` 安定キー） |
| `classroom_roster_memberships` | roster ↔ student |
| `student_accounts` | ローカルアカウント状態、enrollment / password ハッシュ |
| `roster_imports` / `roster_import_rows` | CSV/XLSX import プレビュー・適用履歴 |
| `classroom_audit_events` | 名簿・認証・提出の監査 |
| （PR 7+）`classroom_submissions` | 提出メタ、Drive file id、SHA256 |

**置かないもの:** ProjectDocument、Yjs state、SB3 bytes、API キー、生徒パスフレーズ平文、enrollment code 平文。

### 5.3 Google Drive（提出 SB3 正本）

- Scope: **`https://www.googleapis.com/auth/drive.file` のみ**（既存 Local-First 方針と同一）。
- 教員 OAuth セッション（PR 2+）で、教員が Picker または API 経由で **提出先フォルダ** を指定・作成する。
- 生徒提出（PR 7+）はサーバーが教員 credential で `files.create` / `files.update` し、**教員がアプリに許可したフォルダ配下のみ** に SB3 を置く。
- 既存の生徒個人 Drive 連携（editor 内 GIS + メモリ token）とは独立。提出用 Drive 書き込みは **サーバー側教員 credential** が行う。

### 5.4 IndexedDB（WIP 正本）

- 単独編集・生徒リンク編集とも、**編集中作品の正本は端末 IndexedDB**（Local-First 不変）。
- 提出操作は WIP から SB3 を生成し、Drive へアップロードする **明示的コピー**。提出後も IndexedDB WIP は削除しない（教員ポリシーで export 禁止にできる）。

## 6. Roster sheet contract

### 6.1 列（固定・順不同可・ヘッダー名厳密）

| 列名 | 必須 | 型 | 説明 |
|---|---|---|---|
| `student_code` | ✓ | string | 教室内で不変の opaque ID。SQLite `UNIQUE(owner_admin_id, student_code)` |
| `display_name` | ✓ | string | 表示名 |
| `attendance_number` | | string | 出席番号。**先頭ゼロを保持**（数値化しない） |
| `login_name` | | string | ローカルログイン ID。空なら `student_code` をログイン名として扱う（PR 6） |
| `group_label` | | string | 組・グループ表示用 |
| `active` | ✓ | boolean | `true` / `false`（CSV では `"true"` / `"false"` 文字列） |

定数: `ROSTER_SHEET_COLUMNS` in `@blocksync/classroom-access`.

### 6.2 Import プレビュー category

| category | 意味 |
|---|---|
| `add` | 新規生徒 |
| `update` | 既存生徒のフィールド更新 |
| `deactivate` | `active=false` または行削除相当 |
| `duplicate_candidate` | 同一 import 内または既存との重複疑い |
| `attendance_collision` | 同一 roster 内で attendance_number 衝突 |
| `rejected_row` | 必須欠落・型不正等で拒否 |

適用は **preview_hash + base_roster_revision** の CAS で行う（PR 3+ API）。

## 7. Student access modes

`StudentAccessMode`:

| モード | 条件 | 挙動 |
|---|---|---|
| `shared-anonymous` | `ClassroomPolicy.rosterId === null` または `studentAuth.required === false` | Phase 2 どおり。token/grant のみ。提出時も匿名（提出機能自体は flag + policy で別制御） |
| `roster-login` | `rosterId` が設定され `studentAuth.required === true` | grant 取得後、**student identity セッション必須**。未ログインはログイン/activate UI のみ |

**flag OFF 時:** 既存ポリシーは `rosterId = null`, `studentAuth.required = false` のまま → **全リンクが shared-anonymous**（Phase 2 互換）。

## 8. Student auth flow（ローカルアカウント）

Google OAuth は使わない。サーバー保存は **ハッシュのみ**。

### 8.1 状態機械 `StudentAccountStatus`

| 状態 | 意味 |
|---|---|
| `pending_activation` | レコード作成済み。enrollment code 未使用 |
| `active` | enrollment 済み + passphrase 設定済み |
| `disabled` | 教員無効化または roster 上 inactive |

### 8.2 初回 activate（enrollment code → passphrase）

1. 教員が生徒行に対し **enrollment code** を発行（PR 6）。平文は一度だけ表示。DB は `enrollment_code_hash` + `enrollment_code_expires_at`。
2. 生徒は `/s/{token}` → grant 交換後、`studentAuth.required` なら activate 画面へ。
3. `POST /api/student/auth/activate` with `{ enrollmentCode, passphrase }`（PR 6）。
4. 成功 → `student identity` セッション発行。`status = active`。

### 8.3 再訪 login（passphrase）

1. `POST /api/student/auth/login` with `{ loginName, passphrase }`（loginName は Sheet の `login_name` または `student_code`）。
2. 成功 → identity セッション更新。

### 8.4 教員運用

- enrollment code 再発行、パスフレーズリセットコード、セッション失効（API paths は PR 1 で契約のみ定義）。

## 9. Sessions: student grant vs student identity

Phase 2 との混同を避けるため **cookie 名・TTL・責務を分離**する。

### 9.1 Student grant（Phase 2 既存 — 変更しない）

| 項目 | 値 |
|---|---|
| Cookie | `syncratch_student_grant` |
| 発行 | `POST /api/student/grant`（token 交換） |
| 責務 | どの **StudentLink / ClassroomPolicy** でエディターを動かすか |
| TTL | 8h（既存 `STUDENT_GRANT_TTL_MS`） |
| flag OFF | **現行どおり必須**（生徒面 `/s`）。本 case でも上書きしない |

### 9.2 Student identity（本 case 新規 — PR 6+ で有効）

| 項目 | 値 |
|---|---|
| Cookie | `syncratch_student_identity`（提案。実装 PR 6） |
| 発行 | activate / login 成功時 |
| 責務 | どの **`student_id`** として提出・監査ログに載るか |
| 前提 | 有効な **student grant** が同一ブラウザに存在すること |
| 検証 | grant の `policyId` → policy.rosterId と student の roster membership が一致 |
| TTL | grant より短くてもよい（例: 24h）。grant 失効時は identity も無効 |
| flag OFF | **cookie 発行しない**。API ルート未登録 |

### 9.3 リクエスト順序（roster-login モード）

```text
GET /s/{token}
  → POST /api/student/grant        → syncratch_student_grant
  → GET  /api/student/policy       → studentAuth.required === true
  → POST /api/student/auth/login   → syncratch_student_identity
  → （編集は IndexedDB）
  → POST /api/student/submissions  → Drive + SQLite meta（PR 7）
```

**分離の理由:** grant だけでは「リンクを知っている匿名利用者」と「名簿上の S001」が区別できない。identity を分けることで、リンク再配布・grant 再発行と、生徒アカウント失効を独立させる。

## 10. Submission model（PR 7+）

| フィールド | 保存先 |
|---|---|
| SB3 bytes | 教員 Drive ファイル |
| `driveFileId`, `contentSha256`, `sizeBytes`, `submittedAt`, `studentId`, `policyId`, `isResubmission` | SQLite `classroom_submissions` |
| 編集中 ProjectDocument | IndexedDB のみ |

教員は `/admin` から提出一覧（PR 7）・プレビュー面（PR 8、`submissionPreviewEnabled`）でメタを参照し、Drive から SB3 を取得する。

## 11. Google OAuth boundaries

| セッション | Cookie / 経路 | Scope | 用途 |
|---|---|---|---|
| Admin login | `syncratch_admin_session` | Google ID token（Drive scope なし） | `/admin` 管理 |
| Teacher Google credential | `syncratch_admin_google`（PR 2 提案） | **`drive.file` のみ** | Sheet 読取、提出フォルダ作成 |
| Editor Drive（既存） | `syncratch_drive_session` / GIS memory | **`drive.file` のみ** | 個人プロジェクトの Drive 保存 |
| Student identity | `syncratch_student_identity` | なし | ローカル passphrase |

**禁止:** `drive`, `drive.readonly`, Classroom, Gmail scopes。Admin login 成功を Teacher credential ありとみなさない。

## 12. Feature flags（すべて既定 OFF）

環境変数（`parseClassroomFeatureFlags`）:

| Flag | Env | 依存 |
|---|---|---|
| `classroomRosterEnabled` | `SYNCRATCH_CLASSROOM_ROSTER_ENABLED` | — |
| `adminGoogleCredentialEnabled` | `SYNCRATCH_ADMIN_GOOGLE_CREDENTIAL_ENABLED` | roster |
| `rosterSheetsEnabled` | `SYNCRATCH_ROSTER_SHEETS_ENABLED` | admin Google credential |
| `studentLocalAuthEnabled` | `SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED` | roster |
| `teacherDriveSubmissionEnabled` | `SYNCRATCH_TEACHER_DRIVE_SUBMISSION_ENABLED` | student local auth |
| `submissionPreviewEnabled` | `SYNCRATCH_SUBMISSION_PREVIEW_ENABLED` | teacher drive submission |

起動時 `validateClassroomFeatureFlagDependencies` が失敗したら **fail closed**（collab-host 起動エラーまたは admin API 503 — 実装 PR 2 で選択）。

**flag OFF の公開挙動:**
- `/`, `/admin`, `/s/{token}` は Phase 2 どおり。
- 新規 API path（`/api/admin/rosters`, `/api/student/auth/*`, `/api/student/submissions`）は **404 または 501**（未登録）。既存 `/api/student/grant`, `/api/student/policy` は変更なし。
- DB migration PR 1 は **スキーマ追加のみ**。既存行の `roster_id`, `student_auth_required`, `submission_enabled` は **0 / NULL** のまま。

## 13. Runtime architecture

```text
Browser
  ├─ /              → Community（IndexedDB WIP）
  ├─ /admin         → 管理者（Phase 2 + 名簿/提出 UI は PR 3–8）
  └─ /s/:token      → 生徒（grant → optional identity → editor）

Google Sheet ──read──► collab-host ──mirror──► SQLite (rosters/students)
                              │
                              ├── Teacher OAuth (drive.file) ──► Drive folder
                              └── Submission upload (PR 7) ──► SB3 file

IndexedDB ◄── WIP ── Browser editor
```

契約パッケージ `@blocksync/classroom-access` に型・path 定数・policy 正規化・flag を集約。School パッケージへの import 禁止。

## 14. Admin DB migration ledger（PR 1）

Phase 2 baseline を version **1**、`classroom-roster-foundation` を version **2** とする。

- Ledger テーブル: `schema_migrations(version, name, checksum, applied_at)`
- `PRAGMA user_version` と ledger の **monotonic 一致**を検証（`runAdminDbMigrations`）。
- version 2 は **CREATE / ALTER のみ**。既存 `classroom_policies` に `roster_id`, `student_auth_required`, `submission_enabled` を追加（既定 0 / NULL）。
- ダウングレード・ledger 改ざん検出時は起動失敗。

## 15. CSV / XLSX import gate（PR 1）

PR 1 では **ライブラリ選定と安全上限のスパイクテスト**のみ（API 未配線）。

### 15.1 CSV（`csv-parse`）

- ヘッダー `columns: true`、`ROSTER_SHEET_COLUMNS` 契約。
- `attendance_number` 先頭ゼロ保持、引用符内改行可。

### 15.2 XLSX（`exceljs`）

| 上限 | 値 |
|---|---|
| ファイルサイズ | 2 MiB |
| シート数 | 1 |
| 行数 | 1000（ヘッダー除く） |
| 列数 | 20 |
| 読取 timeout | 5s |
| RSS 増分 | 96 MiB 未満（スパイク観測） |

**拒否:** 数式セル、2 シート以上、上限超過、zip 破損時の process crash。

## 16. Phased delivery（8 PR）

| PR | スコープ | Flag |
|---|---|---|
| **1** | **本 spec、契約型、path 定数、policy 拡張、migration v2、feature flags、CSV/XLSX gate テスト** | すべて OFF |
| 2 | Admin Google OAuth credential 接続（`drive.file`）、callback、session CRUD | `ADMIN_GOOGLE_CREDENTIAL` + `CLASSROOM_ROSTER` |
| 3 | Roster / student admin API、CSV import upload → preview → apply | + `CLASSROOM_ROSTER` |
| 4 | Google Sheet 同期（spreadsheetId / tab / range） | + `ROSTER_SHEETS` |
| 5 | Policy ↔ roster 紐付け、`studentAuth.required`、生徒面 gate（identity 未ログイン UI 骨格） | + `CLASSROOM_ROSTER` |
| 6 | Student activate / login / logout / session API + identity cookie | + `STUDENT_LOCAL_AUTH` |
| 7 | 提出 API（SB3 → 教員 Drive + SQLite meta）、生徒 UI | + `TEACHER_DRIVE_SUBMISSION` |
| 8 | 教員提出一覧・詳細・プレビュー面 | + `SUBMISSION_PREVIEW` |

各 PR は **単独マージ可能**で、flag OFF なら production 挙動が Phase 2 と一致することを CI で確認する。

### 16.1 PR 1 詳細スコープ（In / Out）

**In**

- 本ドキュメント
- `@blocksync/classroom-access`: `roster-types.ts`, `feature-flags.ts`, `paths.ts` 拡張, `ClassroomPolicy` に `rosterId`, `studentAuth`, `submission`
- `admin-db-migrations/0002-classroom-roster-foundation.ts` + runner 統合
- `roster-import-csv.test.ts`, `roster-import-xlsx-spike.test.ts`
- policy 正規化の既定値（`studentAuth.required=false`, `submission.enabled=false`, `rosterId=null`）

**Out**

- collab-host への新 API ルート登録
- `/admin` / `/s` UI 変更
- Google OAuth callback 実装
- Sheet 同期、enrollment 発行、提出アップロード
- `classroom_submissions` テーブル（PR 7 migration で追加予定）

## 17. Security

1. **Enrollment code:** 暗号論的乱数、単回表示、ハッシュ保存、有効期限必須。
2. **Passphrase:** Argon2id または scrypt（具体パラメータは PR 6）。`password_version` でローテーション可能に。
3. **Identity ↔ grant 绑定:** identity 発行時に grantId と policy.rosterId を検証。不一致は 403。
4. **Teacher credential:** admin session とは別 cookie。Drive scope は `drive.file` のみ。
5. **提出:** サーバーは教員が事前選択した folderId のみに書き込む。生徒入力で folderId を指定不可。
6. **Import gate:** XLSX 公式・巨大ファイルによる DoS を拒否。CSV/XLSX 内 formula / hyperlink を実行しない。
7. **StudentPolicyView:** Phase 2 どおり `rosterId` を生徒 API に返さない（membership 情報は返さない）。
8. **監査:** enrollment 発行、login 失敗、提出、roster apply を `classroom_audit_events` に記録（PR 3+）。

## 18. Testing requirements

### PR 1（必須）

- Migration v2: 新規 DB / Phase 2 既存 DB からの upgrade。ledger checksum 一致。`classroom_policies` 既存行の既定値維持。
- Feature flags: 未設定 → すべて false。依存チェーン違反 → `validateClassroomFeatureFlagDependencies` が非空。
- Policy normalize: 新フィールド既定が false/null。`toStudentPolicyView` に `rosterId` が含まれない。
- CSV gate: 6 列パース、先頭ゼロ、改行入り display_name。
- XLSX gate: 正常 1 シート、formula 拒否、破損 zip で process 生存。

### 後続 PR（参考）

- flag OFF: `/api/student/grant` のみで anonymous 編集可能（Phase 2 回帰）。
- roster-login: identity なしで提出 API が 401。
- Sheet 同期: revision CAS、競合時 `sync_required`。
- 提出: Drive file が教員 folder 配下のみ。SQLite に bytes なし。

## 19. Open questions

1. **Identity cookie TTL** — PR 6 で grant TTL（8h）との関係を固定（提案: identity 24h、grant 失効で連動失効）。
2. **`classroom_submissions` migration** — PR 7 で version 3 とするか、foundation に空テーブルを含めるか（PR 1 では **含めない**）。
3. **Sheet 同期間隔** — push webhook なし。PR 4 は manual sync + 将来 cron を非目標。
4. **Resubmission ルール** — 同一 policy + student + 課題単位で上書き vs 履歴保持（PR 7 で `isResubmission` フラグのみ定義済み）。

## 20. Summary

- **Case `classroom-roster-drive-submissions`** は Phase 2 匿名生徒リンクの上に、**Sheet 名簿・ローカル生徒認証・教員 Drive 提出**を任意追加する。
- 正本は **Sheet / SQLite meta / Drive SB3 / IndexedDB WIP** に分離する。
- **student grant**（policy 入場）と **student identity**（名簿上の誰か）を混同しない。
- **Google OAuth は `drive.file` のみ**。Teacher credential は admin login とは別セッション。
- **8 PR・全 flag 既定 OFF**。PR 1 は **契約 + migration ledger + flags + import gate のみ**で UI/API は有効化しない。
- **flag OFF 時は Phase 2 匿名リンクと Community `/` を完全維持**する。
