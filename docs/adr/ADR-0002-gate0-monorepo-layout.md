# ADR-0002: Gate 0 monorepo layout

## Status

Accepted (2026-07-15).

## Decision

Use a pnpm workspace with `packages/*` and `apps/*` only. Exclude `vendor/**` from workspace discovery. Gate 0 package APIs are experimental.

## Consequences

Scratch builds use upstream npm inside `vendor/scratch-editor`. BlockSync packages never hoist vendor `node_modules` into the workspace.
