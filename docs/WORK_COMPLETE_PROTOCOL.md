# 「作業完了」合言葉プロトコル

このファイルはCursorとCodexの共通実行規則であり、通常のチャット応答より優先する。

## 合言葉の意味

ユーザーが `作業完了`（明らかな途中送信である `作業完` を含む）とだけ送った場合、それは「会話本文へ報告を貼る」という意味ではない。

**Gitをfetchし、共有台帳と実際の提出物を自分で発見して、現在の担当に必要な処理を直ちに実行せよ**というワークフロートリガーである。

「何をすればよいですか」「報告を貼ってください」「次の作業を指示してください」とユーザーへ聞き返してはいけない。

## Codexが受け取った場合

1. `git fetch --prune origin` を実行する。
2. `origin/codex/next-chat-handoff` の次を全文読む。
   - `docs/WORK_COMPLETE_PROTOCOL.md`
   - `docs/CODEX_NEXT_CHAT_HANDOFF.md`
   - `docs/CURSOR_CODEX_HANDOFF.md`
3. `docs/CURSOR_CODEX_HANDOFF.md` の「現在の状態」「現在の担当」「予定branch」「末尾の最新ログ」を確認する。
4. 予定されたCursor branchがある場合は、そのremote branchの台帳、base/head、diff、commit、テスト証跡を確認する。
5. 予定branchが見つからない場合は、remote branchを更新日時順に確認し、base以降のCursor提出を探す。ローカルcheckoutだけを見て「変化なし」と断定しない。
6. 状態に応じて処理する。
   - `READY_FOR_CODEX_REVIEW`: 実コードをレビューし、必要なテストを実行して `GO` または `CHANGES_REQUESTED` を台帳へ記録する。
   - `CHANGES_REQUESTED` 後の再提出: 指摘修正を再レビューする。
   - `CURSOR_TASK_ASSIGNED` だが提出branch/commitなし: 未提出の一次証拠を示して停止する。別Taskを勝手に始めない。
   - `GO` / `MERGED`: ユーザーが明示していないmerge、default branch変更、公開deployを行わない。
7. 終了時にJSTタイムスタンプと、全体進捗率・当該slice進捗率を報告する。

## Cursorが受け取った場合

1. `git fetch --prune origin` を実行する。
2. `origin/codex/next-chat-handoff` の本ファイル、`CODEX_NEXT_CHAT_HANDOFF.md`、`CURSOR_CODEX_HANDOFF.md`を全文読む。
3. 台帳が `CURSOR_TASK_ASSIGNED` なら、指定baseから指定branchを作り、記載Taskを実装する。
4. 台帳が `CHANGES_REQUESTED` なら、指摘された同一提出branchを修正する。
5. 実装・必須gate・2周自己レビューを終え、台帳を `READY_FOR_CODEX_REVIEW`、担当Codexに更新して停止する。
6. 自動merge、公開deploy、次Taskへの先行着手を行わない。
7. 終了時にJSTタイムスタンプと、全体進捗率・当該slice進捗率を報告する。

## 共通禁止事項

- ユーザーにCursor/Codex間の報告をコピー＆ペーストさせない。
- fetch前のlocal branch、`origin/HEAD`、会話の圧縮要約だけで現在状態を決めない。
- 他worktreeのdirty変更をreset、clean、commit、流用しない。
- 自己申告されたPASSだけで承認せず、Git差分と必要な実行結果を一次証拠にする。
