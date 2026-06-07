# @twiin/backend/src/keepers/ — Keeper Bots

6 keepers running as background loops on the Hono server. Each polls at a fixed interval and processes on-chain events.

## Keeper Index

| Keeper | File | Poll | Watches | Action |
|--------|------|------|---------|--------|
| Indexer | `indexer.ts` | 4s | TaskCreated, StepStateChanged, ExternalAgentRequest, ExternalResultPending, ExternalStepApproved, external lifecycle | Decodes task steps from createTransaction; upserts to SQLite; publishes SSE; fast-forward on large lag; rewind on cursor-ahead |
| Relay | `relay.ts` | 4s | `ExternalAgentRequest` | HTTP POST to external agent or Claude Sonnet (native); submits ECDSA-signed result on-chain |
| Rater | `rater.ts` | 6s | `ExternalResultPending` | Rates via Claude Haiku; submits `rateStep` if score ≥ 40 |
| Externals | `externals.ts` | 4s | `ExternalAgentRegistered`, `ExternalEndpointUpdated`, `ExternalDeregistered` | Syncs external agent metadata into SQLite; bootstraps cache from historical logs |
| Timeouts | `timeouts.ts` | 5s | Pending steps past deadline (RunningExternal, AwaitingRating, RunningNative) | Calls `timeoutExternalStep`, `timeoutRating`, `timeoutNativeStep`, or `timeoutTask` on-chain |
| Trustless Resume | `trustless-resume.ts` | 6s | Stalled trustless tasks (TrustlessAwaiting) | Resubmits janice requests for trustless tasks past deadline |

## Architecture

```
Blockchain events
     ↓
Indexer ──→ SQLite ──→ SSE (frontend)
     │
     ├── Relay ──→ HTTP/Claude ──→ submitExternalResult
     ├── Rater ──→ Claude Haiku ──→ rateStep
     ├── Externals ──→ SQLite cache sync
     ├── Timeouts ──→ on-chain timeout fns
     └── Trustless Resume ──→ resubmit janice requests
```

## Common Conventions

- Poll constant at top of file (`POLL_MS = 4_000`, `6_000`, or `5_000`)
- Deduplicate via SQLite upsert / `isResultSubmitted` / `isRatingSubmitted` checks
- Catch errors per iteration; never crash the loop
- All keepers start in `src/index.ts` via `startKeepers()`
