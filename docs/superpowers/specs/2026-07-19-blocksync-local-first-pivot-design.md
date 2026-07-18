# BlockSync Local-First Pivot Design

**Status:** Primary product direction

**Date:** 2026-07-19

**Supersedes as primary roadmap:** `docs/specification/BlockSync-AI_システム仕様書・実装計画書_v1.2.md` and `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`

**Compatibility constraint:** Published `ProjectEnvelopeV1` bytes, canonicalization, and hash contract remain unchanged.

## 1. Decision

BlockSync Community の主系を、ログイン不要で開始できる Local-First エディターへ切り替える。単独編集の正本はブラウザー内の IndexedDB に置き、`.sb3` を常に入出力できる。Google Drive 共有とリアルタイム共同編集を選んだ場合だけ Google ログインを要求する。

既存の `apps/r1-persist-server`、SQLite 永続化・GC、Workspace、Person、名簿、RBAC、監査の実装と文書は削除しない。これらは buildable な将来の School/self-hosted track として凍結し、Community 初回リリースの実行時依存および実装順序から外す。

## 2. Product boundaries

### 2.1 First Local-First release

- ログイン不要の単独編集。
- IndexedDB を正本とするローカルプロジェクトの作成、再開、自動保存。
- `.sb3` の読み込みと書き出し。Drive、共同編集、補助サービスの障害中も書き出せる。
- Google ログイン後、Google Picker で利用者が明示的に選んだ Drive ファイルの作成またはオープン。
- Yjs/WebRTC による少人数のライブ編集。
- best-effort で選出された論理 leader による通常時の Drive snapshot 書き込みと、退出時の leadership handoff。これは厳密な分散ロックではない。
- 任意導入の Apps Script によるクラス名簿、招待、ルームメタデータ、Drive 権限設定の補助。

### 2.2 Non-goals

初回 Local-First release には、次を含めない。

- AI 支援または AI オーケストレーター。
- 中央サーバーへの作品正本、更新ログ、スナップショット、バックアップの保存。
- 大規模ルーム、多数参加者向け relay、集中型 collaboration gateway。
- 新規の学校ディレクトリ、Person、名簿、Workspace、RBAC、監査機能。
- `r1-persist-server` または SQLite を Community 利用の必須バックエンドにすること。
- Apps Script を Yjs update の relay またはプロジェクト payload の保管場所にすること。
- Drive 全体の検索、一覧化、バックアップ、管理者による一括取得。

## 3. Data ownership and compatibility

### 3.1 Local source of truth

単独編集では、各プロジェクトを独立した `LocalProjectRecord` として IndexedDB に保存する。論理フィールドは local project ID、表示名、ProjectDocument、素材 blob、ローカル revision、更新時刻、保存状態、および選択済み Drive file ID（存在する場合）である。

`LocalProjectRecord` は `ProjectEnvelopeV1` ではない。存在しない organization または user を表す偽値を作って `organizationId` や `updatedByUserId` へ格納してはならない。ローカル record から既存サーバー envelope への変換が将来必要になった場合は、明示的な migration/import 境界と実在する主体を要求する。

### 3.2 Published envelope contract

`ProjectEnvelopeV1` のフィールド、canonical JSON、`contentHash`、request hash、既存 fixture、および受理済み bytes は変更しない。ブラウザー安全化では既存 test vector と同一結果を返す実装境界を追加できるが、V1 の再直列化、`organizationId` の改名、または hash 対象の変更は行わない。

`.sb3` は相互運用用の入出力形式であり、ローカル編集 record や Yjs update log そのものではない。書き出し時には現在のローカル状態から生成し、共同編集メタデータ、Google token、参加者情報、名簿情報を埋め込まない。

## 4. Components and data flow

