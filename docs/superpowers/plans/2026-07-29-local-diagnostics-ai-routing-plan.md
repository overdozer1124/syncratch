# Browser-Local Diagnostics and AI Routing Implementation Plan

> **実装担当エージェント向け:** 各Phaseは独立した新しい作業コンテキストで順番に実行できるように分割している。実装は必ず最新の`main`から作成した新規ブランチで行い、各Phaseのテストとレビューを通してから次へ進むこと。

**Goal:** 既存の外部AI助言を成人向けの明示選択機能として維持しながら、全年齢・APIキー不要・外部送信なしの標準ルール診断を追加し、対応端末だけで使えるTransformers.js説明機能を任意層として分離する。

**Architecture:** `ProjectDocument → DiagnosticProjectIR → Analysis Facts → Rules → Findings → Hint Presenter`を標準経路とする。既存`@blocksync/ai-assist`と`POST /ai/chat`は外部AI経路として保持する。Transformers.jsはWeb Worker内で明示操作後にだけ遅延ロードし、失敗時は標準ヒントへ戻す。標準診断から外部AIへの自動フォールバックは禁止する。

**Baseline:** 初回計画作成時の取り込み基準は`main @ eb045b9`、初回調査基準は`2ac908b`、AIコード基準は`71e54c7`。計画ブランチはPR #175反映後の`main @ 642964d`へ追従済みで、追加差分に本設計と競合するローカル診断実装がないことを確認した。実装開始時には再度最新`main`へ追従し、差分を確認すること。

**Tech Stack:** TypeScript 5.8、pnpm workspace、Vitest、Playwright、Vite 7、Scratch VM/SB3、`@blocksync/project-schema`、任意層のみ`@huggingface/transformers` 4.2.0。

---

## Global invariants

- APIキーがなくても標準診断は利用できる。
- 標準診断はネットワーク、Transformers.js、WebGPU、外部AIの状態に依存しない。
- `blocksync.ai-assist.settings.v1`の形式・キー・既存値を変更しない。
- `/ai/chat`のwire contractを変更しない。
- 外部AIを標準診断の自動フォールバック先にしない。
- 外部AIへ送る直前に、処理場所と送信範囲を表示し、明示操作を要求する。
- `BlockIRProposal`は将来の変更提案用として残し、診断IRへ流用しない。
- 診断、モデル、同意状態をProjectDocument、Y.Doc、SB3、Drive、signalingへ保存しない。
- ルール診断結果は観測事実と推測を分離し、確信度を必須にする。
- Transformers.jsはアプリ起動時にimport、Worker生成、モデル照会、ダウンロードを行わない。
- 端末内AIの失敗はCore編集・実行・保存・標準診断へ波及させない。
- AIまたは診断結果からScratchプロジェクトを自動変更しない。

---

# Phase 0: Documentation discovery and allowed APIs

このPhaseは計画作成時に実施済み。実装開始時に参照先が最新`main`で変わっていないことだけ再確認する。

## 0.1 Repository sources

- `docs/CURSOR_CODEX_HANDOFF.md`
  - 「Codex向け: 実装済み AI 助言ブランチ一覧」
  - AI本体が`packages/ai-assist`と`apps/editor-web`へ統合済みであること。
- `docs/superpowers/specs/2026-07-23-ai-advice-assist-design.md`
  - 既存AIの非干渉境界、データ境界、未実装事項。
- `packages/ai-assist/src/settings.ts`
  - `AI_SETTINGS_STORAGE_KEY`、`loadAiAssistSettings()`、`saveAiAssistSettings()`、`resolveAiAssistConfig()`。
- `packages/ai-assist/src/client.ts`
  - `requestAiChat(request: AiChatRequest): Promise<AiChatResult>`。
- `packages/ai-assist/src/prompt.ts`
  - `BuildAdvicePromptInput.observationNotes`。ルールFindingを既存外部AIへ渡す既存の接続口。
- `packages/ai-assist/src/context.ts`
  - `buildAiProjectContext()`、SUBSTACK/SUBSTACK2走査。LLM向け要約であり診断IRではない。
