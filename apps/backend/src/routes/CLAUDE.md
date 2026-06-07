# @twiin/backend/src/routes/ — HTTP Route Handlers

All routes use a DI factory pattern (`createXRouter(deps)`) for testability. Mounted in `src/app.ts`.

## Route Index

| File | Endpoint | Method | Role |
|------|----------|--------|------|
| `plan.ts` | `/api/plan` | POST | User goal → Claude Haiku → `createTask` calldata; rate-limited (10 req/min/IP), optional `x-plan-secret` auth |
| `trustless-preflight.ts` | `/api/trustless/preflight` | POST | Validates trustless plan calldata before on-chain submission |
| `tasks.ts` | `/api/tasks/:taskId` | GET | Reads on-chain task state from `AgentOrchestrator.tasks()` |
| `tasks.ts` | `/api/tasks/:taskId/steps` | GET | Returns indexed steps from SQLite |
| `stream.ts` | `/api/stream/:taskId` | GET | SSE stream for real-time task execution updates; supports `Last-Event-ID` reconnection |
| `agents.ts` | `/api/agents` | GET | Lists registered external agents from AgentRegistry; optional `?verified=true` filter |

## DI Pattern

```ts
// Each router module exports a factory:
export function createXRouter(deps: XRouterDeps): Hono

// Deps interface provides overridable functions for testability:
interface PlanRouterDeps {
  anthropic?: Anthropic
  env: { PLAN_SECRET?: string }
  // ...
}
```

## Conventions

- `bigintToStr` JSON serializer on `tasks.ts` to safely handle BigInt serialization
- Zod validation on request bodies (plan.ts) and params (stream.ts)
- SSE stream uses `makeSseStream` from `src/sse.ts` with heartbeat