```text
                         optional Google login
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────┐
│ Browser / Community runtime                               │
│ Scratch host ⇄ browser-safe project core ⇄ Y.Doc         │
│       │                    │                    │           │
│       │                    ▼                    ▼           │
│       │              IndexedDB (source)   WebRTC peers     │
│       │                    │                    │           │
│       └────────────── .sb3 import/export       │           │
│                            │                    │           │
│                 best-effort leader ◄───────────┘           │
└────────────────────────────┼───────────────────────────────┘
                             │ Drive API (`drive.file`)
                             ▼
                 Picker-selected shared Drive file
                       (durable snapshots)

Optional classroom control plane:
Apps Script ─ roster / invitations / room metadata / Drive permissions
            ─ never project payloads or live Yjs updates

Frozen School/self-hosted track:
r1-persist-server ─ SQLite / GC / Workspace / roster / RBAC / audit
                  ─ buildable, but not a Community runtime dependency
```

### 4.1 Solo flow

1. 利用者はログインせずローカルプロジェクトを作成するか `.sb3` を読み込む。
2. 編集操作を ProjectDocument に反映し、同一端末の IndexedDB transaction へ保存する。
3. UI はメモリ上の未保存状態と IndexedDB 保存済み状態を区別する。
4. 利用者は任意の時点で現在状態を `.sb3` として書き出す。

### 4.2 Drive sharing flow

1. 利用者が共有を選択した時点で Google ログインを開始する。
2. Google Picker で、アプリが作成したファイルまたは利用者が明示的に選択したファイルだけを取得する。
3. Drive snapshot をローカル record/Y.Doc へ読み込み、ローカル copy を即座に保持する。
4. 参加者間のライブ変更は Yjs/WebRTC で交換する。
5. 通常時は current leader が Y.Doc の一貫した snapshot を共有 Drive ファイルへ書く。ネットワーク分断中の重複 leader を厳密には排除できないため、競合は app-level metadata と Drive の観測値で事後検出する。

### 4.3 Leader ownership and handoff

- 各 room は participant ID と leadership epoch を持ち、同期済みで Drive 書き込み権限を持つ参加者から 1 台を current leader として合意する。これは通常時の重複書き込みを減らす **best-effort の論理的 single writer** であり、partition や同時再選出を排除する厳密な分散ロックではない。
- 通常時は current leader だけが Drive 保存を試み、他の peer は Yjs update を交換して各自の IndexedDB に保存する。ただし、この役割分担だけで split-brain 時の Drive 同時更新を拒否できるとは主張しない。
- 各 Drive snapshot は app-level の `snapshotId`、`leadershipEpoch`、`yjsStateVector`、`yjsStateHash` を payload metadata に含める。各 peer は対応する snapshot metadata と Drive の `headRevisionId` / `version` 観測値をローカルにも記録する。
- leader は debounce 後、明示保存時、重要な lifecycle 境界、および正常退出前に snapshot を書く。書き込み前に Drive の `headRevisionId` / `version` と現行 snapshot metadata を再取得し、既知値との差があれば書き込まず競合状態へ移る。
- Drive API v3 の `File.version` と `headRevisionId` は output-only の観測値であり、`files.update` にそれらの一致を原子的に強制する条件はない。書き込み前の一致確認から update までには競合窓が残るため、これを atomic compare-and-swap または split-brain 拒否とは扱わない。
- update 後にも Drive の `headRevisionId` / `version` と保存された app-level snapshot metadata を再取得する。期待した `snapshotId`、`leadershipEpoch`、`yjsStateVector`、`yjsStateHash` と一致しない、観測値が想定外に進んだ、または別 peer の snapshot が見つかった場合は、競合または split-brain 疑いとして扱う。この検査は **事後検出** であり、同時書き込みの防止ではない。
- 前後検査でも、writer A の post-read 後に writer B が上書きする等の競合を即時には観測できない。再接続時、leadership handoff 時、次回保存前にも同じ照合を繰り返して検出機会を作るが、全競合の即時検出は保証しない。
- 正常退出では、leader が競合なしを確認できる場合に未保存 snapshot を flush し、次の eligible peer へ epoch と最新観測値を渡し、受領確認後に退出する。突然の切断では残存 peer が新 epoch の leader を best-effort で再選出する。
- 競合または split-brain 疑いを検出したら、自動 Drive 保存を直ちに停止する。両 peer の IndexedDB copy と、利用可能な競合 Drive revision ID・snapshot metadata を recovery candidate として保持し、Drive revision を削除しない。保持可能な binary revision は Drive の制限内で `keepForever` の対象とする。
- 復旧では各 recovery candidate を別々に読み、Yjs で再収束した結果と差分を利用者に提示する。利用者の明示確認後にのみ current leader が同じ Picker-selected file へ新 snapshot を保存して自動保存を再開する。別ファイルへの自動作成・自動上書きで競合から逃げない。
- leader が存在しない、誰も Drive 書き込み権限を持たない、または競合停止中は Drive 永続化を停止するが、各 peer の IndexedDB 保存と `.sb3` 書き出しは継続する。
- Apps Script は roster、invitation、room metadata、Drive permission setup の任意補助に留め、leader election または Drive 書き込みの必須 lock service にしない。