- `packages/ai-assist/src/ir.ts`
  - `BlockIRProposal`は編集提案専用。
- `apps/collab-host/src/ai-proxy.ts`
  - `handleAiChatProxy()`とBearer APIキー転送。
- `apps/editor-web/src/main.ts`
  - `documentFromVm()`、`readProjectJsonForAi()`、`renderAiUi()`、`askAiWithIntent()`。
- `apps/editor-web/src/ai-assist-ui.ts`
  - DOM非依存UI純関数の既存パターン。
- `apps/editor-web/src/ai-floating-panel.ts`
  - portal、非modal、ドラッグ、disposeの既存パターン。
- `packages/project-schema/src/index.ts`
  - `ProjectDocument`、`ScratchTarget`、`ScratchBlock`、`extractBlockRefsFromInput()`、`validateProject()`。
- `packages/sb3-tools/src/canonical-io.ts`
  - `projectJsonToDocument()`、`documentToProjectJson()`。
- `packages/sb3-tools/src/block-graph-canonical.ts`
  - cycle-safeなnext/input/substack走査と安定化の参考実装。
- `apps/editor-web/src/workspace-desync-diagnostics.ts`
  - VM/Blockly接続グラフの既存正規化例。新パッケージから直接依存しない。

## 0.2 Allowed repository APIs

```ts
validateProject(
  doc: ProjectDocument,
  options?: ValidateOptions,
): ValidationResult;

extractBlockRefsFromInput(value: unknown): BlockId[];

requestAiChat(request: AiChatRequest): Promise<AiChatResult>;

buildAdviceMessages(input: BuildAdvicePromptInput): AiChatMessage[];
```

live VMの最新状態取得は`apps/editor-web/src/main.ts`の既存`documentFromVm()`を使う。`current.document`だけを診断すると未保存編集を見落とすため禁止する。

## 0.3 Transformers.js official APIs

参照する公式資料:

- https://github.com/huggingface/transformers.js/releases
- https://huggingface.co/docs/transformers.js/en/api/pipelines
- https://huggingface.co/docs/transformers.js/en/guides/dtypes
- https://huggingface.co/docs/transformers.js/en/guides/webgpu
- https://huggingface.co/docs/transformers.js/api/env
- https://huggingface.co/docs/transformers.js/api/utils/model_registry
- https://huggingface.co/docs/transformers.js/en/tutorials/react
- https://huggingface.co/docs/transformers.js/en/tutorials/next

許可するAPI形:

```ts
pipeline("text-generation", modelId, {
  dtype: "q4",
  device: "webgpu",
  revision: pinnedCommit,
  progress_callback,
});

ModelRegistry.get_pipeline_files(task, modelId, options);
ModelRegistry.get_file_metadata(modelId, file, options);
ModelRegistry.is_pipeline_cached(task, modelId, options);
ModelRegistry.is_pipeline_cached_files(task, modelId, options);
ModelRegistry.clear_pipeline_cache(task, modelId, options);
```

依存は検証版へ完全固定する。

```json
"@huggingface/transformers": "4.2.0"
```

## 0.4 Documentation anti-pattern guards

- `ScratchProjectJsonLike`を診断IRの入力型として流用しない。変数、リスト、broadcast、mutation情報が不足する。
- `validateProject()`の構造検査を新ルールとして書き直さない。
- `projectJsonToDocument()`を診断ボタンから無条件に直接呼ばない。既存のlive document経路を使う。
- `apps/editor-web/src/diagnostics.ts`を新機能へ流用しない。既にE2E診断公開フラグとして使用中。
- `navigator.gpu`の存在だけで端末内AIを利用可能と判定しない。
- Transformers.jsの未確認API、未確認option、モデルの可変`main` revisionを使用しない。

### Phase 0 verification

- [ ] 実装ブランチの`main`基準SHAを記録する。
- [ ] 上記APIのsignatureが変わっていないことを確認する。
- [ ] 既存AI関連テストを変更前に実行し、baseline結果を保存する。
- [ ] Transformers.js公式latestと固定候補版を再確認する。版を変更する場合は本計画のAPI例も更新する。

