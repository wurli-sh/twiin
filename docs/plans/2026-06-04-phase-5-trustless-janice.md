# Phase 5 — TrustlessJanice Implementation Spec

> Source of truth for Phase 5. This document replaces the previous on-chain transcript resume design.
> Gate 0 is a merge blocker. Do not enable any user-facing trustless flag until Gate 0 results are committed.

## Goal

Add `PlanMode.TrustlessJanice` end to end using a multi-iteration Janice loop with keeper-driven resume:

- user submits `goal + budget` directly on-chain through `createTrustlessTask`
- Janice callbacks arrive on-chain through `agentsApi`
- Janice may execute allowed on-chain tools immediately
- dynamic hired steps reuse existing orchestrator step execution
- when a hired step settles, the task moves into a resume-needed state
- a backend keeper reconstructs the transcript from indexed events and calls `resumeTrustlessTask`

The contract does not store or reconstruct a full transcript on-chain.

## Current Repo Alignment

This plan is written against the current repo state, not stale product docs.

| Area | Current state | Phase 5 implication |
|------|---------------|---------------------|
| Contracts | `PlanMode.TrustlessJanice` exists; no trustless task entrypoint yet | add dedicated trustless flow to `packages/contracts/src/AgentOrchestrator.sol` |
| Shared | policy cap and enum scaffolding exist | add trustless encode/decode helpers and event typings |
| Backend | `/api/plan` is Claude-only; indexer and timeout keepers already exist | add `/api/trustless-preflight`, trustless resume keeper, and trustless event indexing |
| Frontend | console uses `PlanApproval`; trustless UI hidden; `PolicyPanel` currently preserves trustless cap as read-only | add feature-flagged trustless console flow and safe policy editing |
| Oracle UI | no `/feeds` route | acceptance must validate oracle output in console, task result, and timeline instead |

## Locked Architecture

### 1. Contract entrypoints

- `createTrustlessTask(personalAgentId, intentPayload, budgetWei)` is a new entrypoint.
- It does not reuse `createTask` seeded-step calldata or Claude planner output.
- Trustless tasks start with zero steps.
- `resumeTrustlessTask(taskId, resumePayload, janiceCostWei)` is a new keeper-only resume entrypoint.

Locked payload rules:

- `intentPayload` is `abi.encode(string goal)`.
- `resumePayload` is the exact ABI-encoded payload for the Janice native agent call described below.
- The contract must not depend on reconstructing the original goal from nested transaction calldata alone.

Locked Janice ABI contract:

- Trustless Janice uses a single shared payload format for both the initial request and resume requests.
- Shared/backend helpers must expose one canonical encoder for the Janice native-agent call, and contract code forwards the returned bytes unchanged into `agentsApi.createRequest(...)`.
- The payload must be ABI-encoded as a function call to `inferToolsChat`.
- The canonical logical arguments are:
  - `systemPrompt: string`
  - `messagesJson: string`
  - `onchainToolsJson: string`
  - `maxIterations: uint8`
- `messagesJson` is a JSON array of chat messages reconstructed off-chain.
- `onchainToolsJson` is a JSON array describing the exact callable tool signatures exposed by the orchestrator for trustless mode.
- `resumePayload` is not a delta patch. It contains the full next `inferToolsChat` request body for the resumed iteration.

Locked Janice response contract:

- `decodeTrustlessJaniceResult` in shared must decode the Janice callback result into one canonical shape:
  - `finishReason: string`
  - `toolCalls: Array<{ toolName: string; argsJson: string }>`
  - `assistantMessage: string`
- `finishReason` must be normalized to one of:
  - `tool_calls`
  - `stop`
  - `max_iterations`
  - `error`
- `toolCalls` preserves call order and is empty when Janice returned no tool call.
- `argsJson` is the exact JSON argument object for that tool call.
- Contract code may decode `argsJson` further per tool, but shared/backend/indexer code must use the normalized decoded result shape above.

### 2. Canonical on-chain trustless state

Trustless state stores only canonical execution state. Do not store a resumable transcript.

Suggested shape:

```solidity
struct TrustlessCtx {
    uint256 janiceRequestId;
    uint8 iterations;
    uint8 maxIterations;
    TrustlessAwaiting awaiting;
    uint64 deadline;
    bytes32 intentHash;
}
```

`TrustlessAwaiting` should represent:

- `Janice`
- `Step`
- `Resume`
- `Done`

`MAX_JANICE_ITERATIONS` is not guessed in this spec. Gate 0 defines the shipped constant before merge.

### 2.1 Funding and request routing

