import { NativeConfigId } from "./constants";

export type PlanStepTemplate = {
  configId: number;
  payload: string;
  maxCostWei: string;
  timeoutSeconds: number;
};

export type PlanTemplate = {
  steps: PlanStepTemplate[];
  verificationTier: "corroborated" | "single";
  label: string;
};

function isResearchGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return (
    lower.includes("research") ||
    lower.includes("analyze") ||
    lower.includes("analysis") ||
    lower.includes("should i") ||
    lower.includes("lp") ||
    lower.includes("invest") ||
    lower.includes("evaluate")
  );
}

function isPriceStatsGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return (
    lower.includes("price") ||
    lower.includes("stats") ||
    lower.includes("market cap") ||
    lower.includes("volume") ||
    lower.includes("token")
  );
}

export function buildResearchTemplate(goal: string): PlanTemplate {
  return {
    label: "research",
    verificationTier: "single",
    steps: [
      {
        configId: NativeConfigId.ANALYSIS,
        payload: `Analyze the following goal and produce structured insights using only publicly knowable facts. Goal: ${goal}`,
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
      {
        configId: NativeConfigId.REPORTER,
        payload:
          "Write a concise report for the user using ONLY prior step outputs. If key facts are unavailable, say unavailable instead of guessing.",
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

export function buildPriceStatsTemplate(goal: string): PlanTemplate {
  return {
    label: "price-stats",
    verificationTier: "single",
    steps: [
      {
        configId: NativeConfigId.ORACLE,
        payload: JSON.stringify({
          url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true",
          selector: "bitcoin.usd",
          decimals: 8,
        }),
        maxCostWei: "0",
        timeoutSeconds: 90,
      },
      {
        configId: NativeConfigId.REPORTER,
        payload: `Summarize price/stats findings for the user goal using ONLY prior step outputs. Goal context: ${goal.slice(0, 400)}`,
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

export function buildBestEffortTemplate(goal: string): PlanTemplate {
  return {
    label: "best-effort",
    verificationTier: "single",
    steps: [
      {
        configId: NativeConfigId.ANALYSIS,
        payload: `Best-effort response within budget for: ${goal}. Use only verifiable facts. If unavailable, say unavailable.`,
        maxCostWei: "0",
        timeoutSeconds: 120,
      },
    ],
  };
}

/** Generic deterministic fallbacks when LLM planning fails or exceeds budget. */
export function buildGenericTemplates(goal: string): PlanTemplate[] {
  const templates: PlanTemplate[] = [];
  if (isResearchGoal(goal)) templates.push(buildResearchTemplate(goal));
  if (isPriceStatsGoal(goal)) templates.push(buildPriceStatsTemplate(goal));
  templates.push(buildBestEffortTemplate(goal));
  return templates;
}
