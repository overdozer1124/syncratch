# Debug Panel Toolbar Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the toolbar pause entry point with a「デバッグ」toggle that opens the floating debug panel and pauses, move pause/resume into the panel, and resume on close.

**Architecture:** Keep `installDebugFloatingPanel` as a pure open/close/drag controller. Own the new open/close ↔ pause/resume coupling in `installExecutionControls` (`main.ts`), with markup ids/labels updated in `index.html` and Playwright helpers updated to match.

**Tech Stack:** TypeScript, Vitest (optional helper only), Playwright E2E under `apps/editor-web/e2e/`.

**Spec:** `docs/superpowers/specs/2026-07-29-debug-panel-toolbar-toggle-design.md`

## Global Constraints

- Toolbar label is always「デバッグ」(never「再開」or「一時停止」).
- Opening the panel always pauses; closing via toolbar or × always resumes if paused.
- In-panel pause/resume must not close the panel.
- Green-flag resume behavior stays; do not force-close the panel on green flag.
- Do not change rewind / scrub / step / trace recorder internals.
- Japanese learner-facing copy only for these controls.

## File map

| File | Responsibility |
|---|---|
| `apps/editor-web/index.html` | Toolbar debug toggle markup; in-panel pause/resume button ids/labels |
| `apps/editor-web/src/main.ts` | Wire toggle/open/close/pause/resume; remove auto-open-on-pause coupling |
| `apps/editor-web/src/style.css` | Only if class rename needs a selector update (`debug-panel-resume` → dual control) |
| `apps/editor-web/e2e/execution-control.spec.ts` | Primary UX matrix + helper `openDebugPanel` |
| `apps/editor-web/e2e/execution-rewind.spec.ts` | Replace `exec-pause` clicks |
| `apps/editor-web/e2e/execution-trace-semantic.spec.ts` | Replace `openDebugPanel` helper target |

No new production module required unless a tiny pure helper keeps `main.ts` clearer; prefer in-place wiring first.

---

### Task 1: Markup — toolbar「デバッグ」and in-panel pause/resume

**Files:**
- Modify: `apps/editor-web/index.html`
- Modify: `apps/editor-web/src/style.css` (class rename only if needed)

- [ ] **Step 1: Update toolbar button markup**

Replace the current pause toolbar button block with:

```html
<button
  class="toolbar-action exec-control-button"
  data-testid="exec-debug-toggle"
  id="exec-debug-toggle"
  type="button"
  aria-expanded="false"
  aria-controls="exec-debug-panel"
  aria-label="デバッグ"
  title="デバッグ"
><span aria-hidden="true" class="exec-icon">⏯</span
><span class="exec-label" data-testid="exec-debug-toggle-label" id="exec-debug-toggle-label">デバッグ</span></button>
```

Remove `aria-pressed` from this button. Remove ids `exec-pause` / `exec-pause-label`.

- [ ] **Step 2: Rename in-panel resume button to dual pause/resume**

Change the panel body button from resume-only to:

```html
<button
  class="toolbar-action debug-panel-pause-resume"
  data-testid="exec-debug-pause-resume"
  id="exec-debug-pause-resume"
  type="button"
  aria-label="一時停止"
>一時停止</button>
```

Default label may be either state; `main.ts` `render()` will sync it. Keep `#exec-status` and history/scrub/step unchanged.

- [ ] **Step 3: CSS class rename**

In `apps/editor-web/src/style.css`, rename `.debug-panel-resume` selectors to `.debug-panel-pause-resume` (same visual styles).

- [ ] **Step 4: Commit**

```bash
git add apps/editor-web/index.html apps/editor-web/src/style.css
git commit -m "refactor(editor): rename debug toolbar and in-panel pause controls"
```

---

### Task 2: Wire toggle / panel close / in-panel pause in `main.ts`

**Files:**
- Modify: `apps/editor-web/src/main.ts`

**Interfaces:**
- Consumes: `installDebugFloatingPanel` (`isOpen` / `setOpen`), `executionController.pause/resume`, existing `resumeExecution()` helper that commits rewind branch then resumes
- Produces: toolbar toggle closes+resumes; open pauses+opens; in-panel toggles pause without closing

- [ ] **Step 1: Point element lookups at new ids**

Near the existing `execPauseButton` declarations, replace with:

```ts
const execDebugToggleButton = requiredElement<HTMLButtonElement>("exec-debug-toggle");
const execDebugToggleLabel = requiredElement<HTMLElement>("exec-debug-toggle-label");
const execDebugPauseResumeButton = requiredElement<HTMLButtonElement>(
  "exec-debug-pause-resume",
);
```

