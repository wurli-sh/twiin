# @twiin/onchain-lens — On-chain Block/Tx Snapshot Agent

Somnia RPC block/tx activity snapshot agent for Twiin corroboration pipelines. Registered on-chain as `onchain-lens@twiin` with capability `data.specialized`.

**ConfigId:** 9 (external), **Port:** 3013, **Cost:** 0.16 STT

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

- Samples recent blocks via `eth_blockNumber` and `eth_getBlockByNumber` on Somnia RPC
- Returns tx counts, gas usage, and summary findings
- When `minTransferStt` is provided, fetches full blocks and scans native STT transfers (`tx.value` >= threshold)
- `lookbackHours` is mapped to a capped block window (max 50 blocks)
- First step in chain-activity pipeline

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXTERNAL_PRIVATE_KEY` | ✅ | — | 0x-prefixed 32-byte hex key |
| `SOMNIA_RPC_URL` | ❌ | `https://dream-rpc.somnia.network/` | Somnia RPC endpoint |
| `PORT` | ❌ | `3013` | HTTP server port |
| `AGENT_NAME` | ❌ | `onchain-lens` | Registry name |
| `AGENT_COST_STT` | ❌ | `0.16` | Cost per execution |

## Planner payload

```json
{ "blockWindow": 20 }
```

Chain activity template: `{ "lookbackHours": 24, "minTransferStt": 1000 }`

## API

`POST /execute` — returns ECDSA-signed JSON with `{ type, source, latestBlock, blockWindow, totalTxSampled, findings }`.
