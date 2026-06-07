# @twiin/contracts/src/lib/ — Solidity Library Contracts

Shared libraries extracted from `AgentOrchestrator.sol` to work around stack-too-deep and enable unit reuse.

| File | Role |
|------|------|
| `AgentConsensusLib.sol` | Consensus receipt building, participation validation (`satisfiesParticipation`), median execution cost calculation |
| `AgentJaniceLib.sol` | Janice trustless planner helpers: tool name/args extraction, payload encoding, `eq()`, `buildInitialJanicePayload()` |
