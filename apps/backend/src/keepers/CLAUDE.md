# @twiin/backend/src/keepers/ — Keeper Bots

5 keepers running as background loops on the Hono server. Each polls at a fixed interval and processes on-chain events.

## Keeper Index

| Keeper | File | Poll | Watches | Action |
|--------|------|------|---------|--------|
| Indexer | `indexer.ts` | 4s | 10+ event types (TaskCreated, StepStateChanged, external lifecycle) | Upserts to SQLite, publishes SSE updates |
| Relay | `relay.ts` | 4s | `ExternalAgentRequest` | HTTP POST to external agent or Claude Sonnet (native); submits ECDSA-signed result on-chain |
| Rater | `rater.ts` | 6s | `ExternalResultPending` | Rates via Claude Haiku; submits `rateStep` if score ≥ 40 |
| Externals | `externals.ts` | 4s | `ExternalAgentRegistered`, `ExternalEndpointUpdated`, `ExternalDeregistered` | Syncs external agent metadata into SQLite; bootstraps cache from historical logs |
| Timeouts | `timeouts.ts` | 5s | Pending steps past deadline (RunningExternal, AwaitingRating, RunningNative) | Calls `timeoutExternalStep`, `timeoutRating`, `timeoutNativeStep`, or `timeoutTask` on-chain |

## Architecture

```
Blockchain events
     ↓
Indexer ──→ SQLite ──→ SSE (frontend)
     │
     ├── Relay ──→ HTTP/Claude ──→ submitExternalResult
     ├── Rater ──→ Claude Haiku ──→ rateStep
     ├── Externals ──→ SQLite cache sync
     └── Timeouts ──→ on-chain timeout fns
```

## Common Conventions

- Poll constant at top of file (`POLL_MS = 4_000`, `6_000`, or `5_000`)
- Deduplicate via SQLite upsert / `isResultSubmitted` / `isRatingSubmitted` checks
- Catch errors per iteration; never crash the loop
- All keepers start in `src/index.ts` via `startKeepers()`
