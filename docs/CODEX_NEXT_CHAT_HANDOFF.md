# Codex 次チャット引き継ぎ（2026-07-22）

この文書は、長大化した旧チャットの推測や圧縮要約に依存せず、次のCodexチャットがGitの一次情報から安全に再開するための起動指示である。

## 最優先規則

ユーザーから `作業完了` または明らかな途中送信の `作業完` を受け取ったら、これは単なる完了報告ではなく、Gitから提出物を発見して現在の担当作業を実行する合言葉である。

最初に `docs/WORK_COMPLETE_PROTOCOL.md` を全文読み、その手順を実行する。ユーザーへ報告のコピー＆ペースト、Taskの再説明、次の指示を要求してはいけない。

## 最初に必ず行うこと

1. 対象repoが `https://github.com/overdozer1124/syncratch.git` であることを確認する。
2. `git fetch --prune origin` を実行する。
3. `git status --short`、`git branch --show-current`、`git rev-parse HEAD`、`git worktree list --porcelain` を取得する。
4. 会話要約やローカルcheckoutの台帳を正とせず、下記固定SHAの3文書を全文読む。

```powershell
git show origin/codex/next-chat-handoff:docs/CODEX_NEXT_CHAT_HANDOFF.md
git show origin/codex/next-chat-handoff:docs/CURSOR_CODEX_HANDOFF.md
git show origin/codex/next-chat-handoff:docs/WORK_COMPLETE_PROTOCOL.md
```

読む前に `git rev-parse origin/codex/next-chat-handoff` を実行し、ユーザーが旧チャットの最終報告で示した固定SHAと一致することを確認する。

## 2026-07-22 10:17:23 JST時点の一次情報

- `origin/main`: `c465514f6da0e528d91b757628b8d9ec8f704eda`
  - PR #15 merge commit。
  - Local-First実装とmainline受け入れ証跡を含む、次実装の正しいbase。
- `origin/feat/local-first-pivot-impl`: `48b94c499a496dbf6c15ecee63c57f6e8e256258`
- `origin/HEAD`: まだ `origin/feat/local-first-pivot-impl` を指している。
  - default branch切替は未実施なので、`origin/HEAD`を最新baseだと推定してはいけない。
- 旧handoff branch: `origin/codex/block-level-collab-handoff` @ `fae23bc9405c3613d07899c3a8b8201162746930`
  - 次Taskの原案はあるが、PR #15 merge前のbaseである。次実装baseには使わない。
- Local-First初回マイルストーン: 100%。
- 公開deploy、default branch切替、Draft PR #5/#7整理、Manual Google gates: 未実施であり、今回のTask外。

## worktreeの罠

- `C:\cursor\NewScratchEditor` のlocal `main` は、確認時点で `f1983dd` の古いSchool track状態だった。fetch前のlocal branchを正としない。
- `C:\cursor\NewScratchEditor-local-first-pivot` はCodexの旧診断worktreeで、次の未コミット変更が残る。
  - `apps/editor-web/src/collab-session.test.ts`
  - `apps/editor-web/src/collab-session.ts`
  - `apps/editor-web/src/main.ts`
  - `apps/editor-web/src/ui-copy.test.ts`
  - `apps/editor-web/src/ui-copy.ts`
- 上記変更は共同編集リンク失敗の診断案であり、承認済み実装でも次Taskのbaseでもない。削除、reset、commit、取り込みを勝手に行わない。
- 次Taskは必ずcleanな `origin/main @ c465514` から新しいworktree/branchを作る。

## 現在確定している次Task

名称: **同一スプライトのブロック単位共同編集 Phase 1**

背景:

- 素材同期、別スプライト同期、remote apply時の選択・viewport・tab保持は承認済み。
- 現在も同一スプライトのblock graphは `blocksJson` 1値のLWWである。
- 同じスプライトの別stackを同時編集しても、遅い全体snapshotが相手の編集を消す可能性がある。

目的:

