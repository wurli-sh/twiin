# @twiin/receipt-auditor

Somnia agent receipt forensics external agent for Twiin audit pipelines.

## What it does

- Registers on-chain as `receipt-auditor@twiin` with capability `data.specialized`
- Fetches receipts from `https://receipts.testnet.agents.somnia.host`
- Summarizes verification status and step trail for downstream analysis + briefsmith
- First step in the `receipt-audit` hackathon pipeline

## Setup

```bash
cp apps/receipt-auditor/.env.example apps/receipt-auditor/.env.local
# Set EXTERNAL_PRIVATE_KEY
```

## Run

```bash
pnpm dev:receipt-auditor
pnpm test:receipt-auditor
pnpm smoke:receipt-auditor   # requires server running on :3014
pnpm register:receipt-auditor
```

## Planner payload

```json
{ "receiptId": "latest" }
```

Also accepts `requestId` or `taskId` as the lookup key.
