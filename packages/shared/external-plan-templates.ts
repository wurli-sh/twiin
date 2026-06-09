import { NativeConfigId } from "./constants";
import type { PlanStepTemplate, PlanTemplate } from "./plan-templates";

/** Registered external agent names — resolve to configId at plan time, never by capability alone. */
export const ExternalAgentName = {
  DOCS_LENS: "docs-lens",
  REACTIVITY_LENS: "reactivity-lens",
  DREAMDEX_MCP: "dreamdex-mcp",
  ONCHAIN_LENS: "onchain-lens",
  RECEIPT_AUDITOR: "receipt-auditor",
  BRIEFSMITH: "briefsmith",
} as const;

export type ExternalAgentNameValue =
  (typeof ExternalAgentName)[keyof typeof ExternalAgentName];

export type ConsolePlanTemplate = PlanTemplate & { minBudgetStt?: string };

export type ResolvedPlanStep = {
  configId: number;
  payload: string;
  maxCostWei: string;
  timeoutSeconds: number;
};

const SOMNIA_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true";

function oracleStep(selector: string): PlanStepTemplate {
  return {
    configId: NativeConfigId.ORACLE,
    payload: JSON.stringify({ url: SOMNIA_PRICE_URL, selector }),
    maxCostWei: "0",
    timeoutSeconds: 90,
  };
}

const ANALYSIS_CORROBORATE =
  "Corroborate ONLY prior step outputs. Compare sources; if key numerics or narratives disagree materially, confidence <= 50. If they agree, confidence >= 75. Output JSON: {confidence, summary, agreementNotes, risks}. Never invent facts.";

const BRIEFSMITH_PAYLOAD =
  "Synthesize the prior agent outputs into a structured executive brief. Your primary job is to answer the user's question using the collected data and draw a clear, data-driven conclusion. Include sections: Executive Summary, Key Metrics, Conclusion (direct answer to the question), Corroboration Notes, Risks & Gaps, Confidence Score, Sources. Use ONLY the prior context below. Markdown only. Never invent numbers or dates. If the prior context contains a healthScore or confidence score, surface it prominently in the conclusion.";

export function resolveTemplateSteps(
  steps: PlanStepTemplate[],
  configIdByName: ReadonlyMap<string, number>,
): ResolvedPlanStep[] | null {
  const resolved: ResolvedPlanStep[] = [];
  for (const step of steps) {
    let configId = step.configId;
    if (step.agentName) {
      const mapped = configIdByName.get(step.agentName);
      if (mapped == null) return null;
      configId = mapped;
    }
    if (configId == null || configId < 0) return null;
    resolved.push({
      configId,
      payload: step.payload,
      maxCostWei: step.maxCostWei,
      timeoutSeconds: step.timeoutSeconds,
    });
  }
  return resolved;
}

export function buildConfigIdByName(
  agents: ReadonlyArray<{ name: string; configId: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const agent of agents) {
    map.set(agent.name, agent.configId);
    const stripped = agent.name.replace(/@twiin$/i, "");
    if (stripped !== agent.name) {
      map.set(stripped, agent.configId);
    }
    if (!agent.name.toLowerCase().endsWith("@twiin")) {
      map.set(`${agent.name}@twiin`, agent.configId);
    }
  }
  return map;
}

export function isLpRiskOracleGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  const wantsLp = lower.includes("lp") || lower.includes("liquidity");
  const wantsDreamdex = lower.includes("dreamdex");
  return wantsLp && (wantsDreamdex || lower.includes("risk"));
}

export function isLpRiskNativeOracleGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  const wantsNative =
    lower.includes("native oracle") ||
    lower.includes("on-chain oracle") ||
    (lower.includes("on-chain") &&
      (lower.includes("price") || lower.includes("somi") || lower.includes("oracle"))) ||
    (lower.includes("somnia-oracle") && lower.includes("corroborat"));
  return isLpRiskOracleGoal(goal) && wantsNative;
}

const DREAMDEX_COINGECKO_STEP: PlanStepTemplate = {
  agentName: ExternalAgentName.DREAMDEX_MCP,
  payload: JSON.stringify({ action: "coingecko", id: "somnia" }),
  maxCostWei: "0",
  timeoutSeconds: 120,
};

const LP_DOCS_LENS_STEP: PlanStepTemplate = {
  agentName: ExternalAgentName.DOCS_LENS,
  payload: JSON.stringify({
    question:
      "What are the main LP (liquidity provider) risks on dreamDEX? Include slippage, impermanent loss, liquidity depth, and smart contract risks.",
    docPath: "readme",
  }),
  maxCostWei: "0",
  timeoutSeconds: 120,
};

const LP_ANALYSIS_STEP: PlanStepTemplate = {
  configId: NativeConfigId.ANALYSIS,
  payload: `${ANALYSIS_CORROBORATE} Focus on LP risk for dreamDEX.`,
  maxCostWei: "0",
  timeoutSeconds: 120,
};

const LP_BRIEFSMITH_STEP: PlanStepTemplate = {
  agentName: ExternalAgentName.BRIEFSMITH,
  payload: BRIEFSMITH_PAYLOAD,
  maxCostWei: "0",
  timeoutSeconds: 120,
};

const LP_DREAMDEX_ORDERBOOK_STEP: PlanStepTemplate = {
  agentName: ExternalAgentName.DREAMDEX_MCP,
  payload: JSON.stringify({ action: "orderbook", pair: "SOMI/USDC" }),
  maxCostWei: "0",
  timeoutSeconds: 120,
};

export function isEcosystemHealthGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return (
    lower.includes("ecosystem") &&
    (lower.includes("health") || lower.includes("score"))
  );
}

