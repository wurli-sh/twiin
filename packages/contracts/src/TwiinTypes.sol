// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Shared enums and structs imported by AgentOrchestrator, AgentPolicy, and OracleFeed.
// Keeping them here prevents divergent struct layouts across cross-contract calls.

enum AgentLane  { SomniaNative, ExternalHTTP }
enum PlanMode   { ClaudePlan, TrustlessJanice }
enum StepState  { Pending, RunningNative, RunningExternal, AwaitingRating, Succeeded, Failed, Retrying, TimedOut }
enum TaskState  { Created, Running, Completed, Aborted }
enum TrustlessAwaiting { Janice, Step, Resume, Done }

struct Step {
    uint256 subAgentConfigId;
    bytes   payload;
    uint256 maxCostWei;
    uint32  timeoutSeconds;  // default 900s
}
