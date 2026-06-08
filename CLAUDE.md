# Twiin — Agentic AI × Crypto on Somnia

**Pitch:** Mint a named, tradeable AI agent on Somnia — an NFT with its own ERC-6551 wallet — that autonomously hires the best available specialist sub-agents from an open marketplace, pays them per step from a policy-guarded escrow, publishes consensus-verified oracle feeds any contract can consume, and never touches a cent more than you allowed — all triggered by on-chain events with no user-operated server.

Somnia Agentathon (Encode Club, May 18 – Jun 11 2026). Somnia Testnet chainId `50312`, native token STT.

## Phase Status

| Phase               | Status      | Notes                                                    |
| ------------------- | ----------- | -------------------------------------------------------- |
| 1 — Contracts       | ✅ Complete | 94+ tests passing; lib/ extracted, consensus receipts    |
| 2 — Shared package  | ✅ Complete | 22+ vitest tests; ABIs, constants, digest, 6551 helper, plan templates |
| 3 — Backend         | ✅ Complete | Hono, Claude planner, keepers (5), SSE, SQLite, keeper-writes serialization |
| 4 — Frontend        | ✅ Complete | React/Vite/wagmi, deploy flow, task console, feeds       |
| 5 — External Agents | ✅ Complete | 7 agents (briefsmith, docs-lens, dreamdex-mcp, onchain-lens, reactivity-lens, receipt-auditor, agent-adapter) |

## Commands

| Command              | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `pnpm build`         | builds all packages with `pnpm -r run build`                 |
| `pnpm test`          | runs `@twiin/contracts` tests (Hardhat)                      |
| `pnpm test:shared`   | runs `@twiin/shared` tests (vitest)                          |
| `pnpm test:backend`  | runs `@twiin/backend` tests (vitest)                         |
| `pnpm test:frontend` | runs `@twiin/frontend` tests (vitest)                       |
| `pnpm test:all`      | runs contracts + shared + backend tests                      |
| `pnpm compile`       | compiles `@twiin/contracts` (Hardhat)                        |
| `pnpm deploy:local`  | deploy contracts to local Hardhat node                       |
| `pnpm deploy:somnia` | deploy contracts to Somnia Testnet                           |
| `pnpm dev:backend`   | `pnpm --filter @twiin/backend dev` (from `apps/backend/`)    |
| `pnpm dev:frontend`  | `pnpm --filter @twiin/frontend dev` (from `apps/frontend/`)  |
| `pnpm dev:all`       | concurrently runs backend + frontend dev servers             |
| `pnpm start:backend` | `pnpm --filter @twiin/backend start` (from `apps/backend/`)  |

## Structure

```
twiin/
├── packages/
│   ├── contracts/     — Solidity smart contracts (Hardhat, Solidity 0.8.30) ✅
│   ├── shared/        — TypeScript shared lib (ABIs, types, constants, helpers) ✅
│   └── external-kit/  — Shared HTTP server, payload parsing, registration helpers ✅
├── apps/
│   ├── backend/       — Hono server, Claude planner, keepers, SSE, SQLite ✅
│   ├── frontend/      — React/Vite/wagmi ✅
│   ├── briefsmith/    — Executive brief agent (Anthropic Haiku) ✅
│   ├── docs-lens/     — Somnia docs query agent ✅
│   ├── dreamdex-mcp/  — Market/dex data agent (DexScreener, CoinGecko) ✅
│   ├── onchain-lens/  — On-chain block/tx snapshot agent ✅
│   ├── reactivity-lens/ — OracleFeed/reactivity event scanner ✅
│   ├── receipt-auditor/ — Somnia agent receipt forensics agent ✅
│   └── agent-adapter/ — Generic HTTP proxy for upstream runtimes ✅
├── .agents/         — Agent skill definitions (empty, for future use)
├── .codex/          — Codex metadata (empty, for future use)
├── build-context.md — Compact project context for agent sessions
├── pnpm-workspace.yaml
└── CLAUDE.md (this file)
```

## Core Folders & Subdirectories

### `packages/contracts/` — Solidity Smart Contracts