---

# Phase 1: Diagnostic contracts and package boundary

## Task 1.1: Create `@blocksync/diagnostics-core`

**Files:**

- Create: `packages/diagnostics-core/package.json`
- Create: `packages/diagnostics-core/tsconfig.json`
- Create: `packages/diagnostics-core/src/index.ts`
- Create: `packages/diagnostics-core/src/contracts.ts`
- Create: `packages/diagnostics-core/src/contracts.test.ts`

**Reference patterns:**

- Copy package structure and scripts from `packages/ai-assist/package.json`.
- Copy TypeScript configuration style from `packages/project-schema/tsconfig.json`.
- `pnpm-workspace.yaml` already includes `packages/*`; do not add a special workspace entry.

**Public contract:**

```ts
export type DiagnosticConfidence = "certain" | "likely" | "possible";
export type DiagnosticSeverity = "integrity" | "warning" | "suggestion";

export interface DiagnosticEvidence {
  kind: string;
  targetId?: string;
  blockIds: string[];
  detail?: string;
}

export interface DiagnosticFinding {
  ruleId: string;
  category: string;
  severity: DiagnosticSeverity;
  confidence: DiagnosticConfidence;
  targetIds: string[];
  blockIds: string[];
  evidence: DiagnosticEvidence[];
  rootCauseGroup?: string;
  hintId: string;
}

export interface DiagnosticReport {
  schemaVersion: 1;
  findings: DiagnosticFinding[];
  limitations: string[];
  elapsedMs?: number;
}
```

- [ ] Write RED tests for required fields, stable finding order, and duplicate suppression keys.
- [ ] Implement only types and deterministic normalization helpers.
- [ ] Export the public surface through`src/index.ts`.
- [ ] Run focused tests and typecheck.

**Verification:**

```powershell
pnpm --filter @blocksync/diagnostics-core test
pnpm --filter @blocksync/diagnostics-core typecheck
```

**Anti-pattern guards:**

- Do not import`@blocksync/ai-assist`.
- Do not add browser、DOM、fetch、Transformers.js dependencies.
- Do not put learner-facing Japanese strings in structural contracts.

## Task 1.2: Define the read-only diagnostic IR

**Files:**

- Create: `packages/diagnostics-core/src/ir.ts`
- Create: `packages/diagnostics-core/src/ir.test.ts`
- Modify: `packages/diagnostics-core/src/index.ts`
- Modify: `packages/diagnostics-core/package.json`

**Dependency:** `@blocksync/project-schema: workspace:*`

**Contract:**

```ts
export interface DiagnosticProjectIR {
  schemaVersion: 1;
  targets: DiagnosticTargetIR[];
  variablesById: ReadonlyMap<string, DiagnosticVariableIR>;
  listsById: ReadonlyMap<string, DiagnosticListIR>;
  broadcastsById: ReadonlyMap<string, DiagnosticBroadcastIR>;
}

export interface DiagnosticBlockIR {
  id: string;
  targetId: string;
  opcode: string;
  parentId: string | null;
  nextId: string | null;
  topLevel: boolean;
  shadow: boolean;
  inputs: ReadonlyMap<string, DiagnosticInputIR>;
  fields: ReadonlyMap<string, DiagnosticFieldIR>;
}
```

- [ ] Copy fixture shapes from `packages/project-schema/src/index.test.ts` and C-block fixtures from `packages/ai-assist/src/index.test.ts`.
- [ ] Write RED tests for next、parent、SUBSTACK、SUBSTACK2、primitive shadow、broadcast menu shadow、cycle-safe traversal.
- [ ] Implement `buildDiagnosticProjectIR(document: ProjectDocument): DiagnosticProjectIR`.
- [ ] Use`extractBlockRefsFromInput()` where primary/shadow distinction is not required; add one documented input normalizer where distinction is required.
- [ ] Keep block and target IDs unchanged for evidence display.

**Verification:**

