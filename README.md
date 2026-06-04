# Twiin

**Somnia Agentathon** — Encode Club (May 18 – Jun 11 2026).

Mint a named, tradeable AI agent on Somnia — an NFT with its own ERC-6551 wallet that autonomously hires specialist sub-agents from an open marketplace, pays them per step from policy-guarded escrow, and publishes consensus oracle feeds any contract can read. No user-operated server — execution is triggered by on-chain events.

## Deployed on Somnia Shannon Testnet

| Resource               | Address                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| **Chain**              | Somnia Shannon Testnet (Chain ID `50312`)                                  |
| **RPC**                | `https://dream-rpc.somnia.network/`                                        |
| **Explorer**           | [shannon-explorer.somnia.network](https://shannon-explorer.somnia.network) |
| **TwiinFactory**       | `0x1d90c091CA842A1b4357014Ac1179860864c5554`                               |
| **TwiinAgent** (NFT)   | `0x6a7893A92faBb8e0883e04CA2D770Ce4873e1682`                               |
| **TwiinNames**         | `0x9fee12eae9b462acf54BAB99b6A47AC816449D1B`                               |
| **AgentRegistry**      | `0xE5723e96567Eb09A92F9704a1eA32F13A7c3248d`                               |
| **AgentOrchestrator**  | `0xC10DF8aCdF4a570F95aB01550EF01320824EC6Be`                               |
| **AgentPolicy**        | `0xcEa1f17E17e6FA32b0Ee2aB189353F7F850F10AC`                               |
| **AgentVault**         | `0x3a042A5E2508E7F1CAbFe5Ac552ff560a8A91FB6`                               |
| **OracleFeed**         | `0x9eE6f1Ae2E1bB0AA59223aa1c7eEE277C4A48F87`                               |
| **ERC6551Registry**    | `0x8483F956A725Bfe7617eCB46031535A25BEAe0B8`                               |

---

## Architecture

```
User signs ONE tx: twiinAccount.execute(orchestrator, createTask, value=budget)
       |
       v
  +-------------------------+
  |   AgentOrchestrator     |  locks budget once, dispatches steps sequentially
  |   per-step pay/escrow   |
  +-----------+-------------+
        |             |
   native lane   external lane (HTTP)
   (on-chain)    ECDSA-signed result -> Haiku rates -> pay or skip
        |             |
        v             v
  +-------------------------+
  |   OracleFeed            |  publishFeed(value, confidence, TTL)
  |   isStale() + refresh   |  <-- Somnia Reactivity auto-refresh
  +-------------------------+
```

```
Frontend (React 19 + Vite)            Backend keepers (Hono :3001)
  |  wagmi reads chain (F6)             |-- POST /api/plan    goal -> Claude Haiku -> createTask calldata
  |  SSE for live UX                    |-- GET  /api/stream  SSE task events
  v                                     |-- relay / rater / indexer keepers
Smart Contracts (Solidity 0.8.30)      |-- ECDSA-verify + Haiku-rate external results
```

### Directory Structure

```
twiin/
├── packages/
│   ├── contracts/     # Solidity 0.8.30, Hardhat — identity, orchestration, oracle, policy
│   └── shared/        # ABIs, addresses, constants, digest + ERC-6551 helpers (single source)
├── apps/
│   ├── backend/       # Hono — Claude planner, relay/rater/indexer keepers, SSE, SQLite
│   ├── frontend/      # React 19 + Vite + wagmi — deploy, console, feeds, marketplace
│   └── discord-bot/   # Demo external HTTP sub-agent (ECDSA-signed results)
└── docs/              # Spec
```

---

## Key Features

### ERC-6551 Agent Identity
- Each Twiin is an NFT (`TwiinAgent`) with a deterministic ERC-6551 wallet
- `name@twiin` global namespace shared by personal agents and sub-agents
- One signature: user signs `twiinAccount.execute(...)`, the agent acts as itself

### Open Sub-Agent Marketplace
- Anyone registers a competing HTTP sub-agent on-chain (`registerExternalAgent`)
- Claude Haiku plans steps; agents picked by Elo + price + capability
- External results are ECDSA-signed by a registered EOA and Haiku-rated before payment

### Policy-Guarded Escrow
- Daily caps, per-task limits, and a kill switch live on-chain (`AgentPolicy`)
- Budget locked once at `createTask`; unused remainder swept back
- The agent never spends more than you allowed

### Consensus Oracle Feeds
- Tasks publish feeds with TTL + confidence; any contract reads `getFeed` / `isStale`
- Auto-refresh scheduled via Somnia Reactivity (no off-chain cron)

---

## Tech Stack

| Layer          | Stack                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| **Frontend**   | React 19, Vite, TypeScript, Tailwind v4, wagmi v2, viem, Zustand, TanStack Query, framer-motion |
| **Backend**    | Hono, Anthropic Claude (Haiku), viem, Drizzle + SQLite/Turso                       |
| **Contracts**  | Solidity 0.8.30, Hardhat, OpenZeppelin 5.x, `@somnia-chain/reactivity-contracts`   |
| **Reactivity** | Somnia event-handler inheritance for on-chain feed refresh                         |
| **Design**     | Font: Onest. Primary: `#9683ff` (purple). Surface: `#0b0b0d` (dark)                |

---

## Local Development

```bash
# Install (pnpm workspace)
pnpm install

# Run backend (:3001) + frontend (:5173)
pnpm dev:all

# Or individually
pnpm dev:backend
pnpm dev:frontend
pnpm dev:discord-bot

# Build everything
pnpm build
```

### Contracts

```bash
pnpm compile                 # Hardhat compile
pnpm test                    # contract tests
pnpm deploy:somnia           # deploy to Somnia testnet
pnpm register:discord-bot    # register demo external agent on-chain
```

---

## Environment Setup

**Frontend** (`apps/frontend/.env`):

```bash
VITE_WC_PROJECT_ID=          # optional — WalletConnect
VITE_PLAN_SECRET=            # optional — must match backend PLAN_SECRET
```

**Backend** (`apps/backend/.env`):

```bash
ANTHROPIC_API_KEY=your_key   # Claude planner + rater
KEEPER_PRIVATE_KEY=0x...     # relay/rater/indexer keeper EOA
PLAN_SECRET=                 # optional — guards POST /api/plan
TURSO_DB_URL=                # optional — defaults to local SQLite
```

**Contracts** (`packages/contracts/.env`):

```bash
PRIVATE_KEY=your_deployer_private_key_here
```

---

## Trust Model

- **Chain is the source of truth.** The frontend cross-reads balances, Elo, verification, and feed staleness directly via wagmi (F6) — SSE is advisory UX only.
- **Backend cannot submit external `createTask`** — it only relays signed results and rates them. The agent-only auth check requires `msg.sender == twiinAccount(personalAgentId)`.
- **External agents** sign output with a registered EOA; bad signatures self-DOS until timeout.
- **TrustlessJanice** (validator-consensus planning) is documented but feature-flagged off until gas/pricing checks pass on testnet.

---

**Identity (ERC-6551) · Open marketplace · ECDSA-verified agents · Consensus oracle · Reactivity refresh · Somnia Shannon Testnet**
