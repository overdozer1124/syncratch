# R1 Scratch/SB3 Task 0 Review

**Review date:** 2026-07-16

**Reviewed state:** uncommitted Task 0 submission based on Design `c80734f`

**Verdict:** **No-Go — targeted Task 0 corrections required**

The vendor VM build, `storage.createAsset` byte attachment, fixture extraction and TypeScript compilation succeed. `pnpm r1:scratch:test` exits 0 with 9 tests. These successes do not satisfy all Task 0 Go claims because the equivalence and host-display evidence are weaker than Design §§6.7 and 7.3.

## P1 blockers

### 1. `equivalenceSpikeV0` is Scratch-UID-dependent

`apps/r1-scratch-host/spike/equivalence-spike-v0.ts` serializes `b.inputs` directly into the block fingerprint. Connected block references therefore retain raw Scratch block IDs. Design §6.7 explicitly requires child linkage by opcode/input slot, not Scratch uid.

Observed reproduction:

```json
{"equivalentAfterUidRegeneration":false}
```

The reproduction renamed `define_id/proto_id/attached_id` and updated all graph references without changing semantics. It must compare equivalent.

Required correction:

1. Implement recursive stable canonicalization for fields, primitive inputs and mutation.
2. Replace referenced block IDs with child fingerprints associated with the input slot and branch position.
3. Keep `next` order significant and top-level scripts as a sorted multiset.
4. Detect missing references/cycles instead of silently skipping them.
5. Do not mutate input documents through `.sort()`.
6. Add tests:
   - all block IDs regenerated, references updated → equivalent
   - object key order changed → equivalent
   - duplicate identical top-level stacks → multiset counts preserved
   - input slot/opcode/primitive/mutation/next changed → not equivalent
   - missing reference/cycle → explicit failure

### 2. Claimed export → re-import equivalence is not tested

The current tests call `loadProjectJson` once and compare `vm.toJSON()` with a fixture. They do not call vendor `vm.saveProjectSb3()` and load the exported SB3 into a fresh VM. This avoids the ID-regeneration behavior that §6.7 is intended to handle.

Required correction:

1. For cat-with-sound and custom-procedure fixtures: load into VM A → `saveProjectSb3()` → load bytes into fresh VM B → extract `DocumentSpikeV0` → compare.
2. Assert all custom procedure mutation fields, not only `proccode`.
3. Assert costume/sound bytes and refs after the fresh-VM re-import.

### 3. §7.3 host display and GUI gate are non-blocking/skipped

The GUI test returns successfully when `scratch-gui-standalone.js` is missing. `r1:scratch:test` builds only the vendor VM, not the GUI. A clean environment can therefore report 9/9 while never building or mounting the GUI. Checking `asset.data instanceof Uint8Array` proves byte attachment, not that the E1 host displays real assets through the required path.

Required correction:

1. Make missing GUI bundle a test failure, or make a blocking pretest build it.
2. Include `gate0:build-vendor-gui-spike` and host `typecheck` in the reproducible Task 0 gate.
3. Add a minimal browser smoke—not the full Task 10 product shell—that mounts the pinned standalone GUI/VM, loads bytes through `storage.createAsset`, observes a rendered real costume on the stage, and performs one block create/connect/edit/delete through the GUI integration boundary.
4. Keep the full Playwright editor suite and finished host UI in Task 10; only the integration-risk smoke is required now.

## P2 corrections

- Rename the direct VM mutation test/evidence unless a real change-capture listener is added. Calling `blocks.createBlock` and then `toJSON` proves VM mutation persistence, not “capture”.
- `attachAssetBytes` currently ignores the requested `assetType`/`dataFormat` and selects the first matching stem. Match the exact expected asset type/format and reject ambiguous same-stem entries in the spike helper.
- Add `r1:scratch:typecheck` and invoke it before tests. Manual review typecheck passed, but the submitted gate does not run it.
- Update `docs/r1/SCRATCH_SPIKE.md` only after the new blocking tests pass. Do not label skipped checks PASS.

## Verified evidence

- `pnpm r1:scratch:test`: PASS, 9 tests, but insufficient assertions as above.
- `pnpm --filter @blocksync/r1-scratch-host typecheck`: PASS.
- Parent gitlink remains `160000 7c172e469eb3c21c1e6326ea6cccea60bc14e3a8`.
- GUI standalone bundle exists locally, but the current gate does not require it in a clean environment.

## Instruction to implementer

1. First create a **docs-only baseline commit** containing only this review, the v1.2 master specification and the Workspace/Roster Design/Plan. Do not include the current Scratch Task 0 implementation or its modified `package.json`/lockfile in that commit.
2. Do **not** start Scratch/SB3 Task 1 yet.
3. Correct the three P1 blockers and P2 evidence wording/gates.
4. Run the corrected Task 0 gate from a state where the GUI output has been removed or otherwise prove a clean build.
5. Commit the corrected Task 0 files as a separate atomic commit after all corrected evidence passes. Do not use `git add -A`; stage the intended Task 0 paths explicitly.
6. Resubmit both commit SHAs, clean status, exact commands and results for review.
7. After Task 0 is approved, continue Scratch/SB3 Tasks 1–11.
8. After the Scratch/SB3 slice reaches Technical Go, execute the Workspace/Roster/Scoped Access plan before realtime collaboration or AI product implementation.

## New specification order

Authoritative documents:

1. `docs/specification/BlockSync-AI_システム仕様書・実装計画書_v1.2.md`
2. `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md`
3. `docs/superpowers/plans/2026-07-16-r1-scratch-sb3-plan.md`
4. `docs/superpowers/specs/2026-07-16-r1-workspace-roster-access-design.md`
5. `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`

If a slice document conflicts with v1.2 on Person/UserAccount separation, multi-workspace membership, initial roster foundation or scoped roles, v1.2 and the Workspace/Roster design govern new product work. Existing Go documents remain historical evidence and are not silently rewritten.
