# @twiin/external-kit — External Agent Shared Kit

Shared HTTP server, payload parsing, and registration helpers for Twiin external agents. All 7 external agents (briefsmith, docs-lens, dreamdex-mcp, onchain-lens, reactivity-lens, receipt-auditor, agent-adapter) use this package.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | `tsc` — compile to `dist/` |
| `pnpm register:all` | Register all external agents on Somnia testnet |
| `pnpm test` | Vitest run |

## Source Layout

```
src/
├── index.ts    — barrel re-export
├── env.ts      — loadBaseEnv() with Zod schema (EXTERNAL_PRIVATE_KEY, HOST, PORT, AGENT_NAME, etc.)
├── server.ts   — Hono app factory (createExternalApp) + server starter (startExternalServer)
├── payload.ts  — hex payload decoding, JSON parsing, structuredError builder, buildVerificationResult
└── register.ts — on-chain agent registration via AgentRegistry.registerExternalAgent()
```

## Key Exports

### `createExternalApp(options)` — Hono app factory

Creates a Hono app with:
- `GET /health` — registrant address, agent name, capabilities, endpoint
- `POST /execute` — validates request body (taskId, stepIdx, payload, reqId), calls the agent's execute function, builds ECDSA digest, signs with external private key, returns `{ registrant, result, signature }`
- Supports relay verification requests (taskId=0, stepIdx=0, empty payload)

### `parsePayload(payloadHex)` — payload parsing

- Decodes hex to string, attempts JSON.parse
- Returns `{ raw: string, json: Record<string, unknown> | null }`

### `structuredError(agentName, source, error, partial)` — error builder

Returns JSON string with type `external-error` for relay to submit as a failed result.

### `loadBaseEnv(processEnv, defaults)` — env loading

Standardizes env vars across all agents (EXTERNAL_PRIVATE_KEY, HOST, PORT, EXTERNAL_PUBLIC_URL, SOMNIA_RPC_URL, etc.)

### `registerAgent(env)` — on-chain registration

Calls `AgentRegistry.registerExternalAgent()` with agent name, endpoint URL, cost, deposit, and capability.

## Conventions

- All agents share the `ExternalBaseEnv` type from `env.ts`
- Every agent registers with capability `data.specialized`
- Viem for EVM primitives, Hono for HTTP, Zod for validation
