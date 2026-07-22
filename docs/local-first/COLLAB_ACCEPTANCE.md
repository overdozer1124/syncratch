# Syncratch 共同編集 受け入れ手順

前提: **新しい部屋**で確認する。古いタブ／古い招待 URL は使わない。変更反映後は **hard reload**（キャッシュ無視）する。

ローカル検証の既定:

- Editor: `http://127.0.0.1:5173/`（本番相当ならデプロイ origin）
- Signaling: `ws://127.0.0.1:4444`（`VITE_COLLAB_SIGNALING_URL` と一致）

## チェックリスト

両方のブラウザ（ホスト / ゲスト）で、次を順に確認する。

1. **起動表示**
   - タイトル／ツールバーに `Syncratch` と `シンクラッチ` が見える
   - パレットが日本語（漢字）。例: 「動き」（ひらがな版の「うごき」ではない）
2. **招待 URL**
   - 「いっしょに作るリンクを作る」で得た URL の origin / port が、開いている editor と一致する
   - ゲストがその URL（または貼り付け）で「友だちの作品に入る」でき、双方が「いっしょに作っています」になる
3. **forever nest / detach**
   - ホストで forever の中にブロックを入れ、確定後にゲストでも同じ入れ子になる
   - forever から外して確定後、ゲストでも外れた状態になる
4. **ライブラリスプライト追加**
   - ホストで Basketball を追加 → ゲストにも Basketball が表示され、コスチュームが「？」にならない
   - 双方とも「このパソコンに保存しました」になる
5. **別スプライト編集**
   - ホストがスプライト A、ゲストがスプライト B を編集しても、双方の変更が残る（上書きで消えない）
6. **選択維持（B）**
   - 双方が Basketball（B）を選択した状態で、片方が B を編集しても、受信側の選択は B のまま
   - 片方が A を編集しても、もう片方の B 選択は維持される
7. **ローカル UI（tab / viewport）**
   - コスチュームタブや Blockly の pan/zoom を動かしたあと、相手のブロック編集を受けても **自分のタブと表示位置が維持**される
   - スプライトごとに異なる viewport が漏れない（A を default、B を非 default のまま）
8. **ローカル保存**
   - 共同編集中も双方でローカル保存が成功する
   - 「いっしょに作るのをやめる」後も、各自の作品を SB3 ダウンロードできる

## 自動試験（参考）

```bash
pnpm --filter @blocksync/editor-web test:e2e -- e2e/editor.spec.ts e2e/collab.spec.ts
```

実 Chromium 2-context 試験には、上記の Basketball・別ターゲット収束・**選択維持**・**local UI（tab/viewport）**・招待 origin 一致が含まれる。

最終受け入れの自動ゲート一覧は `docs/local-first/FINAL_ACCEPTANCE_REPORT.md` を参照する。

## 既知の限界（受け入れ対象外）

- 同一スプライト上の同時ブロック編集は `blocksJson` 全体の LWW（後勝ち）
- regular remote apply では active tab / per-target Blockly viewport を local-only で保全する。`currentCostume` など共有作品状態や、guest-initial / new / open での前作品 UI 復元は対象外
- 旧形式（単一 `json` target）と新形式（`metadataJson` + `blocksJson`）の混在ライブ部屋は対象外
