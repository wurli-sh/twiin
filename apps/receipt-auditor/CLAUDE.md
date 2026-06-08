# @twiin/receipt-auditor — Receipt Forensics Agent

Somnia agent receipt forensics external agent for Twiin audit pipelines. Registered on-chain as `receipt-auditor@twiin` with capability `data.specialized`.

**ConfigId:** 11 (external), **Port:** 3014, **Cost:** 0.14 STT

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

- Fetches agent execution receipts from `https://receipts.testnet.agents.somnia.host`
- Accepts lookup by `requestId`, `receiptId`, `taskId`, or defaults to `latest`
- Summarizes verification status and step trail count
- Returns structured JSON with receipt payload summary, verification status, and findings
- First step in receipt-audit pipeline

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXTERNAL_PRIVATE_KEY` | ✅ | — | 0x-prefixed 32-byte hex key |
| `RECEIPTS_BASE_URL` | ❌ | `https://receipts.testnet.agents.somnia.host` | Receipts API base URL |
| `PORT` | ❌ | `3014` | HTTP server port |
| `AGENT_NAME` | ❌ | `receipt-auditor` | Registry name |
| `AGENT_COST_STT` | ❌ | `0.14` | Cost per execution |

## Planner payload

```json
{ "receiptId": "latest" }
```

Also accepts `requestId` or `taskId` as the lookup key.

## API

`POST /execute` — returns ECDSA-signed JSON with `{ type, source, requestId, ok, summary, receipt, findings }`.
