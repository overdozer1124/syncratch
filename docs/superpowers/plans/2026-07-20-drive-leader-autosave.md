# Drive Leader Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically persist a collaboration leader's settled edits to Google Drive while preserving single-writer and conflict protections.

**Architecture:** Add an isolated debounce coordinator that tracks pending and in-flight saves. Extend the existing Drive save entry point to distinguish automatic writes from explicit toolbar saves, then connect the coordinator to editor, collaboration, project, and authentication lifecycle events.

**Tech Stack:** TypeScript, Vitest, Vite, Yjs/WebRTC collaboration, Google Drive REST integration.

## Global Constraints

- The delay is 2,000 ms after the latest edit.
- Only a connected collaboration leader may autosave.
- Followers never write Drive.
- Existing explicit Save behavior remains immediate.
- Conflict, disconnection, leadership loss, project changes, and Google disconnect cancel pending automatic saves.
- No automatic retry loop after a failed Drive write.

---

### Task 1: Drive autosave coordinator

**Files:**
- Create: `apps/editor-web/src/drive-autosave.ts`
- Create: `apps/editor-web/src/drive-autosave.test.ts`

**Interfaces:**
- Consumes: `save(): Promise<boolean>` and `isEligible(): boolean`.
- Produces: `createDriveAutosave(options)` returning `noteChange()`, `eligibilityChanged()`, and `cancel()`.

- [ ] **Step 1: Write failing coordinator tests**

Cover these observable behaviors with Vitest fake timers:

```ts
it("debounces leader edits into one save", async () => {
  const save = vi.fn(async () => true);
  const autosave = createDriveAutosave({delayMs: 2_000, isEligible: () => true, save});
  autosave.noteChange();
  await vi.advanceTimersByTimeAsync(1_000);
  autosave.noteChange();
  await vi.advanceTimersByTimeAsync(1_999);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
});
```

Also test ineligible peers, cancellation on eligibility loss, and one follow-up save when an edit arrives during an in-flight save.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
pnpm --filter @blocksync/editor-web exec vitest run src/drive-autosave.test.ts
```

Expected: FAIL because `drive-autosave.ts` does not exist.

- [ ] **Step 3: Implement the minimal coordinator**

Use this public contract:

```ts
export interface DriveAutosave {
  noteChange(): void;
  eligibilityChanged(): void;
  cancel(): void;
}

export function createDriveAutosave(options: {
  delayMs: number;
  isEligible(): boolean;
  save(): Promise<boolean>;
}): DriveAutosave;
```

Maintain one timer, one in-flight promise, and a `changedDuringSave` flag. Re-check `isEligible()` both when scheduling and when the timer fires. A failed save remains unscheduled until another edit.

- [ ] **Step 4: Run tests and verify GREEN**

Run the command from Step 2. Expected: all coordinator tests pass.

---

### Task 2: Explicit versus automatic Drive writes

**Files:**
- Modify: `apps/editor-web/src/drive-integration.ts`
- Modify: `apps/editor-web/src/drive-integration.test.ts`

**Interfaces:**
- Change `saveToDrive()` to `saveToDrive(options?: {explicit?: boolean})`.
- Forward `options?.explicit === true` to `canPersistToDrive`.

- [ ] **Step 1: Write a failing Drive integration test**

```ts
it("uses the non-explicit collaboration gate for autosave", async () => {
  const gate = vi.fn(() => ({ok: false, reason: "Automatic save paused"}));
  const deps = dependencies({canPersistToDrive: gate});
  const integration = createEditorDriveIntegration(deps);
  await integration.saveToDrive();
  expect(gate).toHaveBeenCalledWith({explicit: false});
});
```

Retain a separate assertion that `saveToDrive({explicit: true})` passes `{explicit: true}`.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
pnpm --filter @blocksync/editor-web exec vitest run src/drive-integration.test.ts
```

Expected: FAIL because the implementation currently always passes `{explicit: true}`.

- [ ] **Step 3: Implement the API distinction**

Update the interface and implementation:

```ts
saveToDrive(options?: {explicit?: boolean}): Promise<boolean>;
// ...
const explicit = options?.explicit === true;
const writeGate = dependencies.canPersistToDrive?.({explicit});
```

- [ ] **Step 4: Verify GREEN**

Run the focused test command. Expected: all Drive integration tests pass.

---

### Task 3: Editor lifecycle integration

**Files:**
- Modify: `apps/editor-web/src/main.ts`
- Modify: `apps/editor-web/e2e/editor.spec.ts`

**Interfaces:**
- Instantiate `createDriveAutosave` with `delayMs: 2_000`.
- Manual button calls `saveToDrive({explicit: true})`.
- Autosave calls `saveToDrive({explicit: false})`.

- [ ] **Step 1: Add a failing E2E assertion**

Extend the collaboration test so a leader block edit transitions back from `Unsynced` to `Synced` without clicking the Drive save button, while the follower performs no Drive write.

- [ ] **Step 2: Run the focused E2E test and verify RED**

```powershell
pnpm --filter @blocksync/editor-web exec playwright test e2e/editor.spec.ts -g "Chromium contexts"
```

Expected: FAIL because Drive remains `Unsynced`.

- [ ] **Step 3: Connect lifecycle events**

In `markDirty`, after `markLocalChange()`, call `driveAutosave.noteChange()` for the current leader. Call `driveAutosave.eligibilityChanged()` from `renderCollabState`. Call `driveAutosave.cancel()` before leaving a room, loading another project, and disconnecting Google. Change the toolbar handler to:

```ts
saveDriveButton.addEventListener("click", () => {
  driveAutosave.cancel();
  void driveIntegration.saveToDrive({explicit: true});
});
```

- [ ] **Step 4: Run unit, type, and E2E verification**

```powershell
pnpm --filter @blocksync/editor-web test
pnpm --filter @blocksync/editor-web typecheck
pnpm --filter @blocksync/editor-web exec playwright test e2e/editor.spec.ts -g "Chromium contexts"
```

Expected: all commands pass and the leader returns to `Synced` after the debounce delay.

- [ ] **Step 5: Review the implementation**

Run a code review focused on timer cleanup, stale-project writes, follower safety, conflict behavior, and duplicate in-flight saves. Resolve all high-severity findings and rerun Step 4.
