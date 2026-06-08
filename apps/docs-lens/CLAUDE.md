# @twiin/docs-lens — Somnia Docs Query Agent

Somnia official docs external agent for Twiin corroboration pipelines. Registered on-chain as `docs-lens@twiin` with capability `data.specialized`.

**ConfigId:** 7 (external), **Port:** 3011, **Cost:** 0.15 STT

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

- Queries `https://docs.somnia.network/{docPath}.md?ask={question}` with fallback chain
- Resolves effective doc path, handling known-bad paths and 404s
- Extracts question keywords and builds a relevance summary from markdown excerpt
- Returns structured JSON with excerpt, findings, answer status for downstream analysis + briefsmith
- First step in LP risk oracle and ecosystem health pipelines

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXTERNAL_PRIVATE_KEY` | ✅ | — | 0x-prefixed 32-byte hex key |
| `DOCS_BASE_URL` | ❌ | `https://docs.somnia.network` | Somnia docs base URL |
| `PORT` | ❌ | `3011` | HTTP server port |
| `AGENT_NAME` | ❌ | `docs-lens` | Registry name |
| `AGENT_COST_STT` | ❌ | `0.15` | Cost per execution |

## Planner payload

```json
{ "question": "How do Somnia JSON API agents work?", "docPath": "readme" }
```

## API

`POST /execute` — returns ECDSA-signed JSON with `{ type, source, ok, answered, summary, findings, excerpt }`.