- Every source block appears once in the IR.
- Invalid/cyclic input does not hang.
- IR construction is deterministic for identical`ProjectDocument` input.

**Anti-pattern guards:**

- Do not accept raw VM objects or Blockly workspace in this package.
- Do not stringify scripts and then regex-match them.
- Do not mutate`ProjectDocument` or reuse`BlockIRProposal`.

---

# Phase 2: Structural facts, rule engine, and staged hints

## Task 2.1: Adapt existing schema validation into integrity findings

**Files:**

- Create: `packages/diagnostics-core/src/schema-findings.ts`
- Create: `packages/diagnostics-core/src/schema-findings.test.ts`
- Modify: `packages/diagnostics-core/src/index.ts`

**Reference:** `packages/project-schema/src/index.ts: validateProject()` and `ValidationIssue`.

- [ ] Write RED mappings for missing variable/list/broadcast/target/block references.
- [ ] Separate corrupted-project findings from learner logic hints with`severity: "integrity"`.
- [ ] Preserve the original issue code and path in evidence.
- [ ] Map parent/next mismatch、cycle、duplicate ID and multi-occupant input to integrity messages, not educational blame.
- [ ] Deduplicate by code/path/evidence.

**Anti-pattern guard:** Do not move educational wording into`project-schema`.

## Task 2.2: Implement the rule registry and initial semantic rules

**Files:**

- Create: `packages/diagnostics-core/src/rules/types.ts`
- Create: `packages/diagnostics-core/src/rules/registry.ts`
- Create: `packages/diagnostics-core/src/rules/empty-c-block.ts`
- Create: `packages/diagnostics-core/src/rules/broadcast-flow.ts`
- Create: `packages/diagnostics-core/src/rules/*.test.ts`
- Modify: `packages/diagnostics-core/src/index.ts`

**Rule contract:**

```ts
export interface DiagnosticRule {
  id: string;
  run(ir: DiagnosticProjectIR): DiagnosticFinding[];
}

export function diagnoseProject(
  document: ProjectDocument,
  options?: DiagnosticRunOptions,
): DiagnosticReport;
```

**Initial rules:**

1. Empty C-block body: suggestion、certain.
2. Broadcast sent but no matching receive hat: warning、certain about the observed graph.
3. Broadcast receive hat with no matching sender: suggestion、likely.
4. Empty event script: suggestion、certain.

Broadcast matching must resolve`BROADCAST_OPTION` through menu shadow blocks; parent block fields aloneを見ない。

- [ ] Write normal、positive、near-miss、multiple-target fixtures before implementation.
- [ ] Run RED tests.
- [ ] Implement each rule as a pure function.
- [ ] Add stable registry order and explicit rule IDs.
- [ ] Add a per-rule false-positive note to code comments and documentation.

**Do not add initially:**

- Missing green-flag hat.
- Hatless top-level scripts.
- Variable initialization warnings without task context.
- Infinite-loop warnings.
- Clone lifecycle warnings as certain errors.

## Task 2.3: Add hint catalog and priority/suppression

**Files:**

- Create: `packages/diagnostics-core/src/hints/ja.ts`
- Create: `packages/diagnostics-core/src/hints/presenter.ts`
- Create: `packages/diagnostics-core/src/hints/presenter.test.ts`
- Create: `packages/diagnostics-core/src/prioritize.ts`
- Create: `packages/diagnostics-core/src/prioritize.test.ts`

**Contract:**

```ts
export interface StagedHint {
  hintId: string;
  stages: readonly [string, string?, string?];
  genericDebugActions: string[];
}
```

- [ ] Keep facts and Japanese presentation separate.
- [ ] Show at most three primary findings initially.
- [ ] Group secondary symptoms under`rootCauseGroup`.
- [ ] Never generate a complete script in level 1–2 hints.
- [ ] If no rule matches, return a generic debugging guide rather than an invented diagnosis.
- [ ] Test that compound findings do not produce contradictory hints.

## Task 2.4: Add mutation fixtures and release corpus

**Files:**