Delete references to `execPauseButton`, `execPauseLabel`, `execDebugResumeButton`.

- [ ] **Step 2: Replace pause↔panel auto-sync with explicit open/close helpers**

Inside `installExecutionControls`, remove `wasPaused` and `syncDebugPanelForPause`.

Add:

```ts
const closeDebugPanelAndResume = (): void => {
  if (controller.getSnapshot().state === "paused") {
    resumeExecution();
  }
  debugPanel.setOpen(false);
  render();
};

const openDebugPanelAndPause = (): void => {
  if (controller.getSnapshot().state === "running") {
    controller.pause();
  }
  debugPanel.setOpen(true);
  render();
};
```

Ensure `resumeExecution` is declared before these helpers (reorder if needed).

- [ ] **Step 3: Update `render()` labels and aria**

```ts
const render = () => {
  const {state} = controller.getSnapshot();
  const paused = state === "paused";
  const panelOpen = debugPanel.isOpen();
  execControlGroup.dataset.state = state;

  execDebugToggleLabel.textContent = "デバッグ";
  execDebugToggleButton.setAttribute("aria-label", "デバッグ");
  execDebugToggleButton.title = "デバッグ";
  execDebugToggleButton.setAttribute(
    "aria-expanded",
    panelOpen ? "true" : "false",
  );

  const pauseResumeLabel = paused ? "再開" : "一時停止";
  execDebugPauseResumeButton.textContent = pauseResumeLabel;
  execDebugPauseResumeButton.setAttribute("aria-label", pauseResumeLabel);

  execStatus.textContent = paused ? "止まっています" : "動いています";
  renderExecutionTrace(vmInstance);
  renderRewindControl();
};
```

Do **not** call `debugPanel.setOpen` from `render()` based on pause state.

- [ ] **Step 4: Replace click handlers**

```ts
execDebugToggleButton.addEventListener("click", () => {
  if (debugPanel.isOpen()) {
    closeDebugPanelAndResume();
    return;
  }
  openDebugPanelAndPause();
});

execDebugCloseButton.addEventListener("click", () => {
  closeDebugPanelAndResume();
});

execDebugPauseResumeButton.addEventListener("click", () => {
  const {state} = controller.getSnapshot();
  if (state === "paused") {
    resumeExecution();
  } else {
    controller.pause();
  }
});
```

Remove the old `execPauseButton` / `execDebugResumeButton` listeners. Keep rewind/step/scrub handlers as they are (they may still call `controller.pause()` when needed for scrubbing).

Note: `installDebugFloatingPanel` already listens to `closeButton` and calls `setOpen(false)`. The extra `execDebugCloseButton` listener in `main.ts` must still run resume logic. Today both fire on click — keep that: panel controller hides, main.ts resumes. Order is fine because both are bubble listeners on the same button.

- [ ] **Step 5: Typecheck**

Run:

```bash
pnpm --filter @blocksync/editor-web typecheck
```

Expected: PASS (no remaining `execPause*` / `execDebugResume*` references).

- [ ] **Step 6: Commit**

```bash
git add apps/editor-web/src/main.ts
git commit -m "feat(editor): open debug panel via toolbar toggle with pause"
```

---

### Task 3: Update Playwright helpers and control UX specs

**Files:**
- Modify: `apps/editor-web/e2e/execution-control.spec.ts`

- [ ] **Step 1: Rewrite `openDebugPanel` and primary pause/resume test**

Update helper:

```ts
async function openDebugPanel(page: Page): Promise<void> {
  const panel = page.getByTestId("exec-debug-panel");
  if (!(await panel.isVisible())) {
    await page.getByTestId("exec-debug-toggle").click();
  }
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("exec-status")).toHaveText("止まっています");
}
```

Replace test `"pause stops the VM and resume restarts it"` with coverage of the new matrix:

