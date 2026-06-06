# Phase 5 Status — TrustlessJanice

> Date: 2026-06-06
> Status: Planning only. Gate 0 is still open.
> Source of truth: [Phase 5 implementation spec](./plans/2026-06-04-phase-5-trustless-janice.md)

## Decision

Phase 5 uses multi-iteration TrustlessJanice with keeper-driven resume. The previous on-chain transcript resume design is superseded.

The selected architecture is:

- `createTrustlessTask(...)` is a dedicated trustless entrypoint
- trustless tasks start with zero seeded steps
- Janice callbacks execute allowed tools on-chain
- dynamic `hireSubAgent` steps are appended and emitted as explicit events
- after a child step settles, the task becomes resume-needed
- a backend keeper reconstructs transcript state from indexed events and calls `resumeTrustlessTask(...)`
- task timeout remains on the existing `timeoutTask` path

## Current Blockers

Gate 0 must be completed before implementation merges or any trustless flag is enabled.

- T2: live `janice` `maxIterations` overflow behavior
- T3: gas cost per trustless tool-call round trip
- T4: STT charged per iteration versus a single request

Gate 0 deliverable:

- `docs/plans/2026-06-04-trustless-janice-gate-results.md` with concrete measurements

## Repo Reality Checks

These points are now fixed in the planning docs and should not drift again:

- `/api/plan` remains Claude-only
- trustless uses `/api/trustless-preflight` plus direct on-chain submission
- there is no `/feeds` acceptance dependency
- the existing timeout keeper remains the task reaper
- dynamic trustless steps must be indexed explicitly
- `PolicyPanel` trustless-cap writes must preserve the live `allowedContracts` list

## Execution Order

1. Gate 0 measurements
2. Contract trustless flow and tests
3. Shared helpers and trustless ABI/types
4. Backend preflight, indexer, and resume keeper
5. Frontend trustless console mode behind feature flags

For implementation details, use the spec document only: [docs/plans/2026-06-04-phase-5-trustless-janice.md](/home/probin-sir/Documents/hackathons/somnia-agentation/twiin/docs/plans/2026-06-04-phase-5-trustless-janice.md).
