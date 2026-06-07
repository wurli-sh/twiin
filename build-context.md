# Twiin — compact context (Jun 2026)

## Pitch
Named ERC-6551 NFT agents on Somnia Shannon (`50312`). Hire sub-agents from open marketplace, policy escrow, oracle feeds. User signs `twiinAccount.execute → createTask`. Backend relays/rates externals; chain is truth.

## Phase status
| Phase | Status |
|-------|--------|
| 1 Contracts | ✅ ~91 tests, deployed Somnia |
| 2 `@twiin/shared` | ✅ ABIs, addresses, digest, 6551 helper |
| 3 Backend | ✅ plan, keepers, SSE, SQLite; minor gaps below |
| 4 Frontend | ✅ ~90% demo-ready |
| 5 TrustlessJanice | ⏸ deprioritized — Claude Plan + consensus receipts is default |
| 6 Consensus receipts | ✅ per native step (tsugu-inspired); redeploy orchestrator for live chain |

## Addresses (`packages/shared/addresses.json`)
`factory` `0x1d90…5544` · `orchestrator` `0xC10D…C6Be` · `twiinAgent` `0x6a78…1682` · `agentRegistry` `0xE572…248d` · `policy` `0xcEa1…10AC` · `oracleFeed` `0x9eE6…8F87` · RPC `https://dream-rpc.somnia.network/`

## Frontend (`apps/frontend`)
| Route | Done |
|-------|------|
| `/` | Home |
| `/agents` | Deploy (`deployTwiin`), list, kill switch, **Activity** (chain task scan) |
| `/console` | Plan → 60s approve → 6551 `execute`; SSE timeline; **TaskResult** (chain + `/api/tasks/:id/steps`); budget warning |
| `/feeds` | Oracle `getFeed` / stale (F6) |
| `/marketplace` | Registry Elo, native/external tabs |

**Infra:** wagmi Somnia only, `NetworkBanner` wrong-chain switch, Vite proxy `/api` → `:3001`, `@twiin/shared` via Vite alias to source.

**Frontend gaps (low):** Policy panel (`setPolicy`, `subscribePull`), external register UI (curl/`pnpm register:discord-bot` OK), AgentProfile NFT page, `wallet_addEthereumChain` fallback, frontend tests.

## Backend (`apps/backend`)
- `POST /api/plan` · `GET /api/stream/:id` · `GET /api/tasks/:id` (+ `/steps`) · `GET /api/agents`
- Keepers: indexer, relay, rater

**Gaps:** BudgetGuard ($2/$0.50), boot re-verify externals, optional OracleRefreshWorker if Reactivity fails.

## External demo
`apps/discord-bot` + `pnpm register:discord-bot` — `discord-bot@twiin` HTTP `/execute`.

## Commands
```bash
pnpm install && pnpm dev:all          # :3001 + :5173
pnpm build && pnpm test               # contracts
pnpm deploy:somnia && pnpm register:discord-bot
```

## Env
- Frontend: `VITE_WC_PROJECT_ID`, `VITE_PLAN_SECRET` (optional)
- Backend: `ANTHROPIC_API_KEY`, `KEEPER_PRIVATE_KEY`, `PLAN_SECRET`, `TURSO_DB_URL`

## Spec refs
- Full spec: `docs/twiin.md` (repo root) or `twiin/../docs/twiin.md`
- README: `twiin/README.md` (Mirra-style, written)

## E2E demo path
1. Connect Somnia · deploy agent · enable kill switch  
2. Console: goal + budget → approve `createTask`  
3. Backend keepers running → SSE + Activity tab  
4. Feeds after oracle.publish task  

## UI store (`stores/ui.ts`)
`selectedAgentId`, `activeAgentsTab`, `activeMarketplaceTab`, `activeFeedsTab`

## F6 rule
SSE advisory only. Cross-read chain for Elo, feeds/stale, task state, balances.