- Create: `packages/diagnostics-core/src/testing/project-fixtures.ts`
- Create: `packages/diagnostics-core/src/testing/mutations.ts`
- Create: `packages/diagnostics-core/src/release-corpus.test.ts`
- Create: `fixtures/diagnostics/README.md`

- [ ] Build normal projects from first-party fixtures only.
- [ ] Implement single mutations for each supported rule.
- [ ] Add selected pairwise mutations to test priority and suppression.
- [ ] Store expected rule IDs、confidence、primary finding order as the oracle.
- [ ] Add normal creative variants to measure false positives.
- [ ] Do not scrape public Scratch projects in this phase.

**Phase 2 acceptance:**

- Supported rules have positive、negative、near-miss tests.
- Normal corpus has zero`integrity` false positives.
- No-match path always yields a generic debugging guide.
- Runtime is linear in targets+blocks+edges; add a synthetic large-project regression test.

---

# Phase 3: Editor integration and standard hint UI

## Task 3.1: Extract a neutral live-project snapshot adapter

**Files:**

- Create: `apps/editor-web/src/live-project-snapshot.ts`
- Create: `apps/editor-web/src/live-project-snapshot.test.ts`
- Modify: `apps/editor-web/src/main.ts`

**Reference:** Copy the current error-handling pattern from`readProjectJsonForAi()` and the normalized live state pattern from`documentFromVm()`.

```ts
export interface LiveProjectSnapshot {
  document: ProjectDocument;
  rawProjectJson: unknown;
}
```

- [ ] Write RED tests for no VM、invalid JSON、normal snapshot、unsaved edit snapshot.
- [ ] Extract one adapter used by diagnostics; keep existing external AI behavior unchanged.
- [ ] Return a user-safe unavailable result on conversion failure.
- [ ] Do not fall back to stale`current.document` silently.

## Task 3.2: Add standard diagnostic controller

**Files:**

- Create: `apps/editor-web/src/diagnostic-controller.ts`
- Create: `apps/editor-web/src/diagnostic-controller.test.ts`
- Modify: `apps/editor-web/package.json`

**Contract:**

```ts
export interface DiagnosticController {
  run(): Promise<DiagnosticViewModel>;
  revealNextHint(findingId: string): DiagnosticViewModel;
  reset(): void;
}
```

- [ ] Keep controller independent of`AiAssistSettings` and`resolveAiAssistConfig().ready`.
- [ ] Add stale-run protection using a monotonically increasing run ID.
- [ ] Do not write project state or mark the project dirty.
- [ ] Add view models for findings、no-match generic guide、integrity issue、unavailable snapshot.

## Task 3.3: Add the `ヒントを見る` UI

**Files:**

- Modify: `apps/editor-web/index.html`
- Create: `apps/editor-web/src/diagnostic-ui.ts`
- Create: `apps/editor-web/src/diagnostic-ui.test.ts`
- Modify: `apps/editor-web/src/main.ts`
- Modify: `apps/editor-web/src/style.css`
- Modify: `apps/editor-web/e2e/editor.spec.ts`

**UI contract:**

- Primary action: `ヒントを見る`.
- Always available when a project is loaded, including API-key-free/offline states.
- Show processing label: `この端末で確認しました`.
- Reveal hints one stage at a time.
- Keep existing external AI panel and conversation state intact.
- Do not add block highlighting until a supported editor adapter is identified and separately tested.

- [ ] Add E2E: API key absent、AI OFFでも標準ヒントを表示できる.
- [ ] Add E2E: clicking standard hints produces no`/ai/chat` request.
- [ ] Add E2E: existing `AI にきく` conversation still works with a mocked proxy.
- [ ] Add accessibility checks for keyboard operation、focus、aria-live and close/reopen.

**Phase 3 verification:**

```powershell
pnpm --filter @blocksync/diagnostics-core test
pnpm --filter @blocksync/editor-web test
pnpm --filter @blocksync/editor-web typecheck
pnpm --filter @blocksync/editor-web build
pnpm --filter @blocksync/editor-web exec playwright test e2e/editor.spec.ts -g "hint|AI"
```

---

# Phase 4: Preserve and explicitly gate the existing external AI

