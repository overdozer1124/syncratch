# 引き継ぎ: Local-first 共同編集 + Drive UX（2026-07-20）

## リポジトリ / ブランチ

- **パス:** `C:\cursor\NewScratchEditor-local-first-pivot`
- **ブランチ:** `feat/local-first-pivot-impl`
- **注意:** Codex が開いている別パス `C:\cursor\NewScratchEditor` とは別ワークスペース。ファイル参照は必ずこのリポジトリを使うこと。
- **状態:** 未コミット変更が大量にある（レイアウト、GUI assets、Drive、collab、autosave、ドキュメント等）。コミットはユーザー依頼があるまでしない。

## ユーザーの現在のゴール

共同編集 + Google Drive を実機で使えるようにしたいが、**操作が複雑すぎて詰まっている**。  
次のアクションとして、Codex に UX/設計レビューを依頼中（コード修正より簡素化方針が先）。

## Codex レビューブリーフ

- ファイル: `docs/superpowers/reviews/2026-07-20-codex-collab-drive-ux-review-brief.md`
- 絶対パス: `C:\cursor\NewScratchEditor-local-first-pivot\docs\superpowers\reviews\2026-07-20-codex-collab-drive-ux-review-brief.md`
- Codex 側でパスが見つからない場合は、当該 markdown 本文を貼り付ける。

## このセッションで実装・修正したもの（要約）

### 1. GUI / 起動まわり（先の会話）

- ツールバー固定で Scratch 本体が潰れる問題 → flex レイアウト修正（`style.css`）
- ブロックエディタ画像欠落 → `prepare-assets` で static/chunks コピー、webpack publicPath パッチ

### 2. 共同編集の切断・スプライト同期

- WebRTC data channel の大ペイロード対策: `packages/collab-webrtc/src/data-channel-framing.ts`
  - 小さい wire は bare のまま、大きいものだけチャンク
  - 送信バッファ待ち（`bufferedAmount`）
- `collab-session`: アセットが揃うまで target を送らない / assets 先行
- 切断時でもリーダーの明示 Drive 保存は許可（`canPersistToDrive({explicit:true})`）
- `main.ts` の `canPersistToDrive` ラッパが `options` を捨てていたバグを修正済み

### 3. Drive leader autosave（承認済み設計を実装）

- Spec: `docs/superpowers/specs/2026-07-20-drive-leader-autosave-design.md`
- Plan: `docs/superpowers/plans/2026-07-20-drive-leader-autosave.md`
- 実装:
  - `apps/editor-web/src/drive-autosave.ts` (+ test)
  - `drive-integration.saveToDrive({explicit?})` — 自動は `false`、手動/Create room は `true`
  - `main.ts` で lifecycle 接続（markDirty / leave / loadRecord / disconnect / collab state）
- 検証済み（当時）: editor-web 87 tests pass、typecheck pass、build pass

## システムの重要制約（忘れやすい）

1. **Drive スコープは `drive.file` のみ**  
   ゲストは招待の `fileId` を Picker で開いてアプリ認可を得る必要がある。共有は Google Drive 上で手動。
2. **Leader は lexicographic（participant id）**で、Create room した人が常にリーダーではない。
3. **状態が三重**  
   - Local: Saved / Save failed  
   - Drive: Synced / Unsynced  
   - Collab: connected · N peers · leader|follower  
   ユーザーは混同しやすい。
4. **公開シグナリングフォールバック禁止**
5. Invite URL の `fileId` が古いと、復旧後も古い Drive ファイルが開く。

## 実機で観測された未解決・半解決の痛み

| 症状 | 現状の理解 | 次の扱い |
|------|------------|----------|
| スプライト追加で切断 / `?` コスチューム | framing + asset defer で対策済み。再検証未完了の可能性 | Codex レビュー後に再テスト |
| ブロック操作で Unsynced | Drive 未保存表示。autosave で緩和 | 再検証 |
| 編集で Save failed（ローカル） | Drive/collab は正常なまま。壊れた IndexedDB 記録の可能性大。新規プロジェクトは Saved。Retry 無反応 | 復旧手順は案内済み。恒久対策はレビュー待ち |
| Join で Picker 「No documents」 | 共有不足 / 別アカウント / drive.file 未認可。UI 説明不足 | UX 簡素化の中心課題 |
| 復旧手順が Download→Open→Save→共有→新部屋と長い | プロダクト欠陥 | Codex に簡素化案を依頼済み |

## ユーザーへの案内済み復旧（Save failed 時）

1. Download SB3  
2. Leave room  
3. Open SB3（新しいローカル記録）  
4. Save to Google Drive（**新しい**ファイル）  
5. Drive 上でゲストへ共有  
6. Create room → **新しい** invite を送る  
7. ゲストは古い URL を使わない、同じ Google アカウントで Join → Picker

## 推奨される次ステップ（新エージェント）

1. **先に Codex レビュー結果を待つ / 取り込む**  
   ユーザーが「複雑すぎる」と明示しているので、場当たり修正より簡素化方針を優先。
2. Codex 結果が来たら:
   - P0 を実装計画化（writing-plans / TDD）
   - 特に Join フロー、状態表示統合、壊れたローカル記録の自動復旧を優先候補として想定
3. レビュー前に触るなら（ユーザーが明示依頼した場合のみ）:
   - `Retry save` が無反応な理由（error 状態からの再試行・例外メッセージ表示）
   - Join 時「No documents」の説明文と次アクション
4. **コミット/PR はユーザー依頼があるまでしない**（未コミット差分が広い）

## よく触るファイル

- `apps/editor-web/src/main.ts` — UI・collab・Drive wiring
- `apps/editor-web/src/drive-integration.ts` — Drive open/save/reobserve
- `apps/editor-web/src/drive-autosave.ts` — leader autosave
- `apps/editor-web/src/collab-session.ts` — Yjs push/apply/leadership
- `packages/collab-webrtc/src/webrtc-transport.ts` — WebRTC + framing
- `packages/google-drive-sync/src/picker.ts` — Picker（共有ドライブ設定に注意）

## 動作確認環境メモ

- Preview 例: `http://127.0.0.1:4173/NewScratchEditor/`
- Signaling: `VITE_COLLAB_SIGNALING_URL`（例 `ws://127.0.0.1:4455`）
- Env: `apps/editor-web/.env.local`（gitignore）
- E2E base は `playwright.config.ts`（signaling 4455、preview 4173）

## 会話のトーン / ルール

- ユーザー向け応答は**日本語・簡潔**
- コミットは明示依頼があるまで禁止
- Superpowers: creative 前は brainstorm、実装は TDD、完了前は verification
- `drive.file` / 非公開シグナリングの方針を破らない

## 新エージェントへの一言

ユーザーは技術的な部分修正より **「共同編集を少ないステップで成功させたい」**。次は Codex UX レビュー結果を軸に、Join/共有/状態表示の簡素化を進めるのが最優先。
