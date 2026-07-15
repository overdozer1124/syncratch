# Internal API dependencies (`scratch-adapter`)

## Pin vs headless runtime

| Item | Value |
|---|---|
| Vendor pin (AGPL source) | `vendor/scratch-editor` @ `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` (`v14.1.0`) |
| Headless Gate 0 runtime | Vendor-built `@scratch/scratch-vm@14.1.0` → `packages/scratch-vm/dist/node/scratch-vm.js` |

| Symbol / path | Stability | Usage |
|---|---|---|
| `VirtualMachine` (vendor dist) | Built from pin | create runtime |
| `vm.loadProject` | Published | load Gate 0 JSON projects |
| `vm.greenFlag()` | Published | start scripts |
| `vm.runtime.threads` | Semi-internal | observe threads |
| `vm.runtime.targets` | Semi-internal | observe x/y/vars |
| `vm.runtime.currentStepTime` | Semi-internal | required before `_step` executes threads |
| `vm.runtime._step` | Internal | normal execution frames |
| `thread.peekStack()` | Internal | current block id |
| `thread.goToNextBlock()` | Internal | wrapped for linear visual step boundary |
| `thread.pushStack()` | Internal | wrapped for control/branch visual step boundary |
| `runtime.sequencer.stepThread` / `stepToBranch` | Internal | run/step wrapping; not modified on disk |
| `target.blocks.getNextBlock` | Internal | next block observation |
| `target.variables` | Semi-internal | variable snapshot |

**Visual step boundaries:** command / hat / control (`goToNextBlock` + non-null `pushStack` from `startBranch`). Reporters remain inside parent evaluation.

**Vendor source patches:** none.
