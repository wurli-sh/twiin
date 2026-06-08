# @twiin/agent-adapter — Generic HTTP Proxy Adapter

Reference HTTP adapter for external agent runtimes (Cursor SDK, MCP servers, custom backends). Registered on-chain as `agent-adapter@twiin` with capability `data.specialized`.

**ConfigId:** 12 (external), **Port:** 8790, **Cost:** 0.20 STT

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

- Implements the Twiin ExternalHTTP contract via `@twiin/external-kit`
- Optionally proxies prompts to `UPSTREAM_URL` (any service accepting `{ taskId, stepIdx, prompt }` and returning `{ result }`)
- Without `UPSTREAM_URL`, returns a signed stub response for local testing

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXTERNAL_PRIVATE_KEY` | ✅ | — | 0x-prefixed 32-byte hex key |
| `UPSTREAM_URL` | ❌ | — | Upstream proxy endpoint |
| `PORT` | ❌ | `8790` | HTTP server port |
| `AGENT_NAME` | ❌ | `agent-adapter` | Registry name |
| `AGENT_COST_STT` | ❌ | `0.20` | Cost per execution |

## Upstream API

Upstream must accept:
```json
{ "taskId": "1", "stepIdx": 0, "prompt": "..." }
```

And return:
```json
{ "result": "text result" }
```

## API

`POST /execute` — proxies to upstream or returns stub. Returns ECDSA-signed JSON with `{ type, source, result }`.
