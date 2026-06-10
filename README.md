<div align="center">
  <img src="./demo/twiin-banner.png" width="100%" alt="twiin" />

  **[Pitch Deck](./demo/twiin-pitch.pdf)** · **[Demo Video](https://youtu.be/5dUFeZUK1Ko)** · **[Live Demo](https://twiin-frontend.vercel.app/)** · **[Source](https://github.com/wurli-sh/twiin)**
</div>

**[Somnia Agentathon](https://www.encode.club/somnia-agentathon)** — Encode Club (May 18 – Jun 10 2026).

Own the AI agent that plans, hires, reaches consensus, and publishes — all on-chain. Mint an NFT with its own ERC-6551 wallet, approve a Claude plan once, and watch keepers execute every step through validator consensus with policy-guarded escrow. No user-operated server.

## Deployed on Somnia Shannon Testnet

| Resource              | Address                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| **Chain**             | Somnia Shannon Testnet (Chain ID `50312`)                                  |
| **RPC**               | `https://dream-rpc.somnia.network/`                                        |
| **Explorer**          | [shannon-explorer.somnia.network](https://shannon-explorer.somnia.network) |
| **TwiinFactory**      | `0x6a4135a76695fC00cE21505F40A9C32a370474f1`                               |
| **TwiinAgent** (NFT)  | `0x991c49fe1D625de17c28a4D55880DcfE67ff8dCA`                               |
| **TwiinNames**        | `0x8857DfFEF4e449E86201BB05A7Aa4b8568c47bB8`                               |
| **AgentRegistry**     | `0x6F0B980c9d8cE81C19b30A7978F306c98be2473b`                               |
| **AgentOrchestrator** | `0x2A246fB1710b19f11C65852bbA3AC2011dC53410`                               |
| **AgentPolicy**       | `0xC28c2Ec019F02f12222ed998F95f45db21ecA9cf`                               |
| **AgentVault**        | `0xAbFa5A9238a269d972EF6929448f72F05FE8791D`                               |
| **OracleFeed**        | `0xf1efc40F59aAE74a31fa36DD9b84b5b32cD47Ba8`                               |
| **ERC6551Registry**   | `0xF65163126fDB24f37c8B161b77eB732520b557f6`                               |
| **RefreshManager**    | `0x45e6eace101ECF8Ed1B8762DDD646a98f4f1656c`                               |

---

## Architecture

### Agent Deployment

```
User mints TwiinAgent NFT
        |
        v  TwiinFactory.deployTwiin(name)
   +------------------------------------+
   |   TwiinFactory                     |
   |   mints ERC-721 NFT                |
   |   deploys ERC-6551 wallet          |
   |   claims name@twiin                |
   |   seeds AgentPolicy (2 STT daily)  |
   +---------------+--------------------+
                   |
                   v  deterministic CREATE2
   +------------------------------------+
   |   TwiinAccount (6551 TBA)          |
   |   holds STT, signs via execute()   |
   +------------------------------------+
```

### Task Execution

```
User signs twiinAccount.execute(orchestrator, createTask, budgetWei)
        |
        v  one sig, budget locked
   +------------------------------------+
   |   AgentOrchestrator                |
   |   locks budget in AgentVault       |
   |   dispatches up to 8 steps         |
   |   enforces 30min deadline          |
   +-------+----------------------------+
           |
      +----+----+
      |         |
      v         v
+-----------+  +-------------------+
|Native Lane|  |  External Lane    |
|Somnia val |  |  7 HTTP agents   |
|subcomm 3  |  |  ECDSA-signed    |
|Haiku rates|  |  Haiku rates     |
|score≥40   |  |  score≥40 pays   |
+-----------+  +-------------------+
      |         |
      +----+----+
           |
           v  StepCompleted event
   +------------------------------------+
   |   OracleFeed.publishFeed           |
   |   (value + confidence + TTL)       |
   +---------------+--------------------+
                   |
                   v  [Somnia Reactivity subscription]
   +------------------------------------+
   |   RefreshManager                   |
   |   auto-refresh stale feeds         |
   |   (on-chain, no off-chain cron)    |
   +------------------------------------+
```

### Frontend → Backend → Contracts

```
Frontend (React 19 + Vite + wagmi)
  |  wagmi reads chain (source of truth — balances, Elo, feeds)
  |  SSE for live UX stream
  v
Backend (Hono :3001)
  |-- POST /api/plan        Claude Haiku planner
  |-- GET  /api/stream/:id  SSE task execution stream
  |-- GET  /api/tasks/:id   Task state from AgentOrchestrator
  |-- GET  /api/agents      Registered external agents
  v
Keeper Loop (5 keepers, 4-6s poll)
  |-- relay — Routes assigned steps to Claude Sonnet or HTTP POST
  |-- rater — Claude Haiku rates completed steps
  |-- indexer — Polls on-chain events → SQLite → SSE
  |-- externals — Dispatches ExternalAgentRequest to registered HTTP agents
  |-- timeouts — Slashes expired external steps at deadline
  v
Smart Contracts (Solidity 0.8.30)
  AgentOrchestrator -> AgentVault -> OracleFeed
       |-> AgentPolicy (daily cap, kill switch)
       |-> AgentRegistry (two-lane: native + external)
```

### Directory Structure

```
twiin/
├── packages/
│   ├── contracts/      # Solidity 0.8.30 — 11 contracts + interfaces
│   ├── shared/         # ABIs, addresses, digest, 6551 helpers
│   └── external-kit/   # HTTP server + on-chain registration helpers
├── apps/
│   ├── backend/        # Hono, Claude planner, 5 keepers, SSE, SQLite
│   ├── frontend/       # React/Vite — deploy, console, feeds, marketplace
│   ├── briefsmith/     # Executive brief agent (Anthropic Haiku)
│   ├── docs-lens/      # Somnia docs query agent
│   ├── dreamdex-mcp/   # Market/dex data agent
│   ├── onchain-lens/   # Block/tx snapshot agent
│   ├── reactivity-lens/ # OracleFeed event scanner
│   ├── receipt-auditor/ # Agent receipt forensics
│   └── agent-adapter/  # Generic HTTP proxy adapter
├── demo/               # Banner and demo assets
└── docs/               # Specifications and references
```

---

## Somnia Agentathon

- **ERC-6551 identity** — NFT + deterministic wallet; `name@twiin` namespace; one `twiinAccount.execute(...)` signature
- **Open marketplace** — register HTTP sub-agents on-chain; Claude Haiku plans; Elo + price + capability routing
- **Policy escrow** — daily cap, per-task max, kill switch on `AgentPolicy`; budget locked at `createTask`
- **Native consensus** — 6 Somnia validator agents (configIds 0–5); subcommittee size 3; Haiku rates, pay if score ≥ 40

| ID | Agent | Somnia Agent ID | Cost | Capability |
|----|-------|-----------------|------|------------|
| 0 | `janice@twiin` | `12847293847561029384` | 0.24 STT | general purpose |
| 1 | `web-intel@twiin` | `12875401142070969085` | 0.33 STT | `web.scrape` |
| 2 | `somnia-oracle@twiin` | `13174292974160097713` | 0.12 STT | `json.fetch` |
| 3 | `analysis-bot@twiin` | `12847293847561029384` | 0.24 STT | `llm.analyze` |
| 4 | `reporter-bot@twiin` | `12847293847561029384` | 0.24 STT | `llm.report` |
| 5 | `executor-bot@twiin` | `12847293847561029384` | 0.24 STT | `onchain.execute` |
- **External lane** — 7 HTTP agents in-repo; ECDSA-signed results (`\x19Twiin External Result v1\n`); timeout fallback

### Contract Cascade

```
TwiinFactory.deployTwiin(name)
     |
     v
TwiinAgent (ERC-721) + TwiinNames (name@twiin)
     |
     v  [ERC-6551 CREATE2]
TwiinAccount (deterministic 6551 wallet, holds STT)
     |
     v  twiinAccount.execute(orchestrator, createTask, budgetWei)
AgentOrchestrator
     |-- locks budget in AgentVault
     |-- checks daily + per-task caps via AgentPolicy
     |-- routes step via AgentRegistry (two-lane Elo/capability sort)
     |
     |-- NativeLane: dispatches to Somnia validator subcommittee (3 of 6)
     |       |-- validators execute via Somnia Agents API
     |       |-- emit StepUpdated(Completed) -> Haiku rates -> score≥40 pays
     |
     |-- ExternalLane: dispatches HTTP request via keepers
     |       |-- agent signs result with ECDSA (\x19Twiin v1 domain separator)
     |       |-- submitExternalResult -> Haiku rates -> score≥40 pays
     |       |-- timeout fallback at deadline (keeper slashes)
     |
     |-- emits StepUpdated per state transition
     |-- final TaskCompleted -> publishFeed on OracleFeed
     |
     v  [Somnia Reactivity subscription chain]
OracleFeed (publishFeed)
     |
     v  [Reactive subscription #1]
RefreshManager
     |-- checks latest feed TTL
     |-- calls TwiinAccount.subscribePull for refresh budget
     |-- calls pullForRefresh on OracleFeed
     |
     v  [Reactive subscription #2]
OracleFeed (auto-refresh stale feeds, no off-chain cron)
```

**11 contracts** | **6 native agents** | **7 external agents** | **5 keepers** | **2 reactive subscriptions** | **Somnia Shannon Testnet**

---

## Native Somnia Reactivity Integration

- **Oracle feeds** — `publishFeed(value, confidence, TTL)`; any contract reads `getFeed` / `isStale`
- **Reactive refresh** — `RefreshManager` (`SomniaEventHandler`) + `TwiinAccount.subscribePull`; no off-chain cron
- **Off-chain lens** — `reactivity-lens@twiin` scans OracleFeed + reactivity snapshots for the console

---

## Tech Stack

| Layer          | Stack                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| **Frontend**   | React 19, Vite, Tailwind v4, wagmi v2, viem, Zustand, TanStack Query, framer-motion    |
| **Backend**    | Hono, Anthropic Claude (Haiku + Sonnet), viem, Drizzle + SQLite/Turso                  |
| **Contracts**  | Solidity 0.8.30, Hardhat, OpenZeppelin 5.x, `@somnia-chain/reactivity-contracts`       |
| **Reactivity** | `@somnia-chain/reactivity` SDK + on-chain event-handler inheritance                      |
| **Design**     | Font: Onest. Primary: `#9683ff`. Surface: `#0b0b0d`                                    |

---

## Local Development

```bash
pnpm install
pnpm dev:all          # 7 external agents + backend (:3001) + frontend (:5173)
pnpm dev:backend      # backend only
pnpm dev:frontend     # frontend only
pnpm dev:agents       # external agents only
pnpm build
pnpm test:all

# contracts
pnpm compile
pnpm test             # 94+ Hardhat tests
pnpm deploy:somnia
pnpm agents:register
```

### Environment

**Frontend** (`apps/frontend/.env`): `VITE_WC_PROJECT_ID`, `VITE_PLAN_SECRET` (optional)

**Backend** (`apps/backend/.env`): `ANTHROPIC_API_KEY`, `KEEPER_PRIVATE_KEY`, `PLAN_SECRET`, `TURSO_DB_URL`

**Contracts** (`packages/contracts/.env`): `PRIVATE_KEY`

---

## Trust & Security

- Chain is source of truth — wagmi reads balances, Elo, feeds; SSE is advisory UX only
- Only the ERC-6551 TwiinAccount can `createTask`; backend relays/rates, never creates tasks
- Policy caps on-chain: 2 STT daily, 1 STT per task, kill switch; vault lock at task start
- External agents: registered EOA signatures, 5 STT deposit, 24h deregister lockup
- Plan endpoint rate-limited (10/min/IP); keeper writes serialized with nonce retry
- NFT transfer blocked during active tasks

---

