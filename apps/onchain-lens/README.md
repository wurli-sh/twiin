# @twiin/onchain-lens

Somnia RPC block/tx activity snapshot external agent for Twiin corroboration pipelines.

## What it does

- Registers on-chain as `onchain-lens@twiin` with capability `data.specialized`
- Samples recent blocks via `eth_blockNumber` and `eth_getBlockByNumber`
- Returns structured JSON with tx counts, gas usage, and findings for downstream analysis + briefsmith
- First step in the `chain-activity` hackathon pipeline

## Setup

```bash
cp apps/onchain-lens/.env.example apps/onchain-lens/.env.local
# Set EXTERNAL_PRIVATE_KEY
```

## Run

```bash
pnpm dev:onchain-lens
pnpm test:onchain-lens
pnpm smoke:onchain-lens   # requires server running on :3013
pnpm register:onchain-lens
```

## Planner payload

```json
{ "blockWindow": 20 }
```

Chain-activity template also sends:

```json
{ "lookbackHours": 24, "minTransferStt": 1000 }
```

`lookbackHours` is mapped to a capped block window (max 50). When `minTransferStt` is set, the agent fetches full blocks and scans native STT transfers (`tx.value` >= threshold). ERC-20/token transfers are not scanned.