## 5. Failure semantics

「外部機能の障害でローカル作品を取り出せなくしない」を最優先の不変条件とする。

| Failure | Required behavior |
|---|---|
| IndexedDB write failure | メモリ上の dirty 状態を破棄せず、保存失敗を明示し、可能な限り即時 `.sb3` download を提示する。保存済み record を部分更新で壊さない。 |
| Drive unavailable、token expiry、quota、permission loss | ローカル編集を継続し、未同期状態を表示する。自動的に別ファイルへ書かない。再認証または Picker による再選択を求めつつ `.sb3` export を維持する。 |
| WebRTC peer failure | 到達可能な peer とローカル編集を継続する。切断 peer の未受信変更を保存済みと表示しない。各端末のローカル copy は export 可能なままにする。 |
| Signaling unavailable | 新規接続・再接続だけを停止する。既存 data channel とローカル編集は継続し、中央 relay へ切り替えない。 |
| Apps Script unavailable | 名簿、招待、room metadata、権限自動設定だけを degraded とする。エディター、IndexedDB、既存 WebRTC room、Drive 直接保存、`.sb3` export を停止しない。 |
| Leader departure or crash | 正常時は競合なしを確認して flush + handoff、異常時は epoch を進めて best-effort で再選出する。厳密な lock 成立を仮定せず、Drive 保存不能でもローカル保存と export は継続する。 |
| Concurrent Drive update / split-brain suspicion | 前後の `headRevisionId` / `version` と app-level snapshot metadata による事後検出である。検出時は自動 Drive 保存を停止し、両方の IndexedDB copy と利用可能な Drive revisions を保持する。Yjs 再収束と利用者確認後だけ再保存し、別ファイルへ自動退避しない。 |

Drive、WebRTC、signaling、Apps Script の障害画面には、ローカルに保存された最終時刻、未同期状態、および `.sb3` 書き出し操作を表示する。

## 6. Privacy, OAuth, and trust boundaries

- 単独編集では Google ログイン、学校アカウント、氏名、メール、Workspace membership を要求しない。
- Drive 連携の OAuth scope は `drive.file` のみに限定する。広い `drive`、`drive.readonly`、Gmail、Classroom scope は要求しない。
- ファイル選択には Google Picker を使い、アプリが作成したファイルまたは利用者が明示選択したファイルだけを扱う。Drive 全体を列挙または探索しない。
- access token、refresh token、Picker token をプロジェクト payload、Y.Doc、`.sb3`、Apps Script property、ログへ保存しない。
- WebRTC peer へ共有する情報はライブ編集、必要最小限の presence、room negotiation に限定する。Google token、Drive 権限情報、名簿全体を送らない。
- signaling は接続成立に必要な offer/answer/ICE と短命 room identifier だけを扱い、Yjs update または project snapshot を保存・relay しない。
- Apps Script は classroom control plane であり、プロジェクト内容を読まない。保存できるのは roster、invitation、room metadata、Drive permission setup の結果だけである。
- 共有 Drive ファイルへのアクセス制御と保持は利用者の Google Drive 権限に従う。BlockSync が中央バックアップを持つと表示してはならない。

## 7. Runtime separation

### Community runtime dependencies