export function isReceiptAuditGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  if (lower.includes("receipt") && lower.includes("audit")) return true;
  return (
    lower.includes("consensus") &&
    (lower.includes("receipt") ||
      lower.includes("agent job") ||
      lower.includes("validator"))
  );
}

export function isChainActivityGoal(goal: string): boolean {
  if (isLpRiskOracleGoal(goal)) return false;
  const lower = goal.toLowerCase();
  const wantsNetwork = lower.includes("network") || lower.includes("somnia");
  const wantsActivity =
    lower.includes("on-chain") ||
    lower.includes("onchain") ||
    lower.includes("chain activity") ||
    lower.includes("pulse") ||
    lower.includes("happening");
  return wantsActivity && wantsNetwork;
}

export function buildLpRiskOracleTemplate(): ConsolePlanTemplate {
  return {
    label: "lp-risk-oracle",
    verificationTier: "corroborated",
    minBudgetStt: "4",
    steps: [
      LP_DREAMDEX_ORDERBOOK_STEP,
      LP_DOCS_LENS_STEP,
      DREAMDEX_COINGECKO_STEP,
      LP_ANALYSIS_STEP,
      LP_BRIEFSMITH_STEP,
    ],
  };
}

export function buildLpRiskNativeOracleTemplate(): ConsolePlanTemplate {
  return {
    label: "lp-risk-native-oracle",
    verificationTier: "corroborated",
    minBudgetStt: "4",
    steps: [
      LP_DREAMDEX_ORDERBOOK_STEP,
      LP_DOCS_LENS_STEP,
      oracleStep("somnia.usd"),
      LP_ANALYSIS_STEP,
      LP_BRIEFSMITH_STEP,
    ],
  };
}

export function buildEcosystemHealthTemplate(): ConsolePlanTemplate {
  return {
    label: "ecosystem-health",
    verificationTier: "corroborated",
    minBudgetStt: "2.5",
    steps: [
      {
        agentName: ExternalAgentName.DOCS_LENS,
        payload: JSON.stringify({
          question: "What agents, oracles, LLM inference, and developer tools does Somnia offer? List agent capabilities including JSON API requests, LLM parse website, consensus, receipts, gas fees, and infrastructure details.",
          docPath: "agents/readme",
        }),
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      {
        agentName: ExternalAgentName.REACTIVITY_LENS,
        payload: JSON.stringify({ lookbackBlocks: 1000 }),
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      DREAMDEX_COINGECKO_STEP,
      {
        configId: NativeConfigId.ANALYSIS,
        payload: `${ANALYSIS_CORROBORATE}
Rules for this analysis:
- If a step returned an error or no data, note it in agreementNotes — do not invent data to fill gaps.
- Score ecosystem health based on SOLELY the data received:
  - 0-25: no data or all sources errored
  - 26-50: only 1 data source available, limited information
  - 51-75: 2+ sources with corroborating data
  - 76-100: multiple rich sources agreeing strongly
- If no prior step data exists, output {confidence:0, summary:"No data available — pipeline produced no results", agreementNotes:"All prior steps returned empty", risks:["Complete data failure"], healthScore:0}
Output JSON must include: {confidence, summary, agreementNotes, risks, healthScore}. Never fabricate numbers.`,
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      {
        agentName: ExternalAgentName.BRIEFSMITH,
        payload: BRIEFSMITH_PAYLOAD,
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

export function buildReceiptAuditTemplate(): ConsolePlanTemplate {
  return {
    label: "receipt-audit",
    verificationTier: "single",
    minBudgetStt: "2.5",
    steps: [
      {
        agentName: ExternalAgentName.RECEIPT_AUDITOR,
        payload: JSON.stringify({ receiptId: "latest" }),
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      {
        configId: NativeConfigId.ANALYSIS,
        payload:
          "Audit the receipt forensics output. Rate validator consensus quality 0-100. Output JSON: {confidence, consensusQuality, summary, gaps}.",
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      {
        agentName: ExternalAgentName.BRIEFSMITH,
        payload: BRIEFSMITH_PAYLOAD,
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

export function buildChainActivityTemplate(): ConsolePlanTemplate {
  return {
    label: "chain-activity",
    verificationTier: "corroborated",
    minBudgetStt: "3.5",
    steps: [
      {
        agentName: ExternalAgentName.ONCHAIN_LENS,
        payload: JSON.stringify({ lookbackHours: 24, minTransferStt: 1000 }),
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      {
        agentName: ExternalAgentName.REACTIVITY_LENS,
        payload: JSON.stringify({ lookbackBlocks: 1000 }),
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      DREAMDEX_COINGECKO_STEP,
      {
        configId: NativeConfigId.ANALYSIS,
        payload: `${ANALYSIS_CORROBORATE} Assess Somnia network activity health.`,
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      {
        agentName: ExternalAgentName.BRIEFSMITH,
        payload: BRIEFSMITH_PAYLOAD,
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

export function buildConsoleGoalTemplates(goal: string): ConsolePlanTemplate[] {
  const templates: ConsolePlanTemplate[] = [];
  if (isLpRiskOracleGoal(goal)) {
    templates.push(
      isLpRiskNativeOracleGoal(goal)
        ? buildLpRiskNativeOracleTemplate()
        : buildLpRiskOracleTemplate(),
    );
  }
  if (isEcosystemHealthGoal(goal)) templates.push(buildEcosystemHealthTemplate());
  if (isReceiptAuditGoal(goal)) templates.push(buildReceiptAuditTemplate());
  if (isChainActivityGoal(goal)) templates.push(buildChainActivityTemplate());
  return templates;
}
