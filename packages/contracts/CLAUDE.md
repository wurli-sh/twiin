# @twiin/contracts — Solidity Smart Contracts

Hardhat project targeting **Somnia Testnet** (chainId 50312) + local Hardhat node (chainId 31337).
Part of the `twiin/` pnpm monorepo — consumed by `@twiin/shared`, `apps/backend`, and `apps/frontend`.

**Status: Phase 1 complete — 85/85 tests passing.**

## Commands

| Command              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `pnpm compile`       | `hardhat compile` — builds artifacts to `./artifacts`    |
| `pnpm test`          | `hardhat test`                                           |
| `pnpm coverage`      | `hardhat coverage`                                       |
| `pnpm deploy:local`  | deploy to local Hardhat node                             |
| `pnpm deploy:somnia` | deploy to Somnia Testnet                                 |
| `pnpm soak:somnia`   | run soak/load tests on Somnia Testnet                    |
| `pnpm measure:submit-external-result` | gas measurement for external result submission |
| `pnpm probe:reactivity`              | test Somnia Reactivity precompile integration |

## Source Layout

```
src/
├── interfaces/
│   ├── IAgentRequesterHandler.sol  — Somnia Agents API callback types (ConsensusType, ResponseStatus, Request, Response)
│   ├── IERC6551Account.sol         — ERC-6551 TBA interface
│   ├── IERC6551Registry.sol        — ERC-6551 registry interface (CRITICAL: arg order pinned)
│   └── ITwiin.sol                  — ITwiinAgent + IOrchestrator (breaks circular dep)
├── mocks/
│   ├── ERC6551Registry.sol         — local registry (canonical 0x0000…6551 absent on Somnia testnet)
│   ├── MockAgentsApi.sol           — test IAgentRequester; fulfill/failRequest helpers
│   ├── MockERC20.sol
│   └── MockUniswapV2Router02.sol
├── AgentOrchestrator.sol           — core engine; extends SomniaEventHandler; registerTaskTemplate()
├── AgentPolicy.sol                 — per-agent caps, kill switch, allowlist
├── AgentRegistry.sol               — two-lane registry; Elo ranking
├── AgentVault.sol                  — pure task-time escrow
├── OracleFeed.sol                  — on-chain feed + task template store
├── TwiinAccount.sol                — ERC-6551 TBA
├── TwiinAgent.sol                  — ERC-721 NFT
├── TwiinFactory.sol                — one-tx bootstrap
├── TwiinNames.sol                  — name registry
└── TwiinTypes.sol                  — shared enums/structs
scripts/
├── deploy.ts                         — full deployment with manifest export, ABI gen, wiring validation
├── soak.ts                           — load/soak test runner for Somnia testnet
├── measure-submit-external-result.ts — gas profiling for submitExternalResult
├── probe-reactivity.ts               — Somnia Reactivity precompile integration test
deployments/
├── hardhat.json          — local deployment manifest
├── somniaTestnet.json    — Somnia testnet deployment manifest
```

## Key Architecture Rules

1. **CEI everywhere** — state mutation before external calls; `ReentrancyGuard` on all external fns
2. **No burn** — `TwiinAgent._update` rejects `to == address(0)` (would orphan 6551 wallet assets)
3. **deployer/factory split** — `immutable deployer = msg.sender` for admin wiring; settable `factory` (set once by deployer) for `TwiinFactory` runtime calls
4. **Auth** — `msg.sender == registry6551.account(twiinAccountImpl, salt, chainId, twiinAgent, personalAgentId)` — user signs via 6551 `execute`
5. **Vault model** — pure task-time escrow; no balances/owners/deposit/withdraw/`refundStep`; lock once at `createTask`, sweep remainder at completion
6. **Rating window** — 10 min (`RATING_WINDOW`); score ≥ 40 gates external agent payment
7. **Max 8 steps** per task, 30 min total deadline, 2 retries
8. **Native deposits** — ops reserve + (costWei × 3 subcommittee). **External** — single costWei
9. **Pull subscription** — Orchestrator pulls refresh budget from 6551 account via `pullForRefresh` (pre-approved by owner via `subscribePull`)
10. **Somnia Reactivity** — `SomniaEventHandler` base; `scheduleSubscriptionSelfCall` wrapper for try/catch (library internal functions can't use try/catch directly)

## Critical Implementation Notes

### ERC-6551 Registry arg order (CRITICAL — easy to get wrong)

```solidity
// IERC6551Registry.sol — arg order is pinned
createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId, bytes initData)
account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
```

Proxy footer layout (128 bytes): `abi.encode(salt, chainId, tokenContract, tokenId)`.

### TwiinAccount.token() — DELEGATECALL gotcha

`codesize()` in a DELEGATECALL context returns the **implementation's** code size, not the proxy's.
Must use `extcodesize(address())` to read the proxy's footer correctly.

### Elo insertion sort — int256/uint256 cast

`arr[uint256(j + 1)]` — `j + 1` computed as `int256` first (safe when `j = -1`), then cast.
`arr[uint256(j) + 1]` overflows in 0.8 checked arithmetic when `j = -1`.

### ECDSA digest for external results

```
keccak256(abi.encodePacked("\x19Twiin External Result v1\n", chainId, orchestrator, taskId, stepIdx, externalRequestId, keccak256(result)))
```

then `toEthSignedMessageHash`.

### Somnia Reactivity scheduling

`scheduleSubscriptionAtTimestamp` takes `SubscriptionOptions{priorityFeePerGas, maxFeePerGas, gasLimit}` — NOT bytes data.
Refresh entries keyed by `timestampMillis`; `_onEvent` decodes from `eventTopics[1]`.

### submitExternalResult check order

Size check (`result too large`) fires **before** state/bounds checks — test suite expects this order.

## Test Files

| File                           | Coverage                                                      |
| ------------------------------ | ------------------------------------------------------------- |
| `Account.test.ts`              | ERC-6551 TBA: token(), execute, auth, subscribePull           |
| `Factory.test.ts`              | deployTwiin end-to-end, name claim, policy seed               |
| `Names.test.ts`                | name validation, claim, collision, immutability               |
| `OrchestratorExternal.test.ts` | external result flow, ECDSA digest, refresh preflight, timeout slash, refund |
| `OrchestratorTask.test.ts`     | task lifecycle, auth, transfer lock, timeouts, retry, daily reset |
| `Policy.test.ts`               | caps, kill switch, daily reset, setPolicy auth                |
| `Registry.test.ts`             | two-lane registration, Elo sort, capability map               |
| `Vault.test.ts`                | removed-fn absence, access control                            |
| `Invariant.test.ts`            | system-level invariant tests                                  |
| `Soak.test.ts`                 | soak/load test runner                                         |
| `helpers.ts`                   | `deployAll()`, `deriveTwiinAccount()`, `signExternalResult()` |

## Hardhat Config Notes

- `solidity: "0.8.30"`, `evmVersion: "cancun"`, `viaIR: true`, `optimizer: { runs: 200 }`
- `evmVersion: "cancun"` required for `mcopy` instruction used by Somnia reactivity contracts
- ethers v6: use `iface.fragments` (not `iface.functions`); `getFunction` returns `null` (doesn't throw) for unknown names