## Task 4.1: Separate educational level from execution mode

**Files:**

- Create: `packages/ai-assist/src/external-policy.ts`
- Create: `packages/ai-assist/src/external-policy.test.ts`
- Modify: `packages/ai-assist/src/index.ts`
- Modify: `apps/editor-web/index.html`
- Modify: `apps/editor-web/src/ai-assist-ui.ts`
- Modify: `apps/editor-web/src/ai-assist-ui.test.ts`

**Constraints:**

- Preserve`AiAssistLevel` 0–6 as the educational capability level.
- Add a separate external-use eligibility decision.
- Do not collect date of birth.
- Preserve existing API key、provider、model and level values.
- Store acknowledgement separately, e.g.`blocksync.external-ai-policy.v1`.
- Existing enabled users see a one-time disclosure before the next external send; their key is not erased.
- Known student/school contexts must not be treated as eligible merely because an API key exists.
- Until server-enforced school AI policy is implemented, school-student external use is fail-closed.

```ts
export interface ExternalAiEligibilityInput {
  configured: boolean;
  adultUseAcknowledged: boolean;
  explicitSendRequested: boolean;
  workspaceContext: "personal" | "school-staff" | "school-student" | "unknown";
  workspacePolicyAllows?: boolean;
}
```

- [ ] Write decision-table tests before implementation.
- [ ] Add disclosure of external processing and selected data scope.
- [ ] Rename visible action to`外部AIにきく` without removing chat、clarification、paging or anti-loop features.
- [ ] Require explicit send for every new external request; conversation continuation may remain within the already disclosed session.

**Anti-pattern guards:**

- Do not claim that adult acknowledgement alone authorizes sending student work.
- Do not infer age from email domain、role name or API-key possession.
- Do not put this acknowledgement into`AiAssistSettings` v1.

## Task 4.2: Feed deterministic findings into external AI optionally

**Files:**

- Create: `packages/diagnostics-core/src/external-summary.ts`
- Create: `packages/diagnostics-core/src/external-summary.test.ts`
- Modify: `apps/editor-web/src/main.ts`
- Modify: `packages/ai-assist/src/index.test.ts`

**Existing extension point:** `BuildAdvicePromptInput.observationNotes`.

- [ ] Format only selected findings、evidence summaries and limitations into a bounded string.
- [ ] Do not include learner names、school names、comments or full project JSON.
- [ ] Pass the text through existing`buildAdviceMessages()` sanitization and 800-character observation limit.
- [ ] Add UI preview of what will be sent.
- [ ] Do not send findings automatically when standard diagnostics finish.

**Regression verification:**

```powershell
pnpm --filter @blocksync/ai-assist test
pnpm --filter @blocksync/collab-host test
pnpm --filter @blocksync/editor-web test
```

Existing `/ai/chat`、provider detection、conversation、continuation、sanitization and floating-panel tests must remain green.

---

# Phase 5: Transformers.js isolated spike and go/no-go gate

This phase does not make on-device generation a required product feature. It produces evidence for a later production decision.

## Task 5.1: License and model-selection gate

**Files:**

- Create: `docs/ai/on-device-model-evaluation.md`
- Modify: repository license inventory used by`scripts/check-licenses.mjs`

- [ ] Pin`@huggingface/transformers` to`4.2.0` exactly.
- [ ] Record candidate model ID、exact revision SHA、dtype、device、required files、transfer size、license and source.
- [ ] Evaluate at least one multilingual 0.5B-class candidate; Qwen2.5 is a candidate, not an automatic production choice.
- [ ] Define Japanese rubric: factual consistency with findings、direct-answer suppression、readability、latency、memory、failure rate.
- [ ] Reject any candidate whose model/repository license cannot be documented.

## Task 5.2: Implement Worker protocol and state machine without production model activation

**Files:**