| Path | Purpose |
|------|---------|
| `src/` | All `.sol` source files (11 contracts + interfaces + mocks) |
| `src/interfaces/` | `IAgentRequesterHandler.sol`, `IERC6551Account.sol`, `IERC6551Registry.sol`, `ITwiin.sol` |
| `src/mocks/` | `ERC6551Registry.sol`, `MockAgentsApi.sol`, `MockERC20.sol`, `MockUniswapV2Router02.sol` |
| `test/` | 11 test files: `Account.test.ts`, `Factory.test.ts`, `Names.test.ts`, `OrchestratorTask.test.ts`, `OrchestratorExternal.test.ts`, `Policy.test.ts`, `Registry.test.ts`, `Vault.test.ts`, `Invariant.test.ts`, `Soak.test.ts`, `helpers.ts` |
| `scripts/` | `deploy.ts` (local + Somnia deploy), `soak.ts` (soak test runner) |
| `deployments/` | `hardhat.json` + `somniaTestnet.json` (deployed addresses per network) |
| `artifacts/` | Hardhat compilation output |
| `cache/` | Hardhat cache |
| `typechain-types/` | TypeChain generated TS types |

### `packages/shared/` — TypeScript Shared Library

| Path | Purpose |
|------|---------|
| `abis/` | 9 contract ABIs as `.json` + barrel `index.ts` re-export |
| `deployments/` | Mirrored `hardhat.json` + `somniaTestnet.json` |
| `scripts/` | `copy-abis.ts` — copies ABIs from contracts build |
| `test/` | `parity.test.ts` — 22 vitest parity tests |
| Top-level files | `index.ts` (barrel), `constants.ts`, `digest.ts`, `twiin-account.ts`, `consensus.ts`, `addresses.json` |

### `apps/backend/` — Hono Backend Server

| Path | Purpose |
|------|---------|
| `src/` | All backend source |
| `src/routes/` | `plan.ts` (Claude planning), `stream.ts` (SSE), `tasks.ts` (task CRUD), `agents.ts` (agent listing) |
| `src/keepers/` | `relay.ts` (task relay keeper), `rater.ts` (Claude Haiku rating keeper), `indexer.ts` (event indexer), `externals.ts` (external agent dispatcher), `timeouts.ts` (step timeout handler) |
| Top-level `src/` files | `index.ts` (entry), `app.ts` (app factory), `clients.ts` (viem clients), `contracts.ts` (contract instances), `db.ts` (SQLite/Drizzle), `schema.ts` (DB schema), `sse.ts` (SSE helpers), `env.ts` (env vars), `budget.ts` (budget validation), `errors.ts` (error types), `task-log.ts` (structured logging), `task-completion.ts` (task completion helpers), `keeper-writes.ts` (keeper write serialization), `planner-json.ts` (JSON planner) |
| Config | `drizzle.config.ts`, `tsconfig.json`, `.env.example` |

### `apps/frontend/` — React/Vite Frontend

