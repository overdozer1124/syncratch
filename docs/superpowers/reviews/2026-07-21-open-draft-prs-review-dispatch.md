# 独立レビュー依頼: Open Draft PRs（#4 → #3）

**Date:** 2026-07-21  
**Base branch:** `feat/local-first-pivot-impl`  
**Repo:** https://github.com/overdozer1124/syncratch  
**依頼種別:** 実装コードの独立レビュー（マージ判断材料）。実装・マージ・Draft 解除はしない。

## 現状

| PR | Branch | 状態 | 内容 |
|----|--------|------|------|
| [#1](https://github.com/overdozer1124/syncratch/pull/1) | `cursor/p2p-bootstrap-optional-drive-f431` | MERGED | Drive-independent P2P bootstrap |
| [#2](https://github.com/overdozer1124/syncratch/pull/2) | `cursor/local-record-recovery-f431` | MERGED | corrupt local-record recovery + unified status |
| [#4](https://github.com/overdozer1124/syncratch/pull/4) | `cursor/cumulative-staging-dos-f431` | OPEN draft, CI green | 累積 staging DoS 制限・状態機械硬化 |
| [#3](https://github.com/overdozer1124/syncratch/pull/3) | `cursor/japanese-child-friendly-ux-f431` | OPEN draft, CI green | 日本語・小学生向け UI |

両 Draft は同一 base から分岐しており、**変更ファイルの重なりはない**。どちらかを先にマージしたら、もう一方は rebase 後の再確認が必要になり得る。

## 推奨レビュー順

1. **先に PR #4**（正しさ／セキュリティ）  
   → 詳細: [`2026-07-21-pr4-cumulative-staging-dos-review-brief.md`](./2026-07-21-pr4-cumulative-staging-dos-review-brief.md)
2. **次に PR #3**（UX／回帰）  
   → 詳細: [`2026-07-21-pr3-japanese-child-friendly-ux-review-brief.md`](./2026-07-21-pr3-japanese-child-friendly-ux-review-brief.md)

別エージェントに分ける場合は、共通ルールを各エージェントに渡し、上記 brief をそれぞれ担当させる。

## 共通ルール（全レビュー担当）

あなたは syncratch (BlockSync) の独立コードレビュー担当です。

### やってよいこと

- 対象ブランチを checkout し、diff・仕様・テストを読む
- 必要ならテスト／typecheck を実行する
- 指摘・質問・合否判定を返す

### やってはいけないこと

- コード実装・リファクタ
- マージ、Draft 解除、approve / request-changes の GitHub 操作
- Approved 仕様の編集:  
  `docs/superpowers/specs/2026-07-20-p2p-bootstrap-optional-drive-design.md`  
  （**読むのは可、書き換え不可**）

### レビュー姿勢

- スタイルや好みより、正しさ・セキュリティ・回帰・契約違反を優先
- 「良さそう」で済ませず、失敗モードを具体的に挙げる
- テストが意図を固定しているかも見る（偽陰性・抜け穴）
- 指摘は優先度付き:
  - **P0:** マージ前に必須修正（データ破壊、セキュリティ穴、契約破砕、重大回帰）
  - **P1:** マージ前に直すか、明示的に許容理由が必要
  - **P2:** 改善提案（ブロッカーではない）

### 成果物フォーマット

1. **結論:** Approve / Approve with nits / Request changes
2. **要約**（3〜5行）
3. **Findings**（各項目: 優先度 / ファイル:行付近 / 問題 / なぜ危険か / 再現または根拠 / 提案）
4. **テストギャップ**
5. **仕様・契約との整合メモ**
6. **質問**（仕様判断が必要なものだけ）

両レビューが揃ったら（または単一エージェントが両方終えたら）末尾に:

- マージ推奨順
- 片方マージ後にもう一方の rebase 再確認が必要か
- Draft のままか Ready for review にしてよいか

## エージェント起動用プロンプト（コピー用）

### エージェント A — PR #4

```text
docs/superpowers/reviews/2026-07-21-open-draft-prs-review-dispatch.md の共通ルールに従い、
docs/superpowers/reviews/2026-07-21-pr4-cumulative-staging-dos-review-brief.md の指示どおり
PR #4 (https://github.com/overdozer1124/syncratch/pull/4) を独立レビューせよ。
コード変更・マージ・Draft解除は禁止。成果物フォーマットに従って結果だけ返せ。
```

### エージェント B — PR #3

```text
docs/superpowers/reviews/2026-07-21-open-draft-prs-review-dispatch.md の共通ルールに従い、
docs/superpowers/reviews/2026-07-21-pr3-japanese-child-friendly-ux-review-brief.md の指示どおり
PR #3 (https://github.com/overdozer1124/syncratch/pull/3) を独立レビューせよ。
コード変更・マージ・Draft解除は禁止。成果物フォーマットに従って結果だけ返せ。
PR #4 の staging 実装の再設計はスコープ外。
```

### 単一エージェントで両方

```text
docs/superpowers/reviews/2026-07-21-open-draft-prs-review-dispatch.md に従い、
先に PR #4、次に PR #3 を独立レビューせよ。各 brief を読め。
コード変更・マージ・Draft解除は禁止。それぞれの成果物のあと、マージ推奨順を書け。
```