- Create: `packages/on-device-ai/package.json`
- Create: `packages/on-device-ai/tsconfig.json`
- Create: `packages/on-device-ai/src/contracts.ts`
- Create: `packages/on-device-ai/src/state-machine.ts`
- Create: `packages/on-device-ai/src/state-machine.test.ts`
- Create: `apps/editor-web/src/on-device-ai.worker.ts`
- Create: `apps/editor-web/src/on-device-ai-controller.ts`
- Create: `apps/editor-web/src/on-device-ai-controller.test.ts`

**State model:**

```text
disabled
  → compatible-unprepared
  → consent-required
  → checking-assets
  → downloading
  → loading
  → ready
  → generating
  → ready

any state → unavailable / failed → standard hints remain active
```

**Worker pattern:** Copy from the official React/Next.js Transformers.js tutorials.

```ts
const worker = new Worker(
  new URL("./on-device-ai.worker.ts", import.meta.url),
  {type: "module"},
);
```

Worker内だけで遅延importする。

```ts
const {pipeline, ModelRegistry, env} =
  await import("@huggingface/transformers");
```

- [ ] Unit-test all legal/illegal state transitions.
- [ ] Do not instantiate the Worker at app startup.
- [ ] Use`ModelRegistry` after explicit user action to show required size and cache status.
- [ ] Require download confirmation after displaying size and network recommendation.
- [ ] Configure browser/WASM cache with a versioned cache key.
- [ ] Treat Worker termination as the initial hard-cancel mechanism.
- [ ] Never auto-fallback a 0.5B generation model to WASM when WebGPU fails.

## Task 5.3: Run real-device spike

**Test matrix:**

- Representative Windows Chrome.
- Ordinary Chromebook and Chromebook Plus where available.
- iPad/Safari as compatibility evidence, not assumed support.
- Cache cold、cache warm、cache evicted、offline after cache、network interruption.
- WebGPU API present but adapter/pipeline initialization fails.

**Measurements:**

- Model metadata lookup time.
- Initial transfer bytes/time.
- Cache warm startup.
- Peak memory/crash behavior.
- First-token and complete-hint latency.
- Japanese rubric score over the fixed diagnostic corpus.

**Go conditions:**

- Rule diagnosis remains usable during every on-device failure.
- No model request occurs before explicit consent.
- Selected model revision and license are fixed.
- Minimum reference-device thresholds are written from measured evidence and met.
- Generated text does not contradict certain findings above the agreed threshold.

If conditions fail, ship Phase 1–4 without on-device generation. This is a valid completed release.

---

# Phase 6: Optional on-device explanation UI after spike approval

Execute only after Phase 5 Go.

## Task 6.1: Add `端末内AIで説明` as a secondary action

**Files:**

- Modify: `apps/editor-web/index.html`
- Create: `apps/editor-web/src/on-device-ai-ui.ts`
- Create: `apps/editor-web/src/on-device-ai-ui.test.ts`
- Modify: `apps/editor-web/src/main.ts`
- Modify: `apps/editor-web/src/style.css`
- Modify: `apps/editor-web/e2e/editor.spec.ts`

**Input boundary:** Only selected deterministic findings、existing staged hints and the learner's optional question. Do not pass raw project JSON to the model in v1.

**Generation boundary:**

- `max_new_tokens` starts at 96.
- `do_sample: false`.
- Generated text is labeled as端末内AIの補足.
- Deterministic findings remain the authoritative displayed facts.
- Empty、malformed、contradictory or timed-out output is discarded and the template hint remains.

- [ ] Show size/cache/preparation state.
- [ ] Show`データはこの端末内で処理` only after verifying no external request in E2E.
- [ ] Provide cache reset/re-download control.
- [ ] Keep external AI controls visually distinct.

## Task 6.2: Static-build and lazy-load verification

**Files:**

- Modify: `apps/editor-web/scripts/verify-static-build.mjs`
- Modify: `apps/editor-web/vite.config.ts` only if documented Vite behavior requires it.
- Modify: license inventory and deployment documentation.

- [ ] Verify Worker chunk and WASM/model loader assets resolve under`BLOCKSYNC_BASE_PATH`.
- [ ] Verify initial editor chunk does not eagerly execute Transformers.js.
- [ ] Intercept network in Playwright and prove no Hugging Face/model request before explicit preparation.
- [ ] Verify cache failure and model host failure leave standard hints functional.
- [ ] Run`scripts/check-licenses.mjs`.

