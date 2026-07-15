# Internal API dependencies (`scratch-adapter`)

## Pin vs headless runtime

| Item | Value |
|---|---|
| Vendor pin (AGPL source) | `vendor/scratch-editor` @ `7c172e469eb3c21c1e6326ea6cccea60bc14e3a8` (`v14.1.0`) |
| Headless Gate 0 runtime package | `scratch-vm@5.0.300` (CJS via `createRequire`) |

**Why not `@scratch/scratch-vm@14.1.0` for tests yet:** the published Node webpack bundle fails to construct under this environment (missing `browser/default-stylesheet.css`; after stubbing, `implementation is not a constructor`). No vendor source patch was applied (ADR-0001 stop condition avoided). Release 1 should prefer a **vendor-built** `@scratch/scratch-vm` from the pinned SHA.

| Symbol / path | Stability | Usage |
|---|---|---|
| `VirtualMachine` (`scratch-vm`) | Published CJS | create runtime |
| `vm.loadProject` | Published | load Gate 0 JSON projects |
| `vm.greenFlag()` | Published | start scripts |
| `vm.runtime.threads` | Semi-internal | observe threads |
| `vm.runtime.targets` | Semi-internal | observe x/y/vars |
| `thread.peekStack()` | Internal | current block id |
| `thread.goToNextBlock()` | Internal | wrapped for one visual step |
| `runtime.sequencer.stepThreads` / `stepThread` | Internal | run/step; not modified on disk |
| `target.blocks.getNextBlock` | Internal | next block observation |
| `target.variables` | Semi-internal | variable snapshot |

**Vendor source patches:** none.
