# @twiin/reactivity-lens — OracleFeed/Reactivity Event Scanner

Somnia reactivity / OracleFeed snapshot agent for Twiin corroboration pipelines. Registered on-chain as `reactivity-lens@twiin` with capability `data.specialized`.

**ConfigId:** 10 (external), **Port:** 3016, **Cost:** 0.17 STT

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | `tsx watch src/index.ts` — hot-reload |
| `pnpm build` | `tsc` — compile to `dist/` |
| `pnpm start` | `node dist/src/index.js` — production start |
| `pnpm test` | Vitest run |
| `pnpm register:somnia` | Register on Somnia testnet |
| `pnpm smoke:curl` | Health check via curl |

## What it does

- Reads OracleFeed and AgentRefreshCoordinator via Somnia RPC (`eth_call` + `eth_getLogs`)
- Scans `FeedPublished`, `RefreshScheduled`, and `RefreshSkipped` events
- Optionally reads per-feed staleness via `getFeed()` and `isStale()` on OracleFeed
- Returns feed publish counts, refresh events, and unique feed agent count
- Used in ecosystem health and chain activity pipelines

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXTERNAL_PRIVATE_KEY` | ✅ | — | 0x-prefixed 32-byte hex key |
| `SOMNIA_RPC_URL` | ❌ | `https://dream-rpc.somnia.network/` | Somnia RPC endpoint |
| `PORT` | ❌ | `3016` | HTTP server port |
| `AGENT_NAME` | ❌ | `reactivity-lens` | Registry name |
| `AGENT_COST_STT` | ❌ | `0.17` | Cost per execution |

## Planner payload

```json
{ "lookbackBlocks": 1000, "agentId": 1, "topic": "somnia.usd" }
```

Omit `agentId` + `topic` to scan recent events without per-feed staleness check.

## API

`POST /execute` — returns ECDSA-signed JSON with `{ type, source, lookbackBlocks, blocksScanned, feedsSampled, refreshEvents, findings }`.