- Janice iterations are funded from the trustless task budget, not from keeper `msg.value`.
- `createTrustlessTask` and `resumeTrustlessTask` must use the same native-lane funding pattern as existing Somnia-native steps:
  - enforce `spentWei + janiceCostWei <= budgetWei`
  - pull `janiceCostWei` from escrow with `vault.payNative(...)`
  - forward that value into `agentsApi.createRequest{value: janiceCostWei}(...)`
- The contract must keep an explicit request-to-task route for trustless Janice callbacks.
  - Acceptable implementations: a dedicated `trustlessReqIndex[requestId] => taskId` mapping, or an extended request-ref struct that distinguishes Janice-loop callbacks from ordinary native step callbacks.
- Do not overload the existing step-only `nativeReqIndex` shape without also preserving a way to identify trustless Janice responses separately from child-step responses.

### 3. Janice execution model

- Janice callbacks still arrive on-chain through `agentsApi`.
- The contract decodes Janice tool calls and executes allowed actions immediately.
- `hireSubAgent` appends a new step dynamically.
- The contract emits structured trustless events for every Janice/tool/resume transition.
- The backend indexer reconstructs the transcript from:
  - original goal
  - Janice iteration events
  - appended-step events
  - tool execution events
  - child-step results
- The backend resume keeper submits the next `resumeTrustlessTask` call.

To make this indexable without brittle transaction decoding, trustless creation must emit a dedicated intent event such as:

```solidity
event TrustlessTaskIntent(
    uint256 indexed taskId,
    string goal,
    bytes32 intentHash,
    uint8 maxIterations
);
```

The initial goal should be sourced from this event in backend storage and resume reconstruction.

Locked trustless event contract:

```solidity
event JaniceIteration(
    uint256 indexed taskId,
    uint8 indexed iteration,
    uint256 requestId,
    string finishReason,
    bytes32 transcriptHash
);

event JaniceToolExecuted(
    uint256 indexed taskId,
    uint8 indexed iteration,
    string toolName,
    bytes32 argsHash,
    bool success
);

event JaniceResumeQueued(
    uint256 indexed taskId,
    uint8 indexed nextIteration,
    bytes32 transcriptHash,
    string reason
);
```

Event rules:

- `JaniceIteration`
  - emitted once per Janice callback processed
  - `iteration` is the iteration that just completed
  - `requestId` is the Janice request id that produced the callback
  - `transcriptHash` is the keeper/backend canonical transcript hash after applying that callback

- `JaniceToolExecuted`
  - emitted once per trustless tool invocation attempted from a Janice callback
  - `toolName` must match the registered tool name string used in `onchainToolsJson`
  - `argsHash` is `keccak256(bytes(argsJson))`
  - `success` is false if the tool attempt is rejected or fails and the task is then aborted/stopped

- `JaniceResumeQueued`
  - emitted when a trustless child step settles and the task moves into `awaiting = Resume`
  - also emitted if the contract intentionally pauses between Janice iterations for off-chain reconstruction
  - `reason` should be one of `step_succeeded`, `step_failed`, or `tool_batch_complete`

### 4. Dynamic steps are first-class indexed objects

Trustless steps are not fully known at task creation time. The indexer cannot rely only on decoding `createTask` calldata.

`hireSubAgent` must emit a dedicated event such as:

```solidity
event TrustlessStepAppended(
    uint256 indexed taskId,
    uint8 indexed stepIdx,
    uint256 configId,
    bytes payload,
    uint256 maxCostWei,
    uint64 timeoutSeconds
);
```

### 5. Step completion does not auto-complete trustless tasks

`_advance` must branch on `PlanMode.TrustlessJanice`.

- For ClaudePlan, current behavior remains unchanged.
- For TrustlessJanice, when a hired step settles successfully:
  - do not call `_completeTask` because the cursor reached the end
  - set `awaiting = Resume`
  - emit a resume-needed event such as `JaniceResumeQueued`

Trustless completion happens only via:

- `completeTrustlessTask`
- abort
- task timeout

### 6. Timeout model stays unified

- Keep using existing `timeoutTask` for task-level expiry.
- Do not introduce a second timeout keeper.
- Add a `timeoutTrustlessTask` wrapper only if the contract implementation truly needs a trustless-specific public entrypoint.
- Otherwise extend existing timeout/indexer logic only where trustless-specific handling is required.

## File-Level Work Plan

### PR1 — Gate 0, merge blocker

Measure the live Somnia behavior before landing the feature.

Files:

- create `packages/contracts/scripts/measure-trustless-janice.ts`
- create `docs/plans/2026-06-04-trustless-janice-gate-results.md`

Required outputs:

