# @twiin/dreamdex-mcp — Market/Dex Data Agent

dreamDEX / DeFi market-structure external agent for Twiin LP risk pipelines. Registered on-chain as `dreamdex-mcp@twiin` with capability `data.specialized`.

**ConfigId:** 8 (external), **Port:** 3012, **Cost:** 0.20 STT

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

- Fetches pair liquidity, volume, and price context for dreamDEX / SOMI pairs
- Supports actions: `snapshot` (default), `orderbook`, `pairs`, `coingecko`
- Optionally calls a dreamDEX MCP endpoint when `DREAMDEX_MCP_URL` is set
- Falls back to DexScreener API with Somnia/dreamDEX pair preference
- Returns structured JSON with top pair summary, LP risk hints, and findings
- Core step in LP risk oracle pipeline

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXTERNAL_PRIVATE_KEY` | ✅ | — | 0x-prefixed 32-byte hex key |
| `DREAMDEX_MCP_URL` | ❌ | — | dreamDEX MCP HTTP endpoint |
| `PORT` | ❌ | `3012` | HTTP server port |
| `AGENT_NAME` | ❌ | `dreamdex-mcp` | Registry name |
| `AGENT_COST_STT` | ❌ | `0.20` | Cost per execution |

## Planner payload

```json
{ "action": "orderbook", "pair": "SOMI/USDC" }
```

## API

`POST /execute` — returns ECDSA-signed JSON with `{ type, source, action, pair, topPair, lpRiskHints, findings }`.
