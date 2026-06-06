import { keccak256, parseEther, toBytes, zeroHash } from "viem";

export const CHAIN_ID = 50312 as const;

// bytes32(0) — universal salt for all ERC-6551 account derivations
export const TWIIN_6551_SALT = zeroHash;

// Native sub-agent configIds 0–5 (registered in AgentRegistry by deploy script)
export const NativeConfigId = {
  JANICE: 0,
  WEB_INTEL: 1,
  ORACLE: 2,
  ANALYSIS: 3,
  REPORTER: 4,
  EXECUTOR: 5,
} as const;

// Capability IDs — computed as keccak256(toBytes(name)), matching deploy.ts exactly
const cap = (s: string) => keccak256(toBytes(s));

export const CapabilityId = {
  WEB_SCRAPE: cap("web.scrape"),
  WEB_SCRAPE_DISCORD: cap("web.scrape.discord"),
  JSON_FETCH: cap("json.fetch"),
  LLM_ANALYZE: cap("llm.analyze"),
  LLM_REPORT: cap("llm.report"),
  DATA_SPECIALIZED: cap("data.specialized"),
  ORACLE_PUBLISH: cap("oracle.publish"),
  ONCHAIN_EXECUTE: cap("onchain.execute"),
  PLAN_TRUSTLESS: cap("plan.trustless"),
} as const;

// Mirrors of TwiinTypes.sol enums — ordinals must stay in sync
export enum TaskState {
  Created,
  Running,
  Completed,
  Aborted,
}

export enum StepState {
  Pending,
  RunningNative,
  RunningExternal,
  AwaitingRating,
  Succeeded,
  Failed,
  Retrying,
  TimedOut,
}

export enum AgentLane {
  SomniaNative,
  ExternalHTTP,
}

export enum PlanMode {
  ClaudePlan,
  TrustlessJanice,
}

export enum TrustlessAwaiting {
  Janice,
  Step,
  Resume,
  Done,
}

// Policy seed defaults — must match TwiinFactory.sol deployTwiin seed values
export const DEFAULT_DAILY_CAP_WEI = parseEther("2");
export const DEFAULT_MAX_PER_TASK_WEI = parseEther("1");
export const DEFAULT_MAX_TRUSTLESS_WEI = parseEther("2");
/** Gate 0 T2 — contract loop + uint8 payload cap; see gate-results.md */
export const MAX_JANICE_ITERATIONS = 8;
/**
 * Per inferToolsChat request — Somnia agent internal LLM↔tool round-trips within one
 * createRequest. Must be >1 or Janice often returns finishReason=max_iterations on the
 * first callback. Distinct from MAX_JANICE_ITERATIONS (outer contract resume loop).
 */
export const INFER_TOOLS_CHAT_MAX_ITERATIONS = 8;
/** Gate 0 T4 — matches AgentOrchestrator SUBCOMMITTEE_SIZE native lane */
export const JANICE_ROUND_BUFFER_MULTIPLIER = 3;
/** Gate 0 — minimum budget covers two Janice iterations */
export const MIN_TRUSTLESS_BUDGET_MULTIPLIER = 2;
export const JANICE_SOMNIA_AGENT_ID = 12847293847561029384n;