| Path | Purpose |
|------|---------|
| `src/pages/` | 4 pages: `HomePage`, `AgentsPage`, `ConsolePage`, `MarketplacePage` |
| `src/components/home/` | `Hero`, `GatewayBento`, `HeroConsolePreview`, `HowItWorks`, `Ecosystem`, `DeploymentCTA`, `CinematicFooter` |
| `src/components/agents/` | `DeployAgentPanel`, `AgentList`, `AgentTable`, `AgentStatusLabel`, `AgentKillSwitchControl`, `AddAgentPanel`, `ExternalAgentPanel`, `PolicyPanel`, `TaskActivity` |
| `src/components/console/` | `AgentSelector`, `AgentStatusLine`, `PlanApproval`, `PlanStepList`, `PlanBudgetRecovery`, `CommandBar`, `SuggestedPrompts`, `BudgetWarningsBar`, `TaskResultCard`, `TranscriptPanel`, `ConsoleTopBar`, `ExecutionPanel`, `ExecutionPanelOverlay`, `ExecutionSidebar`, `ConsensusBadge`, `ReportPendingCard`, `ExecutionModeToggle` |
| `src/components/marketplace/` | `SubAgentTable`, `SubAgentRow` |
| `src/components/layout/` | `Navbar`, `MainLayout`, `NetworkBanner` |
| `src/components/spell/` | Animated paper/shader components: `animated-checkbox`, `blur-reveal`, `highlighted-text`, `light-rays`, `logos-carousel`, `tilt-card` |
| `src/components/ui/` | `Button`, `Badge`, `Tabs`, `ConfirmDialog`, `TextLoop`, `TextShimmer`, `ThinkingSpinner`, `TwiinAvatar` |
| `src/hooks/` | 11 hooks: `useWallet`, `useTwiinAgents`, `useSubAgents`, `useTaskStream`, `useTaskDetail`, `useAgentTasks`, `useCreateTask`, `useAgentPolicy`, `useRotatingPhrase`, `usePageReady`, `useNetworkGuard` |
| `src/config/` | `wagmi.ts`, `chains.ts`, `contracts.ts` |
| `src/lib/` | `cn.ts`, `utils.ts`, `animations.ts`, `agent-name.ts`, `agent-budget.ts`, `agent-status-copy.ts`, `config-names.ts`, `console-session.ts`, `feed-topics.ts`, `format-time.ts`, `plan-api.ts`, `plan-step-display.ts`, `preflight-create-task.ts`, `read-contract.ts`, `report-display.ts`, `sentiment-oracle-display.ts`, `sub-agent-status.ts`, `task-result-display.ts`, `task-state.ts` |
| `src/stores/` | `ui.ts` — zustand UI state |
| Config | `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `components.json`, `index.html` |

### `apps/briefsmith/` — Executive Brief Agent

| Path | Purpose |
|------|---------|
| `src/` | `index.ts` (entry), `env.ts` (env vars), `handler.ts` (Anthropic Haiku + fallback) |
| `scripts/` | `register.ts` — on-chain registration on Somnia |
| `test/` | Agent test suite |
| Config | `tsconfig.json`, `vitest.config.ts`, `.env.example` |

### `apps/docs-lens/` — Somnia Docs Query Agent

| Path | Purpose |
|------|---------|
| `src/` | `index.ts` (entry), `env.ts` (env vars), `handler.ts` (docs.somnia.network fetcher) |
| `scripts/` | `register.ts` — on-chain registration on Somnia |
| `test/` | Agent test suite |
| Config | `tsconfig.json`, `vitest.config.ts`, `.env.example` |

### `apps/dreamdex-mcp/` — Market/Dex Data Agent

| Path | Purpose |
|------|---------|
| `src/` | `index.ts` (entry), `env.ts` (env vars), `handler.ts` (DexScreener + CoinGecko + MCP) |
| `scripts/` | `register.ts` — on-chain registration on Somnia |
| `test/` | Agent test suite |
| Config | `tsconfig.json`, `vitest.config.ts`, `.env.example` |

### `apps/onchain-lens/` — On-chain Block/Tx Snapshot Agent

| Path | Purpose |
|------|---------|
| `src/` | `index.ts` (entry), `env.ts` (env vars), `handler.ts` (eth_blockNumber + eth_getBlockByNumber) |
| `scripts/` | `register.ts` — on-chain registration on Somnia |
| `test/` | Agent test suite |
| Config | `tsconfig.json`, `vitest.config.ts`, `.env.example` |

### `apps/reactivity-lens/` — OracleFeed/Reactivity Event Scanner

| Path | Purpose |
|------|---------|
| `src/` | `index.ts` (entry), `env.ts` (env vars), `handler.ts` (eth_getLogs + eth_call on OracleFeed) |
| `scripts/` | `register.ts` — on-chain registration on Somnia |
| `test/` | Agent test suite |
| Config | `tsconfig.json`, `vitest.config.ts`, `.env.example` |

### `apps/receipt-auditor/` — Receipt Forensics Agent

| Path | Purpose |
|------|---------|
| `src/` | `index.ts` (entry), `env.ts` (env vars), `handler.ts` (receipts.testnet.agents.somnia.host fetcher) |
| `scripts/` | `register.ts` — on-chain registration on Somnia |
| `test/` | Agent test suite |
| Config | `tsconfig.json`, `vitest.config.ts`, `.env.example` |

### `apps/agent-adapter/` — Generic HTTP Proxy Adapter

| Path | Purpose |
|------|---------|
| `src/` | `index.ts` (entry), `env.ts` (env vars), `handler.ts` (upstream proxy + stub fallback) |
| `scripts/` | `register.ts` — on-chain registration on Somnia |
| `test/` | Agent test suite |
| Config | `tsconfig.json`, `vitest.config.ts`, `.env.example` |

### `packages/contracts/src/interfaces/` — Interface Details

| Interface | File | Role |
|-----------|------|------|
| `IAgentRequesterHandler` | `IAgentRequesterHandler.sol` | Somnia Agents API callback types (`ConsensusType`, `ResponseStatus`, `Request`, `Response`); `handleResponse()` for Somnia-native sub-agent callbacks |
| `IERC6551Account` | `IERC6551Account.sol` | ERC-6551 TBA interface: `execute()`, `token()`, `isValidSigner()`, `state()` |
| `IERC6551Registry` | `IERC6551Registry.sol` | ERC-6551 registry — `createAccount()` and `account()` with pinned arg order (implementation, salt, chainId, tokenContract, tokenId) |
| `ITwiin` | `ITwiin.sol` | `ITwiinAgent` + `IOrchestrator` — breaks circular dep between TwiinAgent and AgentOrchestrator |

### `packages/contracts/src/mocks/` — Mock Details

| Mock | File | Role |
|------|------|------|
| `ERC6551Registry` | `ERC6551Registry.sol` | Local ERC-6551 registry (canonical `0x0000...6551...75758` absent on Somnia testnet) |
| `MockAgentsApi` | `MockAgentsApi.sol` | Simulates `IAgentRequester` for test — `fulfillRequest`/`failRequest` helpers |
| `MockERC20` | `MockERC20.sol` | Standard ERC-20 mock for testing token interactions |
| `MockUniswapV2Router02` | `MockUniswapV2Router02.sol` | Uniswap V2 router mock for testing swaps |

### `packages/contracts/test/` — Test File Details

| File | Coverage |
|------|----------|
| `Account.test.ts` | ERC-6551 TBA: `token()`, `execute`, auth, `subscribePull` |
| `Factory.test.ts` | `deployTwiin` end-to-end, name claim, policy seed |
| `Names.test.ts` | Name validation, claim, collision, immutability |
| `OrchestratorExternal.test.ts` | External result flow, ECDSA digest, refresh preflight |
| `OrchestratorTask.test.ts` | Task lifecycle, auth, transfer lock, timeouts |
| `Policy.test.ts` | Caps, kill switch, daily reset, `setPolicy` auth |
| `Registry.test.ts` | Two-lane registration, Elo sort, capability map |
| `Vault.test.ts` | Removed-fn absence, access control |
| `Invariant.test.ts` | System-level invariant tests |
| `Soak.test.ts` | Soak/load test runner |
| `helpers.ts` | `deployAll()`, `deriveTwiinAccount()`, `signExternalResult()` |

### `apps/backend/src/` — Source File Details

| File | Role |
|------|------|
| `index.ts` | Entry point — Hono server, CORS, route mounting, keeper startup |
| `app.ts` | Hono app factory with DI (routes, CORS, error handler) |
| `clients.ts` | viem `publicClient`, `walletClient`, `keeperAccount` for Somnia Testnet |
| `contracts.ts` | `getContract` instances + deployment manifest + boot block |
| `db.ts` | Turso/Drizzle SQLite client + all query helpers |
| `schema.ts` | Drizzle ORM schema: `keeperCursors`, `tasks`, `steps`, `planRequests`, `submittedResults`, `submittedRatings` |
| `env.ts` | Zod-enforced env vars: `KEEPER_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `SOMNIA_RPC_URL`, `TURSO_DB_URL`, etc. |
| `sse.ts` | SSE pub/sub — `subscribe()`, `publish()`, `publishAll()`, `makeSseStream()`, heartbeat |
| `budget.ts` | Shared budget validation logic |
| `keeper-writes.ts` | Enqueues keeper writes serially with nonce collision retry |
| `planner-json.ts` | JSON planner utilities |