- 同一スプライト上の異なるblock id／異なるstackへの同時編集を、全体snapshotの上書きで失わず収束させる。
- target metadata、asset、Drive任意化、local UI stateの既存契約を維持する。

Cursorが作るbranch:

```text
cursor/block-level-collab-phase1-f431
base: origin/main @ c465514f6da0e528d91b757628b8d9ec8f704eda
```

設計上の必須条件:

1. 新しい設計書を `docs/superpowers/specs/` に作る。
2. 承認済み `docs/superpowers/specs/2026-07-20-p2p-bootstrap-optional-drive-design.md` は変更しない。
3. target内block graphを、最低でもblock id単位で独立に競合解決できるYjs表現にする。
4. VM全snapshotでshared stateを置換せず、最後に受理したshared baselineとの差分から追加・変更・削除block idだけを1 transactionでpublishする。
5. stale snapshotに無いという理由だけで、相手が追加した未知blockを削除しない。
6. materialize後にparent/next/input/topLevel/cycle/size/depthを決定的に検証し、不正stateをVMやIndexedDBへ適用しない。
7. 同一blockまたは同一接続辺の同時競合について、Phase 1の決定規則と限界を明記する。完全な操作CRDTは非目標。
8. legacy `blocksJson` 読取、新形式初期化、混在時のfail-closedまたは明示upgradeを定義し、二重writerにしない。

最低限の受け入れ試験:

1. host/guestが同じspriteへ別stackを同時追加し、両方残る。
2. `forever`接続と別stack追加が同時でも両方残る。
3. 一方のdetachと別block field変更が同時でも両方残る。
4. sprite座標変更とblock編集が同時でも両方残る。
5. baseline block削除と未知block追加が同時でも、未知blockが消えない。
6. 同一block競合は両peerで同じ結果になる。
7. malformed/cyclic/dangling graphをfail-closedで拒否する。
8. sprite追加、asset転送、B sprite選択、Blockly viewport、tab保持を回帰させない。
9. 可能なら2ブラウザE2EでBlockly表示まで確認する。

必須gate:

- `pnpm --filter @blocksync/collaboration-domain test`
- `pnpm --filter @blocksync/collaboration-domain typecheck`
- `pnpm --filter @blocksync/editor-web test`
- `pnpm --filter @blocksync/editor-web typecheck`
- `pnpm --filter @blocksync/editor-web build`
- 関連WebRTC／Local-First受け入れ／2ブラウザE2E
- `git diff --check`

停止条件:

- Cursorは設計・実装・テストをreviewable commitsにし、自己レビューを2周行う。
- 台帳を `READY_FOR_CODEX_REVIEW`、担当Codexに更新して停止する。
- 自動merge、公開deploy、次Phase着手をしない。
- JSTタイムスタンプと進捗率を台帳・ユーザー報告に含める。

## 次のCodexチャットの行動規則

- ユーザーが単に「作業完了」と言った場合、まずfetchし、台帳、実装branch、base/head、diff、testsを確認する。
- Cursorの自己申告だけでGOを出さない。実差分と失敗経路をレビューする。
- 診断依頼では原因を特定してから修正し、ユーザーの「以前は動いていた」という回帰情報を優先する。
- 共同編集リンク障害の実原因は、5173/4444の旧runtimeと4174/4455の現行runtimeの取り違えだった。突然のnon-secure context化を根本原因として再主張しない。
- 既存dirty worktreeをreset、checkout、cleanしない。
- コード変更を求められていないレビューでは、外部状態の変更やmergeを行わない。
- 作業終了時は必ずJSTタイムスタンプと、Local-First全体／当該sliceの進捗率を報告する。

## 新チャットでユーザーが送る最短指示

次の一文だけでよい。

```text
引き継ぎ開始。origin/codex/next-chat-handoff の docs/WORK_COMPLETE_PROTOCOL.md、docs/CODEX_NEXT_CHAT_HANDOFF.md、docs/CURSOR_CODEX_HANDOFF.md を全文読み、Gitの実状態を確認してください。以後「作業完了」は提出物を自動発見して実装またはレビューを開始する合言葉として扱ってください。
```
