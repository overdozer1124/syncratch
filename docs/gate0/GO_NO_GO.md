# Gate 0 Go / No-Go

**Date:** 2026-07-15（制御ブロック境界 + OPCODE表駆動対応後）  
**Pin:** `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` (`v14.1.0`)  
**Root commit SHA (code freeze):** `4a14e05aba13bf459a534a2a2beffb43657996b3`

## Legend

- **Go** — 自動試験 + 必須ドキュメント完了
- **条件付き合格** — 外部／手動項目が未実施
- **別トラック** — 人的／法務

## Results

| Item | Status | Evidence |
|---|---|---|
| Parent gitlink `160000` + pin SHA | **Go** | `git ls-files --stage` + `pnpm gate0:check-pin` |
| Vendor-built VM v14.1.0 | **Go** | adapter `runtimeSource` に `vendor:` / `14.1.0` |
| Visual step: hat/command/**control** 境界 | **Go** | `opcodes.table.test.ts` — `control_repeat` で step2=`move`かつ`x=0`；`control_if` 同様 |
| GATE0_OPCODES 表駆動境界＋parity | **Go** | 10 opcode 全カバー、`runToEnd` vs visual 最終一致 |
| TypeScript build | **Go** | `pnpm build` |
| Server schema gate | **Go** | 例外→reject、authority 不変、6 tests |
| SB3 安全読み取り | **Go** | 宣言サイズ検査＋隔離（`--max-old-space-size`＋timeout；プロセス全体RSSの厳密上限ではない） |
| Collab（子プロセスサーバ） | **Go** | `pnpm gate0:collab` |
| Google fixtures | **Go** | exp/iat/RS256 |
| Real GIS / Workspace `hd` | **条件付き合格** | 別トラック |
| AGPL / 学校データ責任 | **別トラック** | — |

## Overall technical Gate 0 verdict

**Technical Go（Real GIS / Workspace `hd` / 法務は条件付き・別トラック）。**

```text
pnpm gate0:build-vendor-vm   # クリーンcheckout時は check-pin の前に必須
pnpm gate0:check-pin
pnpm build
pnpm gate0:check-licenses
pnpm gate0:test
pnpm gate0:collab
```