### `apps/backend/src/routes/` — Route Details

| Route | File | Endpoint | Role |
|-------|------|----------|------|
| Plan | `plan.ts` | `POST /api/plan` | Accepts user goal → Claude Haiku planner → returns `createTask` calldata; rate-limited (10 req/min/IP), optional `x-plan-secret` auth |
| Tasks | `tasks.ts` | `GET /api/tasks/:taskId` | Reads task state from on-chain `AgentOrchestrator.tasks()` |
| Tasks Steps | `tasks.ts` | `GET /api/tasks/:taskId/steps` | Returns indexed steps from SQLite |
| Stream | `stream.ts` | `GET /api/stream/:taskId` | SSE stream for real-time task execution updates |
| Agents | `agents.ts` | `GET /api/agents` | Lists registered external agents from `AgentRegistry` |


### `apps/backend/src/keepers/` — Keeper Details

| Keeper | File | Poll | Role |
|--------|------|------|------|
| Indexer | `indexer.ts` | 4s | Polls events (task + external agent lifecycle); upserts to SQLite; publishes SSE updates |
| Relay | `relay.ts` | 4s | Routes `StepUpdated(Assigned)` → Claude Sonnet (native) or HTTP POST (external); submits ECDSA-signed result on-chain |
| Rater | `rater.ts` | 6s | Rates `StepUpdated(Completed)` via Claude Haiku; submits `rateStep` on-chain if score ≥ 40 |
| Externals | `externals.ts` | 4s | Monitors `ExternalAgentRequest` → dispatches HTTP POST to registered agent endpoints |
| Timeouts | `timeouts.ts` | 5s | Monitors pending external steps → calls `timeoutExternalStep` on-chain at deadline |

