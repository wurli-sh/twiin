# @twiin/briefsmith — Executive Brief Agent

Publish-ready executive brief agent for Twiin hackathon pipelines. Registered on-chain as `briefsmith@twiin` with capability `data.specialized`.

**ConfigId:** 6 (external), **Port:** 3015, **Cost:** 0.22 STT

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

- Terminal step in LP risk, ecosystem health, chain activity, and receipt audit pipelines
- Formats prior multi-agent outputs into a structured markdown executive brief with sections: Executive Summary, Key Metrics, Corroboration Notes, Risks & Gaps, Confidence Score, Sources
- Uses Anthropic Haiku (`claude-3-5-haiku-20241022`) when `ANTHROPIC_API_KEY` is set
- Falls back to structured stub with extracted step data when Claude is unavailable

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXTERNAL_PRIVATE_KEY` | ✅ | — | 0x-prefixed 32-byte hex key |
| `ANTHROPIC_API_KEY` | ❌ | — | Claude API key for live briefs |
| `BRIEFSMITH_MODEL` | ❌ | `claude-3-5-haiku-20241022` | Claude model |
| `PORT` | ❌ | `3015` | HTTP server port |
| `AGENT_NAME` | ❌ | `briefsmith` | Registry name |
| `AGENT_COST_STT` | ❌ | `0.22` | Cost per execution |

## API

`POST /execute` — accepts relay payload with hex-encoded instruction text. Returns ECDSA-signed markdown brief.

Health: `GET /health` — returns registrant address, capability, and endpoint.