- `apps/r1-scratch-host` を基礎とするブラウザー host。
- ブラウザー安全な project schema、validation、canonicalization/hash compatibility boundary。
- IndexedDB local repository と asset storage。
- `.sb3` import/export。
- Yjs/WebRTC provider と最小 signaling。
- Google Identity、Picker、Drive `drive.file` adapter。
- 任意の Apps Script classroom adapter。未設定でも Community editor は動作する。

### Frozen School/self-hosted packages

- `apps/r1-persist-server`。
- `packages/project-store-sqlite` の migrations、revision persistence、asset GC。
- `packages/session-service`、`packages/auth-context` の server session path。
- `packages/workspace-directory` と Workspace/Person/roster/RBAC/audit schema・repository。
- School 管理 API/UI、集中バックアップ、集中監査、サーバー WebSocket 認可。

Community package から frozen package への runtime import を追加しない。共用する純粋な型またはアルゴリズムが必要な場合は、ブラウザー安全性と既存 contract tests を満たす独立境界へ抽出し、School package の挙動を暗黙に変更しない。

## 8. Existing server work and migration treatment

- 受理済み server、SQLite、GC、auth、Workspace migration、Person/UserAccount、directory repository の code、fixture、設計書、Go/No-Go 証跡を保持する。
- `r1-persist-server` と関連 package は通常の build/test で buildable に保つ。ただし Local-First 機能追加のための schema 拡張や Community からの依存追加は行わない。
- 未完了の class move、overlap service、claim、System Owner transfer、Person 関連付け、audit service/API/UI は凍結する。特に現在 pending の Person + audit 設計を Local-First 前提へ書き換えず、School/self-hosted track 再開時の設計入力として残す。
- 既存の server project を Local-First へ自動移行しない。将来の migration は、認可された明示 export/import、asset 完全性、V1 byte/hash preservation、利用者への保存先選択を満たす別設計とする。
- ローカル record に legacy organization/user の代用値を埋めず、server DB row と LocalProjectRecord を同一 ID 空間と仮定しない。

## 9. Staged delivery

### Stage 0 — Browser-safe core

次の実装 slice とする。

- `ProjectEnvelopeV1` の公開 contract と hash test vector を固定したまま、ProjectDocument の validation、canonicalization、SHA-256 境界をブラウザーで利用可能にする。
- Node-only import が Community browser bundle へ混入しないことを build test で証明する。
- `LocalProjectRecord` の versioned schema、validation、upgrade policy を定義する。organization/user の偽値を禁止する contract test を含める。
- IndexedDB、Drive、Yjs、UI はこの slice へ混在させない。

**Gate:** browser build、既存 Node tests、V1 canonical/hash vectors が同時に通り、既存 V1 bytes/hash に差分がない。

### Stage 1 — Local MVP

- IndexedDB repository、atomic save、asset lifecycle、再起動後の復元。
- ログインなしの作成、編集、自動保存。
- `.sb3` import/export と障害時 export recovery。
- quota、transaction abort、schema upgrade、破損 record の試験。

**Gate:** オフライン状態で新規作成、再起動復元、`.sb3` roundtrip が成立し、保存失敗時にも作品を export できる。

### Stage 2 — Drive

- Google login、`drive.file` consent、Google Picker。
- Picker-selected file の作成・読込と、`snapshotId` / `leadershipEpoch` / `yjsStateVector` / `yjsStateHash` を持つ snapshot 書き込み。
- 書き込み前後に `headRevisionId` / `version` と app-level snapshot metadata を取得する post-write conflict detection。Drive API による atomic CAS ではないことを API contract と UI に明示する。
- token expiry、permission loss、quota、concurrent update の degraded behavior。競合時は自動保存停止、local copy と Drive revisions の保持、利用者確認付き recovery とする。

**Gate:** Drive 障害中も local source of truth が維持され、再接続後に明示的に同期できる。広い OAuth scope を要求しない。観測可能な metadata 不一致を作る制御済み並行 update 試験で事後検出し、自動保存を停止して recovery candidates を保持する。検査をすり抜ける race window を文書化し、`File.version` / `headRevisionId` を atomic precondition または全競合検出として扱う実装がない。

