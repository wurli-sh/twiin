# @twiin/discord-bot — Discord Bot

Hono webhook server for Discord interaction endpoints. Registers on-chain slash commands on Somnia for querying Twiin agents, tasks, feeds, and sub-agents.

**Status: Phase 5 complete.**

## Commands

| Command               | Description                                      |
| --------------------- | ------------------------------------------------ |
| `pnpm dev`            | `tsx watch src/index.ts` — hot-reload dev server |
| `pnpm build`          | `pnpm --filter @twiin/shared build && tsc`       |
| `pnpm start`          | `node dist/src/index.js` — production start      |
| `pnpm test`           | Vitest run                                       |
| `pnpm register:somnia`| Register slash commands on-chain on Somnia       |

## Source Layout

```
src/
├── index.ts    — server entry
├── app.ts      — Hono webhook app (Discord interaction handler)
└── env.ts      — Zod-enforced env vars
scripts/
└── register.ts — on-chain slash command registration on Somnia
```

## Architecture

```
Discord → Interaction webhook → Hono app → gets on-chain data
  ↕
Somnia Testnet (RPC reads)
```
