# @twiin/dreamdex-mcp

dreamDEX / DeFi market-structure external agent for Twiin hackathon LP risk pipelines.

## What it does

- Registers on-chain with capability `data.specialized`
- Fetches pair liquidity, volume, and price context for dreamDEX / SOMI pairs
- Optionally calls a dreamDEX MCP endpoint when `DREAMDEX_MCP_URL` is set
- Falls back to DexScreener with Somnia/dreamDEX pair preference for demo-safe operation
- Returns structured JSON with LP risk hints for downstream `analysis-bot` and `briefsmith`

## Setup

1. Copy env template:

```bash
cp apps/dreamdex-mcp/.env.example apps/dreamdex-mcp/.env
```

2. Set `EXTERNAL_PRIVATE_KEY` to the EOA that will register and sign execute results.

3. Optional: set `DREAMDEX_MCP_URL` to a dreamDEX MCP HTTP endpoint. If unset or unavailable, DexScreener is used automatically.

## Run locally

```bash
pnpm dev:dreamdex-mcp
```

Health check: `GET http://127.0.0.1:3012/health`

## Register on Somnia testnet

Ensure the agent is reachable at `EXTERNAL_PUBLIC_URL` (public HTTPS for on-chain relay), then:

```bash
pnpm register:dreamdex-mcp
```

## Planner payload

LP risk template sends:

```json
{ "action": "orderbook", "pair": "SOMI/USDC" }
```

- `action` — `orderbook` | `pairs` | `snapshot` (default `snapshot`)
- `pair` — trading pair or symbol query (default `SOMI`)

## Response format

Success (DexScreener fallback):

```json
{
  "type": "dreamdex-mcp",
  "agentName": "dreamdex-mcp@twiin",
  "source": "dexscreener",
  "action": "orderbook",
  "pair": "SOMI/USDC",
  "topPair": {
    "symbol": "SOMI",
    "priceUsd": "0.42",
    "liquidityUsd": 89100,
    "volume24h": 12300,
    "change24h": -2.1,
    "dex": "dreamdex",
    "chain": "somnia"
  },
  "lpRiskHints": ["Liquidity above $50K — moderate depth for typical LP sizes"],
  "findings": ["SOMI ~$0.42 on dreamdex (somnia)", "24h volume $12.3K · liquidity $89.1K"],
  "ts": "2026-06-07T12:00:00.000Z"
}
```

On upstream failure, returns `type: "external-error"` with `{ action, pair, partial: true }`.

## Tests

```bash
pnpm test:dreamdex-mcp
```
