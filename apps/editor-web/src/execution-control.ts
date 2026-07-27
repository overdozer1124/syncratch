/**
 * Pause / resume / single-frame stepping for the Scratch VM, plus highlighting
 * of the blocks that are about to run.
 *
 * scratch-vm drives execution from `Runtime.start()`, which calls
 * `Runtime._step()` on a `setInterval`. Gating that one method is enough to
 * stop and single-step the whole VM, so this stays entirely on the app side —
 * `vendor/scratch-editor` is a pinned submodule (ADR-0001) and must not be
 * patched for a feature like this.
 *
 * Highlighting is injected rather than done here. `Runtime.glowBlock` looks like
 * the obvious channel, but the GUI's BLOCK_GLOW_ON/OFF handlers are no-ops in
 * this scratch-gui version (containers/blocks.jsx), so emitting those would
 * light nothing up. The caller supplies a highlighter that talks to the live
 * ScratchBlocks workspace instead, which also keeps this module DOM-free.
 *
 * Known limitation: `wait` blocks and timers read the wall clock, so time keeps
 * passing while execution is paused. A long pause therefore makes pending waits
 * expire immediately on resume. Fixing that needs a virtual clock across the
 * runtime and is deliberately out of scope here.
 */

const PATCH_FLAG = "_syncratchExecutionControlPatched";

export type ExecutionThreadLike = {
  /** Block the sequencer ran most recently this frame. */
  blockGlowInFrame?: string | null;
  peekStack?: () => string | null | undefined;
  /** Hat / top block the script was started from. */
  topBlock?: string | null;
  target?: {
    blocks?: {
      getBlock?: (id: string) => unknown;
      getScripts?: () => string[];
    };
  } | null;
  /** Monitor threads should not be shown as "what the project is doing". */
  updateMonitor?: boolean;
  isKilled?: boolean;
  status?: number;
};

export type ExecutionRuntimeLike = {
  threads?: ExecutionThreadLike[];
  _step?: (...args: unknown[]) => unknown;
  _updateGlows?: (...args: unknown[]) => unknown;
  _stopThread?: (thread: ExecutionThreadLike) => void;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  [PATCH_FLAG]?: boolean;
  [GLOW_GUARD_FLAG]?: boolean;
};

const GLOW_GUARD_FLAG = "_syncratchGlowGuardInstalled";

/**
 * Stop a failed glow from cancelling the rest of the frame.
 *
 * `Runtime._step` calls `_updateGlows` and only reaches `renderer.draw()`
 * afterwards. scratch-gui's glow handler throws "Tried to glow block that does
 * not exist." whenever a running script's blocks were deleted, and that
 * exception skips the draw — so the project keeps executing while the stage
 * stops updating. Reproduced on a build predating these controls, so this
 * guards upstream behaviour rather than our own.
 *
 * Returns a function that removes the guard.
 */
export function guardGlowUpdates(
  runtime: ExecutionRuntimeLike,
  onError?: (error: unknown) => void,
): () => void {
  const original = runtime._updateGlows;
  if (typeof original !== "function" || runtime[GLOW_GUARD_FLAG]) {
    return () => {};
  }
  const bound = original.bind(runtime);
  runtime._updateGlows = (...args: unknown[]) => {
    try {
      return bound(...args);
    } catch (error) {
      onError?.(error);
      return undefined;
    }
  };
  runtime[GLOW_GUARD_FLAG] = true;
  return () => {
    runtime._updateGlows = original;
    runtime[GLOW_GUARD_FLAG] = false;
  };
}

/** Paints the given blocks as "currently running"; called with [] to clear. */
export type BlockHighlighter = (blockIds: string[]) => void;

export interface ExecutionControlOptions {
  highlight?: BlockHighlighter;
}

export type ExecutionVmLike = {
  /**
   * `unknown` on purpose: callers hold a scratch-vm typed by the app, so the
   * runtime is narrowed structurally here instead of at every call site.
   */
  runtime?: unknown;
};

export type ExecutionState = "running" | "paused";

export interface ExecutionSnapshot {
  state: ExecutionState;
  /** Blocks highlighted right now (empty while running). */
  highlightedBlockIds: string[];
  /** Frames advanced by stepFrame() since install. */
  steppedFrames: number;
}

export interface ExecutionController {
  getSnapshot(): ExecutionSnapshot;
  pause(): void;
  resume(): void;
  /** Advance exactly one VM frame. Pauses first when running. */
  stepFrame(): void;
  subscribe(listener: (snapshot: ExecutionSnapshot) => void): () => void;
  /** Restore the original `_step` and clear any highlight. */
  dispose(): void;
}

/**
 * Blocks each non-monitor thread is sitting on, newest execution first.
 * `blockGlowInFrame` is what the sequencer just ran; `peekStack()` is what it
 * will run next. Prefer the former so a paused VM highlights the block the
 * learner just watched take effect.
 */
