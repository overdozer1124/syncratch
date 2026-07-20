# Codex レビュー依頼: Local-first 共同編集 + Google Drive 連携 UX/設計

## 依頼目的

`feat/local-first-pivot-impl` ブランチ上の **Scratch SPA（editor-web）の共同編集 + Google Drive 連携**について、実装レビューではなく **プロダクト/UX/アーキテクチャの批判的レビュー**をしてください。

ユーザー実機検証の結果、「操作が複雑すぎて使いこなせない」状態です。コードの細かいスタイル指摘より、**ユーザーが迷う根本原因と、簡素化のための具体的な設計変更案**を求めています。

## レビュー対象（優先順）

1. `docs/superpowers/specs/2026-07-19-blocksync-local-first-pivot-design.md`
2. `docs/superpowers/specs/2026-07-20-drive-leader-autosave-design.md`
3. `docs/superpowers/plans/2026-07-20-drive-leader-autosave.md`
4. `apps/editor-web/src/main.ts`
5. `apps/editor-web/src/drive-integration.ts`
6. `apps/editor-web/src/drive-autosave.ts`
7. `apps/editor-web/src/collab-session.ts`
8. `packages/google-drive-sync/src/picker.ts`
9. `packages/collab-webrtc/`（データチャネル分割含む）
10. `.superpowers/sdd/task-{1..5}-brief.md`（意図の背景）

## システムの現状要約（レビュー前提）

### アーキテクチャ

- **Local-first**: 編集の一次保存先は IndexedDB。ローカル保存と Drive 保存は別系統。
- **共同編集**: Yjs + WebRTC。シグナリングは設定必須（公開フォールバックなし）。
- **Drive**: OAuth `drive.file` スコープのみ。任意共有ファイルを直接読めない。ゲストは Picker で同じ `fileId` を開いてアプリ認可を得る必要がある。
- **単一ライター**: 部屋の lexicographic leader だけが Drive に書く。フォロワーは書かない。
- **Leader autosave**: リーダー編集後 2 秒 debounce で Drive 自動保存。

### UI 上の状態が複数ある

ユーザーは同時に次を見ている:

- ローカル: `Saved` / `Unsaved` / `Save failed`
- Drive: `Synced` / `Unsynced` / `Syncing…` / `Conflict`
- Collab: `connected · N peers · leader|follower` / `disconnected` / `Solo`

これらが独立しており、ユーザーは「共同編集が切れた」のか「Drive が古い」のか「ローカル保存が壊れた」のか区別できない。

## 実機で観測された痛み（必須で評価）

1. **ブロック編集は同期するが、スプライト追加で切断 / `?` コスチューム / ホストに届かない**  
   → 大容量アセットの data channel 問題・アセット未到着での target sync 問題として部分修正済み。

2. **ブロック操作だけで `Unsynced` になる**  
   → 当初は切断ではなく「Drive 未保存」表示。autosave で緩和を試みた。

3. **編集すると `Save failed`（ローカル）**  
   → Drive は `Synced`、collab は `connected · follower` のまま。  
   → 新規プロジェクトでは保存成功。壊れたローカル記録（不足アセット等）の可能性が高い。  
   → `Retry save` を押しても反応しない。

4. **復旧手順が複雑**  
   Download → Leave → Open SB3 → Save to Drive → 共有 → Create room → 新 invite → Join → Picker。  
   古い invite URL を使うと古い Drive ファイルが開く。

5. **Join invite で Picker が "No documents"**  
   → ホストがゲストへ Drive 共有していない / 別 Google アカウント / `drive.file` で未認可。  
   → UI は原因を十分説明しない。Picker 自体も空で、次のアクションが不明。

## レビューで答えてほしい問い

### A. UX / 認知負荷

1. 現状の「Local / Drive / Collab の三重状態」は製品として妥当か。統合すべきか。
2. Join 時の「共有 → Picker → 同じ fileId」は `drive.file` 制約下でも必須か。緩和案はあるか。
3. Leader/Follower 概念をユーザーに見せるべきか。隠してよいか。
4. `Unsynced` / `Save failed` / `disconnected` の用語は誤解を生むか。代替コピー案を出せ。
5. 壊れたローカル記録からの復旧を、ユーザーに SB3 再インポートさせずにできないか。

### B. アーキテクチャ

1. 「共同編集のリアルタイム同期」と「Drive の永続化」を同じ UI 面に載せる設計は正しいか。
2. Drive を「共同編集の正」にする現行モデル vs「共同編集は ephemeral、Drive はホストのバックアップ」など代替モデルを比較せよ。
3. `drive.file` を維持したままゲスト参加を簡素化する現実的な選択肢は何か（共有リンク、ホスト経由のバイト配布、スコープ拡大のトレードオフ含む）。
4. ローカル revision 競合 / 不足アセットで `Save failed` になる経路の設計欠陥を指摘せよ。

### C. 優先度つき改善提案

次の形式で **最大 7 個**、優先度（P0–P2）付きで提案せよ。

- 問題
- なぜユーザーが詰まるか
- 提案する変更（UI / フロー / アーキテクチャ）
- 実装コスト感（S/M/L）
- リスク

特に「今日のユーザーが共同編集を成功させるために、まず何を削るか / 何を自動化するか」を明確にせよ。

## 制約（変更提案時に守ること）

- コードを今すぐ書き換えなくてよい。レビューと設計提案が成果物。
- 公開シグナリングへのフォールバックを提案しない（プロジェクト方針で禁止）。
- 秘密鍵・トークンをログや invite に載せる案は不可。
- Google の `drive.file` 制約を無視した「勝手に全 Drive を読む」案は不可。スコープ拡大を提案する場合は明示的にトレードオフを書け。
- 「もっとドキュメントを読め」だけでは不可。操作回数を減らす提案を優先。

## 成果物フォーマット

1. **総評**（3–5 行）: 今のシステムは何が過剰か
2. **致命的な UX 欠陥**（最大 5）
3. **推奨アーキテクチャ方針**（現行維持 / 簡素化 / モデル変更のいずれかと理由）
4. **P0–P2 改善リスト**（最大 7）
5. **やらない方がよいこと**（過剰設計・誤った簡略化）
6. 必要なら短い **理想フロー**（ホスト 5 ステップ以内、ゲスト 5 ステップ以内）

日本語で回答してください。