### `packages/contracts/src/` — Contract Source Details

| Contract | File | Role |
|----------|------|------|
| `TwiinFactory` | `TwiinFactory.sol` | Bootstrap + per-user deploy |
| `TwiinAgent` | `TwiinAgent.sol` | ERC-721 "Twiin Agent" |
| `TwiinAccount` | `TwiinAccount.sol` | ERC-6551 TBA |
| `TwiinNames` | `TwiinNames.sol` | `name@twiin` namespace |
| `AgentRegistry` | `AgentRegistry.sol` | Two-lane agent registry |
| `AgentVault` | `AgentVault.sol` | Task-time escrow |
| `AgentPolicy` | `AgentPolicy.sol` | Per-agent spending policy |
| `AgentOrchestrator` | `AgentOrchestrator.sol` | Core task engine |
| `OracleFeed` | `OracleFeed.sol` | On-chain feed + templates |
| `TwiinTypes` | `TwiinTypes.sol` | Shared enums/structs |

## Architecture

```
User → TwiinFactory.deployTwiin(name) → ERC-721 NFT + ERC-6551 wallet + TwiinNames claim + Policy seed
  ↓
User signs twiinAccount.execute(orchestrator, createTask, budgetWei) — one sig
  ↓
AgentOrchestrator dispatches steps → Somnia-native (validator consensus) or External HTTP (ECDSA-verified)
  ↓
Result → rating by Claude Haiku → payment released if score ≥ 40/100
  ↓
Auto-refresh via Somnia Reactivity precompile (chain-side, no cron) or keeper fallback
```

## Contract Inventory