### Stage 3 — P2P

- Y.Doc mapping、WebRTC provider、最小 signaling、presence。
- best-effort の logical leader election、通常時の single-writer behavior、正常 handoff、crash re-election。
- partition、同時再選出、split-brain、late peer、並行 Drive update、利用者確認付き recovery の試験。
- Apps Script を必須 lock service としない構成試験。

**Gate:** 非 partition 時は logical leader だけが Drive 保存を試み、live edits が peer 間で収束する。partition で複数 writer が生じ得る試験では厳密な排他を主張しない。競合または split-brain 疑いを観測した client は直ちに自動 Drive 保存を停止し、通知を受けた peer も停止する。切断中の peer は観測まで継続し得るため、再接続時の照合で停止へ収束することを試験する。両方の IndexedDB copy と Drive revisions を保持し、Yjs 再収束と利用者確認前には再保存しない。どの通信障害でも各端末から `.sb3` を書き出せる。

### Stage 4 — Optional Apps Script

- roster、invitation、room metadata、Drive permission setup。
- payload/Yjs relay 禁止を API contract、ログ検査、サイズ制限で確認する。
- Apps Script 未導入・障害時の Community runtime 非依存を試験する。

**Gate:** Apps Script を削除または停止しても solo、Drive、既存 P2P room、export が動作する。

### Stage 5 — Release gates

- 対応 Chrome/ChromeOS/Windows で local recovery と `.sb3` corpus を確認。
- OAuth consent と scope、Picker-only access、token 非永続化をレビュー。
- WebRTC threat model、room abuse、metadata minimization をレビュー。
- School server packages の build/test と Community bundle の dependency scan を実行。
- 既知の制限、中央バックアップがないこと、Drive 権限・保持責任を利用者へ表示する。

## 10. Acceptance criteria

1. 未ログイン利用者がプロジェクトを作成・編集し、IndexedDB から再開し、`.sb3` を入出力できる。
2. LocalProjectRecord は `ProjectEnvelopeV1` と別 schema で、fake organization/user 値を持たない。
3. Drive 共有または共同編集を選ぶまで Google ログインを要求しない。
4. OAuth scope は `drive.file` のみで、ファイルアクセスは Google Picker で明示選択された範囲に限る。
5. ライブ編集は Yjs/WebRTC で運び、signaling と Apps Script は Yjs update を relay・保存しない。
6. WebRTC leader election は通常時の重複書き込みを減らす best-effort の logical single writer であり、partition 時の厳密な分散ロックまたは atomic split-brain rejection を保証すると表示しない。
7. Drive、WebRTC、signaling、Apps Script のいずれが失敗しても、ローカルデータを保持し `.sb3` として書き出せる。
8. 各 Drive snapshot は app-level `snapshotId`、`leadershipEpoch`、`yjsStateVector`、`yjsStateHash` を持つ。保存前後、再接続、handoff、次回保存前に Drive `headRevisionId` / `version` と app metadata を再取得するが、これは output-only 値による best-effort の事後競合検出であり、atomic CAS、即時検出、全競合検出ではない。
9. 競合または split-brain 疑いでは自動 Drive 保存を停止し、両方の IndexedDB copy と利用可能な Drive revisions を保持する。Yjs 再収束後、利用者の明示確認前に再保存せず、別ファイルへ自動上書き退避しない。
10. Apps Script は roster、invitation、room metadata、Drive permission setup に限定され、project payload を保存せず、必須 lock service にしない。
11. `r1-persist-server`、SQLite GC、Workspace/roster/RBAC/audit は buildable な frozen School/self-hosted track として残り、Community runtime の必須依存ではない。
12. AI、中央バックアップ、大規模ルーム、新規 school-directory 機能は初回 Local-First release に含まれない。
13. 公開済み `ProjectEnvelopeV1` と hash contract は byte/hash compatibility tests を通し、変更されない。
14. Stage 0 から Stage 5 の gate を順に満たし、前段 gate を迂回して次段を release しない。
