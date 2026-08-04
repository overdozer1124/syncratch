# Syncratch プロジェクト完成度ステータス

最終更新: 2026-08-04（main @ `81a290d`）

## サマリー

| Track | 状態 | 進捗 |
|---|---|---|
| **Local-First Community（主系）** | **Stage 5 COMPLETE + 初回 Release** | 実装・受け入れ完了。`v0.1.0-community` 公開 |
| **Classroom 任意レイヤ** | **COMPLETE**（8 PR） | main 済み。flag デフォルト OFF |
| **Admin / student access** | Phase 2 COMPLETE | Phase 3 は未着手（任意） |
| **Local diagnostics AI** | Milestone A MERGED | Phase 4+ 停止中 |
| **School / self-hosted track** | Frozen | buildable 維持。主系非依存 |
| **Release / 告知** | **PUBLISHED**（GitHub Release） | 内容承認 2026-08-02 → 実行 2026-08-04 |

## 案件レジストリ（台帳同期）

| 案件ID | 状態 | 備考 |
|---|---|---|
| `stage5-manual-gates` | COMPLETE | A1–A7 / B1–B3 PASS |
| `file-panel-drive-cta-visibility` | COMPLETE | #185–#191 |
| `classroom-roster-drive-submissions` | COMPLETE | PR 1–8 / #211。ユーザー確認済み |
| `admin-student-access` | PHASE2_COMPLETE | Phase 3 停止（任意） |
| `local-diagnostics-ai-routing` | MILESTONE_A_MERGED | Phase 4 停止 |
| `release-decision` | **PUBLISHED** | GitHub Release `v0.1.0-community` |

## Community 初回リリースに含むもの

1. ブラウザ単独編集 + IndexedDB 保存
2. `.sb3` 入出力
3. Google Drive（`drive.file`）+ P2P 共同編集
4. 管理者 `/admin` + 生徒リンク `/s/{token}`（任意 flag）
5. 名簿・生徒認証・教師 Drive 提出（任意 flag チェーン）

## 意図的に含まないもの（v0.1.0 スコープ外）

- AI 作品診断 Phase 4（Transformers.js 等）
- admin-student-access Phase 3（管理者ホスト AI プロキシ）
- TURN / 中央バックアップ / 大規模 room relay
- School track 本流化（Person / roster RBAC / class-move 等）
- XLSX roster import（CSV-only。XLSX は Go/No-Go 待ち）

## 次に進める場合（ユーザー指示後）

| 優先度 | 案件 | 内容 |
|---|---|---|
| 低（任意） | `admin-student-access` Phase 3 | 生徒 AI プロキシ、collab 一体発行 |
| 低（任意） | `local-diagnostics-ai-routing` Phase 4 | Transformers.js / 外部 AI 分離 |
| 低（任意） | XLSX roster spike | 計画 §CSV adoption 参照 |
| 運用 | SNS 告知 | `STAGE5_RELEASE_ANNOUNCEMENT_DRAFT.md` 本文を配信 |
| 凍結維持 | School track | 復活させない |

## 「プロジェクト全体の完成」の定義

**v0.1.0-community 時点で、Local-First Community 主系 + 教室任意レイヤの計画実装は完了**とみなす。  
School track 本格化・AI Phase 4+・インフラ拡張（TURN 等）は **別ロードマップ** とし、本リリースの完成条件には含めない。