---

# Phase 7: Evaluation expansion and rule-catalog growth

## Task 7.1: Add task context before intent-dependent rules

**Files:**

- Create: `packages/diagnostics-core/src/task-context.ts`
- Create: `packages/diagnostics-core/src/task-context.test.ts`

Only after課題仕様のsource and ownership are defined, add rules such as variable initialization、expected start event、goal-specific coordinate behavior. Every task-dependent finding must cite the task-context fact that makes it valid.

## Task 7.2: Expand rule catalog under an explicit release gate

- Add rules in small groups by concept: events、variables、loops、broadcast、clones、coordinates、lists、timing.
- Each rule requires normal、positive、near-miss and at least one compound-mutation test.
- Teacher-reviewed staged hints are mandatory before enabling a rule by default.
- New rules start behind a catalog version or disabled flag until the release corpus passes.
- Do not collect student project telemetry by default. Accept teacher-submitted、consented、anonymized fixtures through a separate process if later needed.

---

# Phase 8: Documentation and final verification

## Task 8.1: Synchronize documentation

**Files:**

- Modify: `docs/superpowers/specs/2026-07-23-ai-advice-assist-design.md`
- Modify: `docs/CURSOR_CODEX_HANDOFF.md`
- Modify: system specification AI sections as appropriate.
- Create: architecture decision record for diagnostic/external/on-device separation.

Correct current documentation drift:

- Existing context is no longer `opcode summary only`; it includes bounded script stacks and SUBSTACK.
- Existing Gemini default in code differs from the original prototype design.
- Document three processing locations and their eligibility rules.
- Document that standard diagnostics are the product baseline and Transformers.js is optional.

## Task 8.2: Full verification

Run at minimum:

```powershell
pnpm --filter @blocksync/diagnostics-core test
pnpm --filter @blocksync/diagnostics-core typecheck
pnpm --filter @blocksync/ai-assist test
pnpm --filter @blocksync/on-device-ai test
pnpm --filter @blocksync/editor-web test
pnpm --filter @blocksync/editor-web typecheck
pnpm --filter @blocksync/editor-web build
pnpm --filter @blocksync/collab-host test
pnpm --filter @blocksync/editor-web exec playwright test
node scripts/check-licenses.mjs
```

If Phase 5 is No-Go and`@blocksync/on-device-ai` is not shipped, omit only that package's test; all baseline diagnostic tests remain mandatory.

## Final anti-pattern audit

- [ ] Search for imports from`@huggingface/transformers` outside the Worker/on-device package boundary.
- [ ] Search for writes to`blocksync.ai-assist.settings.v1`; verify only existing settings code owns it.
- [ ] Search for automatic calls to`requestAiChat()` from standard diagnostic completion.
- [ ] Search for diagnostic or model state written into project、Yjs、Drive or signaling payloads.
- [ ] Verify no external request occurs in API-key-free standard hint E2E.
- [ ] Verify old AI provider、proxy、chat、clarification、paging and anti-loop tests remain green.
- [ ] Verify all enabled rule IDs exist in the versioned release corpus.
- [ ] Verify every learner-facing finding has evidence、confidence and staged hint text.
- [ ] Verify all model IDs use a pinned revision and license record.

## Release milestones

1. **Milestone A — Standard diagnostics complete:** Phase 1–3. Can ship to all users without API keys.
2. **Milestone B — Existing external AI safely separated:** Phase 4. Adult/policy-qualified users retain the current feature.
3. **Milestone C — On-device feasibility decision:** Phase 5. Go or No-Go based on measured evidence.
4. **Milestone D — Optional on-device explanation:** Phase 6 only after Go.
5. **Milestone E — Catalog expansion:** Phase 7 under teacher-reviewed release gates.

The product is considered complete at Milestone B even if Milestone C returns No-Go. Transformers.js is an enhancement, not the condition for nationwide baseline availability.