```ts
test("debug toggle pauses and in-panel resume restarts without closing", async ({
  page,
}) => {
  await bootEditor(page);
  await startForeverScript(page);

  const first = await readSpriteX(page);
  await page.waitForTimeout(300);
  expect(await readSpriteX(page)).not.toBe(first);

  await openDebugPanel(page);
  await expect(page.getByTestId("exec-debug-toggle-label")).toHaveText("デバッグ");
  await expect(page.getByTestId("exec-debug-pause-resume")).toHaveText("再開");

  const paused = await readSpriteX(page);
  await page.waitForTimeout(400);
  expect(await readSpriteX(page)).toBe(paused);

  await page.getByTestId("exec-debug-pause-resume").click();
  await expect(page.getByTestId("exec-status")).toHaveText("動いています");
  await expect(page.getByTestId("exec-debug-panel")).toBeVisible();
  await expect(page.getByTestId("exec-debug-pause-resume")).toHaveText("一時停止");
  await page.waitForTimeout(300);
  expect(await readSpriteX(page)).not.toBe(paused);
});

test("closing debug via toolbar or close button resumes", async ({page}) => {
  await bootEditor(page);
  await startForeverScript(page);
  await openDebugPanel(page);

  await page.getByTestId("exec-debug-toggle").click();
  await expect(page.getByTestId("exec-debug-panel")).toBeHidden();
  await expect(page.getByTestId("exec-status")).toHaveText("動いています");

  await openDebugPanel(page);
  await page.getByTestId("exec-debug-close").click();
  await expect(page.getByTestId("exec-debug-panel")).toBeHidden();
  await expect(page.getByTestId("exec-status")).toHaveText("動いています");
});
```

- [ ] **Step 2: Replace remaining `exec-pause` / `exec-pause-label` references in this file**

Any direct `getByTestId("exec-pause")` becomes `exec-debug-toggle` when the intent is open/toggle, or `exec-debug-pause-resume` when the intent is in-panel pause/resume. Remove assertions that the toolbar label becomes「再開」.

- [ ] **Step 3: Run the control E2E file**

Run:

```bash
pnpm --filter @blocksync/editor-web test:e2e -- e2e/execution-control.spec.ts
```

Expected: all tests in that file PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/editor-web/e2e/execution-control.spec.ts
git commit -m "test(editor): cover debug toggle pause and close-resume UX"
```

---

### Task 4: Update rewind / trace E2E callers

**Files:**
- Modify: `apps/editor-web/e2e/execution-rewind.spec.ts`
- Modify: `apps/editor-web/e2e/execution-trace-semantic.spec.ts`

- [ ] **Step 1: Point helpers and clicks at `exec-debug-toggle`**

In `execution-trace-semantic.spec.ts`, change `openDebugPanel` to click `exec-debug-toggle` (same helper body as Task 3).

In `execution-rewind.spec.ts`, replace every `page.getByTestId("exec-pause").click()` that opens debug / pauses for rewind with `exec-debug-toggle`. Where a second click previously resumed via toolbar pause, use either:
- `exec-debug-pause-resume` if the panel should stay open, or
- a second `exec-debug-toggle` if the test wanted close+resume.

Match each call site to the old intent by reading neighboring expects (`exec-debug-panel` visible vs status「動いています」).

- [ ] **Step 2: Run related E2E**

```bash
pnpm --filter @blocksync/editor-web test:e2e -- e2e/execution-control.spec.ts e2e/execution-rewind.spec.ts e2e/execution-trace-semantic.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/editor-web/e2e/execution-rewind.spec.ts apps/editor-web/e2e/execution-trace-semantic.spec.ts
git commit -m "test(editor): migrate rewind and trace e2e to debug toggle"
```

---

### Task 5: Final verification

- [ ] **Step 1: Typecheck + grep for stale ids**

```bash
pnpm --filter @blocksync/editor-web typecheck
rg "exec-pause|exec-debug-resume|exec-pause-label" apps/editor-web
```

Expected: typecheck PASS; no stale production/test references (except historical docs if any).

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(editor): open debug panel from toolbar toggle" --body "$(cat <<'EOF'
## Summary
- Toolbar「デバッグ」opens the floating debug panel and pauses
- Pause/resume lives inside the panel; closing resumes

## Test plan
- [x] editor-web typecheck
- [x] Playwright: execution-control / rewind / trace-semantic
EOF
)"
```

- [ ] **Step 3: Merge when CI is green** (workspace rule: do not leave mergeable PRs open)

```bash
gh pr merge --merge
```

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Toolbar always「デバッグ」 | 1, 2 |
| Open → pause + panel | 2, 3 |
| In-panel pause/resume, panel stays open | 2, 3 |
| Toolbar second click → close + resume | 2, 3 |
| × → close + resume | 2, 3 |
| Green flag unchanged / panel not force-closed | 3 (existing green-flag test kept) |
| Rewind/step/history unchanged | 2 (handlers kept), 4 |
| New test ids | 1–4 |
| Install failure hides controls | unchanged path in Task 2 |
