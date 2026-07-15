# Gate 0 詳細設計（検証パッケージ分割モノレポ）

> **Status:** Approved for implementation (2026-07-15)  
> **Scope:** Technical viability only — not Release 1 product features  
> **API stability:** All Gate 0 package APIs are **@experimental**; no R1 compatibility promised

## 0. 境界と原則

### やる
- 仕様書 §54 Gate 0 の成立性確認に限定
- 各検証は独立実行可能なテストまたは再現手順を持つ
- Scratch は `vendor/scratch-editor` に upstream SHA 固定（直接編集禁止）
- Google 認証はハイブリッド（フィクスチャ必須／実 GIS は任意スモーク／未実施は条件付き合格）

### やらない
- Release 1 本実装、教師機能、AI、完成版 UI
- submodule 内への未コミット変更・ローカル専用コミット
- 本番で検証無効化や任意 JWKS を注入できる設計
- Gate 0 パッケージ API の Release 1 互換約束

### 停止条件
- Scratch 本体へのパッチが検証成立に必須 → fork 作成を依頼し、submodule 内に変更を残さない
- 採用候補コミットでビルド／対象ブラウザー／重大既知不具合により選定不能
- 構造不変条件を破る同期結果が設計変更なしに収束できない

---

## 1. ディレクトリと責務

```text
/
  package.json
  pnpm-workspace.yaml          # packages/* + apps/* のみ（vendor 除外）
  .nvmrc                       # = vendor pin の .nvmrc
  vendor/scratch-editor/       # submodule @ 固定 SHA
  apps/gate0-collab-demo/
  apps/gate0-collab-server/
  apps/gate0-auth-smoke/
  packages/scratch-adapter/
  packages/project-schema/
  packages/sb3-tools/
  packages/google-identity/
  packages/collaboration-domain/
  docs/gate0/ …
  docs/adr/ …
  fixtures/sb3/
  fixtures/google-identity/
  scripts/
  .github/workflows/gate0.yml
```

| 単位 | 責務 | 非責務 |
|---|---|---|
| `project-schema` | 純ドメイン文書モデル + §16 不変条件 | VM / Yjs / UI |
| `collaboration-domain` | 共有文書・操作適用。確定前に `project-schema` | 製品永続化 |
| `scratch-adapter` | VM 観察・1ブロックステップ・parity | 汎用デバッガ |
| `sb3-tools` | 安全読込最小・往復・コーパス | 製品 UI |
| `google-identity` | ID トークン検証（authn） | 認可・セッション |
| `gate0-collab-server` | 最小 Yjs WebSocket リレー | 製品 GW |
| `gate0-collab-demo` | 2 クライアント同期デモ | 完成エディタ |
| `gate0-auth-smoke` | 実 GIS スモーク（env 時のみ） | 常時必須 CI |

---

## 2. 依存関係

### 許可
- `collaboration-domain` → `project-schema`
- `scratch-adapter` → `vendor/scratch-editor`（workspace 外）
- `sb3-tools` → `project-schema`；VM 往復試験のみ `scratch-adapter` を devDep
- `apps/*` → 必要な packages

### 禁止
- `project-schema` → Scratch VM / Yjs / React
- `google-identity` → 認可・セッション
- `collaboration-domain` → Scratch VM
- 本番でのモック JWKS 差し替え（`NODE_ENV=test` または `GATE0_TEST_HOOKS=1` のみ）
- pnpm workspace が `vendor/**` を探索・hoist

---

## 3. Scratch 固定

- upstream: `https://github.com/scratchfoundation/scratch-editor.git`
- origin fork: 未使用（Gate 0 暫定）
- 選定は「最新」禁止。ビルド成功・Chrome・既知不具合・ライセンス・SB3・VM 観察到達で決定
- Node 要求は **採用コミット内 `.nvmrc` を正**
- パッチが必要になったら停止し fork 移行（ADR-0001）

---

## 4. 検証マトリクス

| Gate 0 項目 | 単位 | コマンド | 合格 |
|---|---|---|---|
| コミット固定 | pin + CI | `pnpm gate0:check-pin` | SHA・clean・文書 |
| ライセンス | docs | `pnpm gate0:check-licenses` | 一覧完備 |
| SB3 往復 | sb3-tools | `pnpm --filter @blocksync/sb3-tools test` | 意味的往復 |
| VM 観察 | scratch-adapter | `… test:observe` | 観察フィールド取得 |
| 1ブロックステップ | scratch-adapter | `… test:step` | 境界一致 |
| 通常 vs ステップ | scratch-adapter | `… test:parity` | 最終状態一致 |
| 不変条件 | project-schema | `… project-schema test` | 違反拒否 |
| 2画面同期 | collab | `pnpm gate0:collab` | **WebSocket** 経由収束 |
| Google 検証器 | google-identity | `… google-identity test` | フィクスチャ全ケース |
| 実 Google | auth-smoke | env 時のみ | 未実施=条件付き合格 |

---

## 5. ステップ実行（最小）

**対応 opcode:** `event_whenflagclicked`, `motion_movesteps`, `motion_gotoxy`, `looks_say`, `control_if`, `control_repeat`, `operator_add`, `operator_equals`, `data_setvariableto`, `data_variable`

**観察:** 現在/次ブロック ID、スレッド、座標・向き・表示、対象変数、固定シード

**1ステップ境界:** command/hat/control 処理完了。Reporter は親評価内。

**parity:** 同一シードで `runToEnd` vs 視覚ステップループの最終スナップショット一致。

---

## 6. Google 認証（ハイブリッド）

必須検証: 署名、kid/JWKS ローテーション、iss、aud、azp、exp/iat、sub、email_verified、hd（欠落・不一致拒否、完全一致）

試験: 正常、不正署名、期限切れ、誤 aud、未知 kid、JWKS 失敗、hd 欠落/不一致

実スモーク: `GOOGLE_CLIENT_ID` があるときのみ。秘密・実トークンをリポジトリ/ログに残さない。未実施は **条件付き合格**（R1 認証完了条件に含めない）。

---

## 7. Go / 条件付き Go / No-Go

- **Go:** 自動化試験 + 必須文書完備
- **条件付き合格:** 実 GIS / Workspace hd 未実施、法務人承認待ち等。理由・完了条件を `GO_NO_GO.md` に明記
- **No-Go:** 中核検証失敗または停止条件

技術 Go と法務承認は分離表示する。

---

## 8. Spec self-review（2026-07-15）

| Check | Result |
|---|---|
| Placeholders | None material; Scratch SHA finalized at pin time in SCRATCH_PIN.md |
| Consistency | auth package named `google-identity`; schema VM-free; collab requires WS |
| Scope | Gate 0 only; R1/UI/AI/teacher excluded |
| Ambiguity | BroadcastChannel-only fails; pin uses tagged release evaluation |

---

## Related

- Product spec: `BlockSync-AI_システム仕様書・実装計画書_v1.1.md` §54
- Implementation plan: `docs/superpowers/plans/2026-07-15-gate0-implementation.md`
