# @twiin/backend — Hono Backend Server

Hono server targeting **Somnia Testnet** (chainId 50312). Claude API planner, keeper bots, SSE streaming, SQLite via Drizzle ORM. Consumed by `apps/frontend`.

**Status: Phase 3 complete — deployed alongside contracts; Phase 5 external agents integrated; Phase 6 TrustlessJanice integrated.**

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
├── errors.ts         — typed error classes (UpstreamAvailabilityError)
├── task-log.ts       — structured task timeline logging
├── task-completion.ts — task completion helpers (transcript, result formatting)
├── trustless.ts      — TrustlessJanice planner logic
├── planner-json.ts   — JSON planner utilities
├── keeper-writes.ts  — enqueues keeper writes serially with nonce collision retry
├── routes/            — see src/routes/CLAUDE.md
│   ├── plan.ts       — POST /api/plan — user goal → Claude Haiku → createTask calldata
│   ├── tasks.ts      — GET /api/tasks/:taskId, GET /api/tasks/:taskId/steps
│   ├── stream.ts     — GET /api/stream/:taskId — SSE real-time updates
│   ├── agents.ts     — GET /api/agents — list registered external agents
│   └── trustless-preflight.ts — POST /api/trustless/preflight — validate trustless plan
└── keepers/           — see src/keepers/CLAUDE.md
    ├── indexer.ts    — polls events → SQLite + SSE; indexes external agent lifecycle (4s interval)
    ├── relay.ts      — routes assigned steps to Claude Sonnet (native) or HTTP POST (external) (4s interval)
    ├── rater.ts      — rates completed steps via Claude Haiku → rateStep on-chain (6s interval)
    ├── externals.ts      — watches ExternalAgentRequest → dispatches HTTP to registered endpoints
    ├── timeouts.ts       — watches pending external steps → submits on-chain timeout at deadline
    ├── trustless-resume.ts — resumes stalled trustless tasks (6s interval)
    └── rater-scoring.ts  — rating prompt builder, deterministic score floors, result extraction
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

See `src/keepers/CLAUDE.md` for full details.

| Keeper    | File           | Poll  | Trigger / Watch                                          | Action                                                      |
| --------- | -------------- | ----- | -------------------------------------------------------- | ----------------------------------------------------------- |
| Indexer   | `indexer.ts`   | 4s    | 10+ event types (TaskCreated, StepStateChanged, etc.)    | Upserts to SQLite, publishes SSE updates                    |
| Relay     | `relay.ts`     | 4s    | `ExternalAgentRequest`                                   | HTTP POST (external) or Claude Sonnet (native); submits ECDSA result on-chain |
| Rater     | `rater.ts`     | 6s    | `ExternalResultPending`                                  | Rates via Claude Haiku; submits `rateStep` if score ≥ 40    |
| Externals | `externals.ts` | 4s    | `ExternalAgentRegistered` / `EndpointUpdated` / `Deregistered` | Syncs external agent metadata into SQLite cache       |
| Timeouts  | `timeouts.ts`  | 5s    | Pending steps past deadline (RunningExternal, AwaitingRating, RunningNative) | Calls on-chain timeout fns (`timeoutExternalStep`, `timeoutRating`, `timeoutNativeStep`, `timeoutTask`) |
| Trustless Resume | `trustless-resume.ts` | 6s | Stalled trustless tasks (TrustlessAwaiting)     | Resubmits janice requests for tasks past deadline          |

## Routes

See `src/routes/CLAUDE.md` for full details.

| Route | File | Endpoint | Method | Role |
|-------|------|----------|--------|------|
| Plan | `plan.ts` | `/api/plan` | POST | Claude Haiku planner → `createTask` calldata; rate-limited, optional auth |
| Trustless Preflight | `trustless-preflight.ts` | `/api/trustless/preflight` | POST | Validates trustless plan before on-chain submission |
| Tasks | `tasks.ts` | `/api/tasks/:taskId` | GET | On-chain task state from `AgentOrchestrator.tasks()` |
| Steps | `tasks.ts` | `/api/tasks/:taskId/steps` | GET | Indexed steps from SQLite |
| Stream | `stream.ts` | `/api/stream/:taskId` | GET | SSE real-time updates with `Last-Event-ID` reconnection |
| Agents | `agents.ts` | `/api/agents` | GET | Registered external agents; optional `?verified=true` filter |

## Architecture

```
User → POST /api/plan { goal, personalAgentId, budgetWei }
  → Claude Haiku plans steps → returns createTask calldata
  → User signs via 6551 account → tx to AgentOrchestrator.createTask()
  → Relay keeper picks up StepUpdated(Assigned) → dispatches step
  → Rater keeper picks up StepUpdated(Completed) → rates → releases payment
  → Indexer keeps SSE streams updated for frontend
  → Timeouts keeper catches any stalled steps past deadline
```