- T2: `maxIterations` overflow behavior against live `janice`
- T3: gas per trustless tool-call round trip
- T4: STT charged per iteration versus a single request

Gate 0 exit criteria:

- repo-local gate results doc contains concrete numbers
- `MAX_JANICE_ITERATIONS` is set from those measurements
- trustless preflight budget defaults use those measurements

### PR2 — Contracts

Primary files:

- `packages/contracts/src/AgentOrchestrator.sol`
- `packages/contracts/src/TwiinTypes.sol`
- `packages/contracts/test/TrustlessJanice.test.ts`
- `packages/contracts/src/mocks/MockAgentsApi.sol`

Required contract changes:

1. Add trustless storage and events.
2. Add `createTrustlessTask`.
3. Add `resumeTrustlessTask`.
4. Add explicit trustless request-id routing for Janice callbacks.
5. Add trustless tool-call handling.
6. Add dynamic trustless step append events.
7. Branch `_advance` for trustless resume semantics.
8. Keep ClaudePlan behavior unchanged.

Detailed contract requirements:

- `createTrustlessTask(personalAgentId, intentPayload, budgetWei)`
  - same 6551 auth model as `createTask`
  - decodes `intentPayload` as `abi.encode(string goal)`
  - validates budget using `maxPerTaskWeiTrustless`
  - creates a zero-step trustless task
  - stores `intentHash`, deadline, iterations state, and initial awaiting state
  - emits `TrustlessTaskIntent(taskId, goal, intentHash, maxIterations)`
  - charges Janice request cost from task escrow using the existing vault native-payment path
  - builds the first `inferToolsChat(systemPrompt, messagesJson, onchainToolsJson, maxIterations)` payload using the shared canonical encoder
  - submits first Janice request

- `resumeTrustlessTask(taskId, resumePayload, janiceCostWei)`
  - callable by keeper flow only
  - requires `awaiting == Resume`
  - requires `resumePayload` to be the full canonical `inferToolsChat(...)` ABI payload for the next iteration
  - increments iteration state safely
  - enforces `maxIterations`
  - charges Janice request cost from remaining task escrow, not keeper wallet funds
  - submits next Janice request

- Janice callback handling
  - resolves trustless request id to `taskId` explicitly, without relying on `stepIdx`
  - decode trustless Janice result using the shared canonical decoder shape
  - emit `JaniceIteration` exactly once per processed callback
  - if tool call is `hireSubAgent`, append a step and emit `TrustlessStepAppended`
  - if tool call is `publishOracle`, route through existing publish path
  - if tool call is `rateSubAgent`, route through existing rating path if supported
  - if tool call is `completeTrustlessTask`, complete task explicitly
  - emit `JaniceToolExecuted` for every attempted trustless tool call
  - if `maxIterations` or deadline is hit, abort or stop safely

- `_advance` integration
  - on trustless child-step success, move to `awaiting = Resume`
  - emit `JaniceResumeQueued`
  - never treat step exhaustion as trustless completion

Required contract tests:

- zero-step trustless task creation
- Janice tool-call happy path
- dynamic step append plus indexable event emission
- successful resume after child-step completion
- policy enforcement using `maxPerTaskWeiTrustless`
- max-iterations abort
- task timeout
- ClaudePlan regression

### PR3 — Shared package

Primary files:

- `packages/shared/constants.ts`
- `packages/shared/index.ts`
- `packages/shared/trustless.ts`
- `packages/shared/test/parity.test.ts`

Required shared exports:

- `encodeCreateTrustlessTask`
- `encodeResumeTrustlessTask`
- `encodeTrustlessJanicePayload`
- `decodeTrustlessJaniceResult`
- trustless event typings/helpers
- `MAX_JANICE_ITERATIONS`

Notes:

- `MAX_JANICE_ITERATIONS` must come from Gate 0, not a guessed placeholder.
- `encodeCreateTrustlessTask` must encode `intentPayload` as `abi.encode(string goal)`.
- `encodeTrustlessJanicePayload` must be the single source of truth for `inferToolsChat(systemPrompt, messagesJson, onchainToolsJson, maxIterations)`.
- `encodeResumeTrustlessTask` must accept already-reconstructed Janice resume bytes and wrap only the contract call, not rebuild transcript state internally.
- `decodeTrustlessJaniceResult` must normalize raw Janice output into the locked result shape in this spec.
- ABIs and typed helpers must reflect the new trustless events and entrypoints.

### PR4 — Backend

Primary files:

