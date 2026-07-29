# Debug panel toolbar toggle

**Status:** Approved for implementation

**Date:** 2026-07-29

**Scope:** `apps/editor-web` execution controls only. Does not change VM pause/step/rewind/trace internals, collab, or Drive.

## Problem

Today the toolbar **一時停止** button both pauses execution and opens the debug floating panel. Learners associate “pause” with stopping the project, not with opening rewind / step / history tools. The panel already has a **再開** button, but the outer control still owns most of the pause UX.

## Goals

1. Replace the toolbar pause entry point with a single **デバッグ** button.
2. Pressing **デバッグ** opens the floating debug panel **and pauses** execution.
3. Put pause/resume control **inside** the panel.
4. Closing the panel (toolbar toggle or ×) **resumes** execution if it was paused.
5. Keep rewind, scrub, step, and execution history behavior unchanged aside from the new open/close triggers.

## Non-goals

- Renaming the panel title away from「デバッグ」.
- Changing Scratch GUI’s built-in debug button (it remains hidden).
- Redesigning rewind / scrub / trace layout beyond adding an in-panel pause control.
- Auto-pausing when the green flag starts, or pausing on every panel-open while already paused (no-op pause is fine).

## UX / state machine

### Toolbar

| Element | Behavior |
|---|---|
| Label | Always「デバッグ」(does not become「再開」) |
| Icon | Keep the existing toolbar icon glyph (no new icon set) |
| `aria-expanded` | `true` when panel open, `false` when closed |
| `aria-controls` | Points at `#exec-debug-panel` |
| `aria-pressed` | Remove from the toolbar button; open/close uses `aria-expanded`, pause labeling lives on the in-panel control |

### Interactions

| Action | Result |
|---|---|
| Toolbar「デバッグ」while panel closed | `pause()` + open panel |
| Toolbar「デバッグ」while panel open | close panel + `resume()` if paused |
| Panel × | close panel + `resume()` if paused |
| In-panel primary control while running | `pause()`; label「一時停止」 |
| In-panel primary control while paused | `resume()` (panel stays open); label「再開」 |
| Green flag while paused | Existing behavior: resume VM (panel may stay open; do not force-close) |
| Install failure | Hide the whole exec-control group (unchanged) |

### Panel chrome

- Title remains「デバッグ」.
- Status line remains「動いています」/「止まっています」.
- Replace the resume-only button (`exec-debug-resume`) with a dual-purpose pause/resume button whose label tracks execution state.
- Rewind, scrub, step, history clear stay as-is.

## Implementation outline

Primary wiring lives in `installExecutionControls` (`apps/editor-web/src/main.ts`) and markup in `apps/editor-web/index.html`.

1. Rename toolbar control copy from「一時停止」to「デバッグ」. Introduce `data-testid="exec-debug-toggle"` (and matching element id) and update E2E helpers; retire `exec-pause` / `exec-pause-label` test ids.
2. Remove `syncDebugPanelForPause` coupling that auto-opens the panel on any pause transition and auto-closes on resume. Panel open state becomes independent of pause except for the explicit open/close actions above.
3. Toolbar click handler:
   - if panel open → close + resume-if-paused
   - else → pause + open
4. Close button: close + resume-if-paused (not merely hide while staying paused).
5. In-panel button: toggle pause/resume without closing the panel; update label/aria on each `controller.subscribe` render.
6. CSS: minor label tweaks only if needed; floating panel styles stay.

Optional small extract (only if it keeps `main.ts` clearer): a pure helper for toolbar/panel action decisions, unit-tested. Not required if E2E covers the matrix.

## Testing

Update Playwright helpers/specs under `apps/editor-web/e2e/`:

- `openDebugPanel()` clicks the new toolbar debug control (not “pause means open”).
- Opening debug pauses a running forever script and shows「止まっています」.
- In-panel resume restarts motion while panel stays visible; button becomes「一時停止」.
- In-panel pause stops again.
- Second toolbar debug click closes panel and resumes.
- × closes panel and resumes.
- Existing step / rewind / scrub / trace cases still pass with the new open helper.

Unit coverage: keep `debug-floating-panel` tests; add a focused unit test only if a decision helper is extracted.

## Acceptance

- Learner can open debug tools via a button labeled「デバッグ」.
- Opening always leaves the project paused.
- Pause/resume is available inside the panel without closing it.
- Closing via toolbar or × returns the project to running when it had been paused.
- No regression in step, rewind, scrub, or history.

## Out of scope follow-ups

- Separate “inspect without pausing” mode.
- Keyboard shortcuts for debug toggle.
- Persist panel open/position across reloads beyond current drag memory for the session.
