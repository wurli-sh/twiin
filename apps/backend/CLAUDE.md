# @twiin/backend — Hono Backend Server

Hono server targeting **Somnia Testnet** (chainId 50312). Claude API planner, keeper bots, SSE streaming, SQLite via Drizzle ORM. Consumed by `apps/frontend`.

**Status: Phase 3 complete — deployed alongside contracts.**

## Commands

| Command           | Description                                         |
| ----------------- | --------------------------------------------------- |
| `pnpm dev`        | `tsx watch src/index.ts` — hot-reload dev server    |
| `pnpm build`      | `tsc` — compile to `dist/`                          |
| `pnpm start`      | `node dist/index.js` — production start             |
| `pnpm test`       | Vitest run                                          |
| `pnpm db:push`    | Drizzle Kit push — sync schema to SQLite            |
| `pnpm db:studio`  | Drizzle Kit studio — browse DB                     |

## Source Layout

```
src/
├── index.ts          — server entry; mounts routes, starts keepers
├── app.ts            — Hono app factory with DI (routes, CORS, error handler)
├── clients.ts        — viem public/wallet clients for Somnia Testnet
├── contracts.ts      — getContract instances + deployment manifest + boot block
├── db.ts             — Turso/Drizzle SQLite client + query helpers
├── schema.ts         — Drizzle schema: keeperCursors, tasks, steps, planRequests, submittedResults, submittedRatings
├── env.ts            — Zod-enforced env vars (KEEPER_PRIVATE_KEY, ANTHROPIC_API_KEY, SOMNIA_RPC_URL, TURSO_DB_URL, etc.)
├── sse.ts            — SSE pub/sub: subscribe(), publish(), publishAll(), makeSseStream(), heartbeat
├── budget.ts         — shared budget validation logic
├── routes/
│   ├── plan.ts       — POST /api/plan — user goal → Claude Haiku → createTask calldata
│   ├── tasks.ts      — GET /api/tasks/:taskId, GET /api/tasks/:taskId/steps
│   ├── stream.ts     — GET /api/stream/:taskId — SSE real-time updates
│   └── agents.ts     — GET /api/agents — list registered external agents
└── keepers/
    ├── indexer.ts    — polls events → SQLite + SSE; indexes external agent lifecycle (4s interval)
    ├── relay.ts      — routes assigned steps to Claude Sonnet (native) or HTTP POST (external) (4s interval)
    ├── rater.ts      — rates completed steps via Claude Haiku → rateStep on-chain (6s interval)
    ├── externals.ts  — monitors ExternalAgentRequest → dispatches HTTP to registered endpoints
    └── timeouts.ts   — monitors pending external steps → submits on-chain timeout at deadline
```

## Environment Variables (.env)

| Variable             | Required | Default                                    | Description                        |
| -------------------- | -------- | ------------------------------------------ | ---------------------------------- |
| `KEEPER_PRIVATE_KEY` | ✅       | —                                          | 0x-prefixed 32-byte hex keeper key |
| `ANTHROPIC_API_KEY`  | ✅       | —                                          | Claude API key                     |
| `SOMNIA_RPC_URL`     | ❌       | `https://dream-rpc.somnia.network/`        | Somnia RPC endpoint                |
| `PORT`               | ❌       | `3001`                                     | HTTP server port                   |
| `TURSO_DB_URL`       | ❌       | `file:./twiin.db`                          | SQLite DB (local or libsql://)     |
| `TURSO_AUTH_TOKEN`   | ❌       | `""`                                       | Required for remote Turso DB       |
| `START_BLOCK`        | ❌       | `0`                                        | Indexer start block                |
| `PLAN_SECRET`        | ❌       | —                                          | Shared secret for POST /api/plan   |
| `TRUST_PROXY`        | ❌       | `false`                                    | Trust X-Forwarded-For for rate lim |
| `RUN_KEEPERS`        | ❌       | `true`                                     | Enable keeper background loops     |

## Keeper Details

| Keeper    | File           | Poll  | Trigger                           | Action                                                      |
| --------- | -------------- | ----- | --------------------------------- | ----------------------------------------------------------- |
| Indexer   | `indexer.ts`   | 4s    | New block                         | Fetches events (task + external agent), upserts to SQLite, publishes SSE updates |
| Relay     | `relay.ts`     | 4s    | `StepUpdated(Assigned)`           | Routes to Claude Sonnet (native) or HTTP POST (external); submits ECDSA result on-chain |
| Rater     | `rater.ts`     | 6s    | `StepUpdated(Completed)`          | Rates via Claude Haiku; submits `rateStep` if score ≥ 40    |
| Externals | `externals.ts` | 4s    | `ExternalAgentRequest`            | Sends HTTP POST to registered external agent endpoints       |
| Timeouts  | `timeouts.ts`  | 6s    | `ExternalResultPending` (expired) | Calls `timeoutExternalStep` on-chain at deadline             |

## Architecture

```
User → POST /api/plan { goal, personalAgentId, budgetWei }
  → Claude Haiku plans steps → returns createTask calldata
  → User signs via 6551 account → tx to AgentOrchestrator.createTask()
  → Relay keeper picks up StepUpdated(Assigned) → dispatches step
  → Rater keeper picks up StepUpdated(Completed) → rates → releases payment
  → Indexer keeps SSE streams updated for frontend
```