- `apps/backend/src/env.ts`
- `apps/backend/src/routes/trustless-preflight.ts`
- `apps/backend/src/keepers/indexer.ts`
- `apps/backend/src/db.ts`
- `apps/backend/src/schema.ts`
- existing keeper bootstrap in `apps/backend/src/index.ts`
- trustless resume keeper implementation file under `apps/backend/src/keepers/`
- backend tests under `apps/backend/test/`

Required backend behavior:

- add `ENABLE_TRUSTLESS_JANICE` to backend env parsing and keeper startup gating

- add `POST /api/trustless-preflight`
  - this is the only trustless planning entrypoint
  - validates goal length
  - calculates minimum budget from Gate 0 results
  - returns orchestrator address and calldata
  - does not call Claude

- add trustless resume keeper
  - read trustless and Janice events
  - reconstruct transcript from indexed data
  - call `resumeTrustlessTask`
  - stop or abort when `maxIterations` or deadline is hit

- extend the existing indexer
  - decode both `createTask` and `createTrustlessTask`
  - persist the initial trustless goal from `TrustlessTaskIntent` rather than relying on nested `TwiinAccount.execute(...)` calldata only
  - ingest dynamic trustless events including:
    - `TrustlessTaskIntent`
    - `TrustlessStepAppended`
    - `JaniceIteration`
    - `JaniceToolExecuted`
    - `JaniceResumeQueued` or equivalent

- do not create a second timeout keeper
  - existing `timeouts.ts` remains the task-level timeout mechanism
  - extend only as needed for trustless-specific state handling

- add explicit backend persistence for trustless metadata
  - task table or companion table must store enough data for keeper resume, at minimum:
    - `goal`
    - `intentHash`
    - `iterations`
    - `maxIterations`
    - `awaiting`
    - latest `janiceRequestId`
  - implement this through concrete migrations in `apps/backend/src/db.ts` and `apps/backend/src/schema.ts`
  - do not rely on in-memory keeper state for transcript reconstruction or resume safety

Required backend tests:

- trustless preflight budget calculation
- resume-keeper transcript reconstruction from indexed events
- indexer ingestion for dynamic trustless steps and Janice events
- schema migration coverage for storing trustless goal/iteration metadata

### PR5 — Frontend

Primary files:

- trustless feature config under `apps/frontend/src/config/`
- trustless create-task hook under `apps/frontend/src/hooks/`
- console components/pages under `apps/frontend/src/components/console/` and `apps/frontend/src/pages/`
- `apps/frontend/src/components/agents/PolicyPanel.tsx`
- `apps/frontend/src/hooks/useAgentPolicy.ts`

Required frontend behavior:

- trustless console mode is feature-flagged
- trustless mode bypasses `PlanApproval` entirely
- console shows:
  - preflight budget
  - trustless cap
  - iteration warning
  - direct submit flow via `useCreateTrustlessTask`

- trustless preflight validates against `maxPerTaskTrustless`, not `maxPerTask`

- `PolicyPanel` trustless-cap editing must preserve `allowedContracts`
  - `useAgentPolicy` must read the current policy from chain first
  - source `allowedContracts` from the live policy read, not local constants
  - write it back unchanged when updating caps
  - do not hard-code `[addresses.mockRouter]` or any replacement allowlist during trustless-cap edits
  - preserve the existing kill-switch state while updating trustless cap

- acceptance is console-driven
  - no `/feeds` dependency
  - oracle output must be visible through console/task result/timeline

## Acceptance Criteria

### Product acceptance

- trustless goal can be submitted from the console behind a feature flag
- preflight shows budget and iteration warnings before submit
- Janice iteration events and dynamic steps appear in the console timeline
- a hired step can finish and trigger a keeper-driven resume
- trustless completion appears in the console/task result
- disabling the flag leaves ClaudePlan flow unchanged

### Technical acceptance

- Gate 0 results committed before feature flag enablement
- trustless tasks are zero-step at creation
- dynamic trustless steps are indexable without relying on seeded calldata only
- resume flow is keeper-driven, not on-chain transcript replay
- task-level timeout still uses the existing timeout pathway
- shared typings/helpers cover all new trustless entrypoints and events

## Non-Goals

Out of scope for this phase:

- restoring or introducing a `/feeds` route
- changing `/api/plan` away from Claude-only behavior
- storing full Janice conversation transcripts on-chain
- creating a parallel trustless timeout keeper
- enabling the trustless user toggle before Gate 0 is committed

## Implementation Order

1. PR1: Gate 0 measurements and constants
2. PR2: contracts and tests
3. PR3: shared helpers and ABI exports
4. PR4: backend preflight, indexer, and resume keeper
5. PR5: frontend trustless console and safe policy editing

If any implementation detail conflicts with this spec, this spec wins over the older Phase 5 docs.