export function readActiveBlockIds(
  runtime: ExecutionRuntimeLike | null | undefined,
): string[] {
  const threads = runtime?.threads;
  if (!Array.isArray(threads)) return [];
  const ids: string[] = [];
  for (const thread of threads) {
    if (!thread || thread.updateMonitor) continue;
    let id: unknown = thread.blockGlowInFrame;
    if (typeof id !== "string" || !id) {
      try {
        id = thread.peekStack?.();
      } catch {
        id = null;
      }
    }
    if (typeof id === "string" && id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Stop threads whose script hat no longer exists.
 *
 * scratch-vm's `deleteBlock` does not stop running threads (upstream TODO).
 * While paused that leaves a live thread pointing at deleted blocks; pressing
 * green flag / resume must not revive motion from a script the learner already
 * removed. Returns how many threads were retired.
 */
function threadScriptIsGone(thread: ExecutionThreadLike): boolean {
  const blocks = thread.target?.blocks;
  // Without a blocks API we cannot tell — leave the thread alone (tests / odd
  // hosts). Only retire when we positively see the script is gone.
  if (!blocks || typeof blocks.getBlock !== "function") return false;

  const scripts = blocks.getScripts?.();
  if (Array.isArray(scripts) && scripts.length === 0) return true;

  const top = thread.topBlock;
  if (typeof top === "string" && top && blocks.getBlock(top) == null) {
    return true;
  }

  // Forever / loop body deleted while the hat remains: the stack still points
  // at a missing block id and must not keep ticking.
  let current: unknown;
  try {
    current = thread.peekStack?.();
  } catch {
    current = null;
  }
  if (typeof current === "string" && current && blocks.getBlock(current) == null) {
    return true;
  }

  return false;
}

export function retireOrphanThreads(
  runtime: ExecutionRuntimeLike | null | undefined,
): number {
  if (!runtime) return 0;
  const threads = runtime.threads;
  if (!Array.isArray(threads) || threads.length === 0) return 0;

  let retired = 0;
  for (let i = threads.length - 1; i >= 0; i -= 1) {
    const thread = threads[i];
    if (!thread || thread.updateMonitor || thread.isKilled) continue;
    if (!threadScriptIsGone(thread)) continue;

    if (typeof runtime._stopThread === "function") {
      try {
        runtime._stopThread(thread);
      } catch {
        thread.isKilled = true;
      }
    } else {
      thread.isKilled = true;
    }
    // Drop it immediately so a paused VM does not keep a zombie around until
    // the next free-running step filters `isKilled`.
    threads.splice(i, 1);
    retired += 1;
  }
  return retired;
}

/**
 * Install pause/step control on `vm`. Calling this twice on the same runtime
 * returns a controller over the existing patch rather than stacking wrappers.
 */
export function installExecutionControl(
  vm: ExecutionVmLike,
  options: ExecutionControlOptions = {},
): ExecutionController | null {
  const runtime =
    vm.runtime && typeof vm.runtime === "object"
      ? (vm.runtime as ExecutionRuntimeLike)
      : null;
  if (!runtime || typeof runtime._step !== "function") return null;

  let state: ExecutionState = "running";
  let framesToRun = 0;
  let steppedFrames = 0;
  let highlighted: string[] = [];
  let disposed = false;
  const listeners = new Set<(snapshot: ExecutionSnapshot) => void>();

  // Keep the raw reference so dispose() can hand back exactly what it replaced;
  // other patchers (turbowarp-vm-compat) wrap this same method.
  const rawStep = runtime._step;
  const originalStep = rawStep.bind(runtime);

  const snapshot = (): ExecutionSnapshot => ({
    state,
    highlightedBlockIds: [...highlighted],
    steppedFrames,
  });

  const notify = () => {
    const current = snapshot();
    for (const listener of listeners) {
      try {
        listener(current);
      } catch {
        // A broken listener must not stop the VM.
      }
    }
  };

  const setHighlight = (ids: string[]) => {
    const unchanged =
      ids.length === highlighted.length &&
      ids.every((id, index) => highlighted[index] === id);
    highlighted = ids;
    if (unchanged) return;
    try {
      options.highlight?.(ids);
    } catch {
      // A failed repaint must never stop the VM.
    }
  };

  // Pressing the green flag must always start the project. Leaving it paused
  // looks exactly like a broken editor: the flag lights up, a thread is
  // created, and nothing moves.
  const onProjectStart = () => {
    // stopAll already ran; still drop any orphan that slipped through before
    // hats are started (e.g. deleted-while-paused forever loop).
    retireOrphanThreads(runtime);
    if (state === "paused") {
      state = "running";
      framesToRun = 0;
      setHighlight([]);
      notify();
    }
  };
  runtime.on?.("PROJECT_START", onProjectStart);

  // Block edits while paused must not leave a runnable zombie thread. Without
  // this, deleting the forever loop and then free-running (resume / flag) can
  // look like "the sprite moves with no blocks on the workspace".
  const onProjectChanged = () => {
    if (disposed) return;
    if (retireOrphanThreads(runtime) > 0 && state === "paused") {
      setHighlight(readActiveBlockIds(runtime));
      notify();
    }
  };
  runtime.on?.("PROJECT_CHANGED", onProjectChanged);

  runtime._step = (...args: unknown[]) => {
    if (disposed) return originalStep(...args);
    retireOrphanThreads(runtime);
    if (state === "paused") {
      if (framesToRun <= 0) return undefined;
      framesToRun -= 1;
      const result = originalStep(...args);
      steppedFrames += 1;
      setHighlight(readActiveBlockIds(runtime));
      notify();
      return result;
    }
    return originalStep(...args);
  };
  runtime[PATCH_FLAG] = true;

  return {
    getSnapshot: snapshot,
    pause() {
      if (disposed || state === "paused") return;
      state = "paused";
      framesToRun = 0;
      setHighlight(readActiveBlockIds(runtime));
      notify();
    },
    resume() {
      if (disposed || state === "running") return;
      state = "running";
      framesToRun = 0;
      setHighlight([]);
      notify();
    },
    stepFrame() {
      if (disposed) return;
      if (state === "running") {
        state = "paused";
        setHighlight(readActiveBlockIds(runtime));
      }
      framesToRun += 1;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.off?.("PROJECT_START", onProjectStart);
      runtime.off?.("PROJECT_CHANGED", onProjectChanged);
      setHighlight([]);
      listeners.clear();
      runtime._step = rawStep;
      runtime[PATCH_FLAG] = false;
    },
  };
}
