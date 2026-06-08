# @twiin/reactivity-lens

Somnia reactivity / OracleFeed snapshot external agent for Twiin corroboration pipelines.

## What it does

- Registers on-chain as `reactivity-lens@twiin` with capability `data.specialized`
- Reads `OracleFeed` and `AgentRefreshCoordinator` via Somnia RPC (`eth_call` + `eth_getLogs`)
- Returns feed publish counts, refresh scheduled/skipped events, and optional per-feed staleness

## Setup

```bash
cp apps/reactivity-lens/.env.example apps/reactivity-lens/.env.local
# Set EXTERNAL_PRIVATE_KEY; PORT=3016, EXTERNAL_PUBLIC_URL=http://127.0.0.1:3016
```

## Run

```bash
pnpm dev:reactivity-lens
pnpm test:reactivity-lens
pnpm smoke:reactivity-lens   # requires server running on :3016
pnpm register:reactivity-lens
```

## Planner payload

```json
{ "lookbackBlocks": 1000, "agentId": 1, "topic": "somnia.usd" }
```

`agentId` + `topic` are optional; omit both to scan recent feed/refresh events only.
