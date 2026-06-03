# Twiin — Agentic AI × Crypto on Somnia

**Pitch:** Mint a named, tradeable AI agent on Somnia — an NFT with its own ERC-6551 wallet — that autonomously hires the best available specialist sub-agents from an open marketplace, pays them per step from a policy-guarded escrow, publishes consensus-verified oracle feeds any contract can consume, and never touches a cent more than you allowed — all triggered by on-chain events with no user-operated server.

Somnia Agentathon (Encode Club, May 18 – Jun 11 2026). Somnia Testnet chainId `50312`, native token STT.

## Phase Status

| Phase               | Status      | Notes                                                    |
| ------------------- | ----------- | -------------------------------------------------------- |
| 1 — Contracts       | ✅ Complete | 85/85 tests passing                                      |
| 2 — Shared package  | ✅ Complete | 22/22 vitest tests; ABIs, constants, digest, 6551 helper |
| 3 — Backend         | ⬜ Pending  | Hono, Claude planner, relay keepers, SSE                 |
| 4 — Frontend        | ⬜ Pending  | React/Vite/wagmi, deploy flow, task flow                 |
| 5 — TrustlessJanice | ⬜ Gated    | Feature-flagged off until T2/T3/T4 testnet pass          |

## Commands

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `pnpm build`         | builds all packages                     |
| `pnpm test`          | runs `@twiin/contracts` tests (Hardhat) |
| `pnpm compile`       | compiles `@twiin/contracts` (Hardhat)   |
| `pnpm deploy:local`  | deploy contracts to local Hardhat node  |
| `pnpm deploy:somnia` | deploy contracts to Somnia Testnet      |

## Structure

```
twiin/
├── packages/
│   ├── contracts/   — Solidity smart contracts (Hardhat, Solidity 0.8.30) ✅
│   └── shared/      — TypeScript shared lib (ABIs, types, constants, helpers) ✅
├── apps/            — backend (Hono) + frontend (React/Vite/wagmi) ⬜
├── pnpm-workspace.yaml
└── CLAUDE.md (this file)
```

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

## PlanMode

Phases 1–4: **ClaudePlan only** (Claude API plans). **TrustlessJanice** (validator-consensus planning via `janice@twiin`) is feature-flagged off until T2/T3/T4 measured on testnet.

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
| 0   | `janice@twiin`        | `12847293847561029384` | 0.24 STT | `plan.trustless`  |
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
- Contracts tests: Hardhat + chai + ethers v6 (hardhat-toolbox); 85 tests, all green
- Shared tests: vitest 3.x; 22 parity tests, all green
- No `dist` checked in; artifacts generated by `hardhat compile`
- `packages/shared` is the single source of truth for ABIs, addresses, constants, digest helpers, 6551 helpers — no hand-copied fragments

## Delivery Order

1. **Contracts** ✅ — auth, escrow, events, ABIs, 6551 derivation, deployed addresses
2. **Shared package** ✅ — ABIs/types, `addresses.json`, chain constants, digest helper, 6551 helper
3. **Backend** 🔜 — contract clients, indexing, Claude planning, external relay/rating, SSE
4. **Frontend** ⬜ — wallet UX, deploy flow, task flow, live execution, panels
5. **TrustlessJanice** ⬜ — feature-flagged off until T2/T3/T4 pass