| Contract            | File                    | Role                                                                                                                            |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TwiinFactory`      | `TwiinFactory.sol`      | Bootstrap + per-user deploy; `deployTwiin(name)` mints NFT, deploys 6551 proxy, funds wallet, claims name, seeds policy in 1 tx |
| `TwiinAgent`        | `TwiinAgent.sol`        | ERC-721 `"Twiin Agent"` / `"TWIIN"`; tokenId == personalAgentId; blocks transfer during active tasks; non-burnable              |
| `TwiinAccount`      | `TwiinAccount.sol`      | ERC-6551 TBA; deterministic addr per NFT; holds STT; `subscribePull` + `pullForRefresh` for chain-side refresh                  |
| `TwiinNames`        | `TwiinNames.sol`        | Unified `name@twiin` namespace; personal + sub-agent names; `[a-z0-9-]` 3–32 chars; names never released                        |
| `AgentRegistry`     | `AgentRegistry.sol`     | Two-lane registry: SomniaNative (configIds 0–5) + ExternalHTTP (configId 6+); Elo ranking, capability map, deposits             |
| `AgentVault`        | `AgentVault.sol`        | Pure task-time escrow; no balances/owners/deposits/withdraws; lock/payNative/releaseExternal/sweep only                         |
| `AgentPolicy`       | `AgentPolicy.sol`       | Per-agent: dailyCapWei (2 STT), maxPerTaskWei (1 STT), killSwitch, allowedContracts, dailySpent with lazy reset                 |
| `AgentOrchestrator` | `AgentOrchestrator.sol` | Core engine: task lifecycle, dispatch, ECDSA verification, rating, timeouts, retry, Somnia Reactivity refresh                   |
| `OracleFeed`        | `OracleFeed.sol`        | On-chain feed + task template store; `publishFeed`, `isStale()`, `getFeed()`; events for indexing only                          |
| `TwiinTypes`        | `TwiinTypes.sol`        | Shared enums/structs (`AgentLane`, `PlanMode`, `StepState`, `TaskState`, `Step`)                                                |

## Key Constants

| Constant               | Value          | Contract                           |
| ---------------------- | -------------- | ---------------------------------- |
| `TWIIN_6551_SALT`      | `bytes32(0)`   | shared across all 6551 derivations |
| `MIN_QUALITY_SCORE`    | 40/100         | AgentPolicy                        |
| `RATING_WINDOW`        | 600s (10 min)  | AgentOrchestrator                  |
| `MAX_STEPS`            | 8              | AgentOrchestrator                  |
| `TASK_DEADLINE`        | 1800s (30 min) | AgentOrchestrator                  |
| `MAX_RETRIES`          | 2              | AgentOrchestrator                  |
| `SUBCOMMITTEE_SIZE`    | 3              | AgentOrchestrator (native lane)    |
| `MIN_EXTERNAL_DEPOSIT` | 5 STT          | AgentRegistry                      |
| `DEREGISTER_LOCKUP`    | 86400s (24h)   | AgentRegistry                      |

## Native Sub-Agents (configId 0–5)

| ID  | Name                  | Somnia Agent ID        | Cost     | Capability        |
| --- | --------------------- | ---------------------- | -------- | ----------------- |
| 0   | `janice@twiin`        | `12847293847561029384` | 0.24 STT | —                 |
| 1   | `web-intel@twiin`     | `12875401142070969085` | 0.33 STT | `web.scrape`      |
| 2   | `somnia-oracle@twiin` | `13174292974160097713` | 0.12 STT | `json.fetch`      |
| 3   | `analysis-bot@twiin`  | `12847293847561029384` | 0.24 STT | `llm.analyze`     |
| 4   | `reporter-bot@twiin`  | `12847293847561029384` | 0.24 STT | `llm.report`      |
| 5   | `executor-bot@twiin`  | `12847293847561029384` | 0.24 STT | `onchain.execute` |

## Network

| Property          | Value                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Testnet           | Somnia Shannon, chainId `50312`, token STT                                                                                    |
| RPC               | `https://dream-rpc.somnia.network/`                                                                                           |
| Agents Proxy      | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`                                                                                  |
| ERC-6551 Registry | Canonical `0x0000...6551...75758` returns `0x` on testnet — local `ERC6551Registry.sol` deployed; address in `addresses.json` |

## Conventions

- Solidity: 0.8.30, Cancun EVM, viaIR enabled, optimizer 200 runs
- CEI (Checks-Effects-Interactions) pattern; `ReentrancyGuard` on all external state-mutating fns
- All `.sol` sources under `packages/contracts/src/`
- Contracts tests: Hardhat + chai + ethers v6 (hardhat-toolbox); 94+ tests, all green
- Shared tests: vitest 3.x; 22 parity tests, all green
- No `dist` checked in; artifacts generated by `hardhat compile`
- `packages/shared` is the single source of truth for ABIs, addresses, constants, digest helpers, 6551 helpers — no hand-copied fragments

## Delivery Order

1. **Contracts** ✅ — auth, escrow, events, ABIs, 6551 derivation, deployed addresses
2. **Shared package** ✅ — ABIs/types, `addresses.json`, chain constants, digest helper, 6551 helper
3. **Backend** ✅ — Hono server, viem clients, Claude Sonnet planner, relay + rater keepers, event indexer, SSE, SQLite
4. **Frontend** ✅ — wallet UX, deploy flow, task flow, live execution, panels
5. **External Agents** ✅ — 7 agents (briefsmith, docs-lens, dreamdex-mcp, onchain-lens, reactivity-lens, receipt-auditor, agent-adapter)

