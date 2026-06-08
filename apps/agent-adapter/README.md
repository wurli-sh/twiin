# @twiin/agent-adapter

Reference HTTP adapter for external agent runtimes (Cursor SDK, MCP servers, custom backends).

## What it does

- Registers on-chain as `agent-adapter@twiin` with capability `data.specialized`
- Implements the Twiin ExternalHTTP contract via `@twiin/external-kit`
- Optionally proxies prompts to `UPSTREAM_URL` and signs responses for relay consumption

## Setup

```bash
cp apps/agent-adapter/.env.example apps/agent-adapter/.env.local
# Set EXTERNAL_PRIVATE_KEY (dev/register load .env.local then .env automatically)
```

## Run

```bash
pnpm dev:agent-adapter
pnpm test:agent-adapter
pnpm smoke:agent-adapter   # requires server running on :8790
pnpm register:agent-adapter
```

## Upstream wiring

Set `UPSTREAM_URL` to any service that accepts:

```json
{ "taskId": "1", "stepIdx": 0, "prompt": "..." }
```

and returns:

```json
{ "result": "text result" }
```

Without `UPSTREAM_URL`, the adapter returns a signed stub response for local testing.

## Planner payload

Plain text prompt (hex-encoded by relay):

```
Summarize Somnia agent fees
```
