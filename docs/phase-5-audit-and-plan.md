# Phase 5 Status — TrustlessJanice

> Date: 2026-06-07
> Status: **Deprioritized.** Claude Plan remains the sole default planning path.
> Replacement wedge: consensus receipts + corroborated native steps (see Phase 6 in `build-context.md`).

## Decision (2026-06-07)

TrustlessJanice was built end-to-end but proved brittle on live Somnia (keeper/indexer fragility, ~0.24 STT/iteration, tool-batching aborts). The console UI no longer surfaces it by default; `ENABLE_TRUSTLESS_JANICE` / `VITE_ENABLE_TRUSTLESS_JANICE` stay off.

**Active path:** Claude Haiku planner → on-chain orchestration with **consensus receipts** on every native Somnia agent step (ported from tsugu `AgentCompute`).

## TrustlessJanice (archived, behind flag)

If re-enabled later, the architecture is:

- `createTrustlessTask(...)` dedicated trustless entrypoint
- Janice `inferToolsChat` via Somnia consensus
- Keeper-driven `resumeTrustlessTask` from indexed events
- Gate 0 measurements: `docs/plans/2026-06-04-trustless-janice-gate-results.md`

## Repo Reality Checks

- `/api/plan` — Claude-only (production default)
- `/api/trustless-preflight` — only when `ENABLE_TRUSTLESS_JANICE=true`
- Consensus receipts — `StepConsensusReached` on native `handleResponse` path
