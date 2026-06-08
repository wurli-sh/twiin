import { NativeConfigId } from "./constants";
import { ExternalAgentName } from "./external-plan-templates";
import {
  buildChainActivityTemplate,
  buildEcosystemHealthTemplate,
  buildLpRiskNativeOracleTemplate,
  buildLpRiskOracleTemplate,
  buildReceiptAuditTemplate,
  type ConsolePlanTemplate,
} from "./external-plan-templates";

export type ConsolePromptId =
  | "lp-risk"
  | "lp-risk-native"
  | "ecosystem"
  | "receipt"
  | "chain";

export type ConsolePromptLanes = {
  reach: string[];
  trust: string[];
  format: string;
};

export type ConsolePromptDef = {
  id: ConsolePromptId;
  label: string;
  goal: string;
  budgetStt: string;
  stepCount: number;
  templateLabel: string;
  description: string;
  workflow: string[];
  lanes: ConsolePromptLanes;
  displayOrder: number;
};

export const CONSOLE_MAX_PROMPT_BUDGET_STT = "4.5";
export const CONSOLE_MIN_POLICY_STT = 5;
export const HERO_PROMPT_ID: ConsolePromptId = "chain";

const NATIVE_STEP_LABELS: Record<number, string> = {
  [NativeConfigId.WEB_INTEL]: "web-intel",
  [NativeConfigId.ORACLE]: "somnia-oracle",
  [NativeConfigId.ANALYSIS]: "analysis-bot",
  [NativeConfigId.REPORTER]: "reporter-bot",
};

function workflowFromTemplate(template: ConsolePlanTemplate): string[] {
  return template.steps.map((step) => {
    if (step.agentName) return step.agentName;
    if (step.configId != null) {
      return NATIVE_STEP_LABELS[step.configId] ?? `native-${step.configId}`;
    }
    return "unknown";
  });
}

function lanesFromWorkflow(workflow: string[]): ConsolePromptLanes {
  const trustAgents = new Set(["somnia-oracle", "analysis-bot"]);
  const reach: string[] = [];
  const trust: string[] = [];
  let format = "briefsmith";

  for (const name of workflow) {
    if (name === ExternalAgentName.BRIEFSMITH) {
      format = name;
      continue;
    }
    if (trustAgents.has(name)) {
      if (!trust.includes(name)) trust.push(name);
    } else {
      if (!reach.includes(name)) reach.push(name);
    }
  }

  return { reach, trust, format };
}

function defFromTemplate(
  id: ConsolePromptId,
  label: string,
  goal: string,
  template: ConsolePlanTemplate,
  description: string,
  displayOrder: number,
): ConsolePromptDef {
  const workflow = workflowFromTemplate(template);
  return {
    id,
    label,
    goal,
    budgetStt: template.minBudgetStt ?? "1",
    stepCount: workflow.length,
    templateLabel: template.label,
    description,
    workflow,
    lanes: lanesFromWorkflow(workflow),
    displayOrder,
  };
}

const LP_TEMPLATE = buildLpRiskOracleTemplate();
const LP_NATIVE_TEMPLATE = buildLpRiskNativeOracleTemplate();
const ECOSYSTEM_TEMPLATE = buildEcosystemHealthTemplate();
const RECEIPT_TEMPLATE = buildReceiptAuditTemplate();
const CHAIN_TEMPLATE = buildChainActivityTemplate();

export const CONSOLE_PROMPTS: ConsolePromptDef[] = [
  defFromTemplate(
    "lp-risk",
    "LP Risk Check",
    "How risky is it to provide liquidity on dreamDEX right now?",
    LP_TEMPLATE,
    "Market depth, official docs, and price signals for SOMI/USDC",
    4,
  ),
  defFromTemplate(
    "lp-risk-native",
    "LP Risk + On-chain Price",
    "How risky is dreamDEX liquidity — and does the live on-chain SOMI price agree?",
    LP_NATIVE_TEMPLATE,
    "Same LP risk check with native oracle price verification (slower on testnet)",
    5,
  ),
  defFromTemplate(
    "ecosystem",
    "Ecosystem Health",
    "How healthy is the Somnia ecosystem today?",
    ECOSYSTEM_TEMPLATE,
    "Reactivity feeds, official docs, and token metrics scored 0–100",
    2,
  ),
  defFromTemplate(
    "receipt",
    "Consensus Audit",
    "Did the latest Somnia agent job actually reach validator consensus?",
    RECEIPT_TEMPLATE,
    "Receipt forensics with a 0–100 consensus quality score",
    1,
  ),
  defFromTemplate(
    "chain",
    "Network Pulse",
    "What's happening on Somnia's network right now?",
    CHAIN_TEMPLATE,
    "On-chain activity, reactivity events, and SOMI price in one brief",
    3,
  ),
];

export type ConsoleBudgetAgent = {
  maxPerTask: string;
  dailyCap: string;
  dailySpent: string;
  tbaBalance: string;
};

export function getMaxPromptBudgetStt(): number {
  return Math.max(...CONSOLE_PROMPTS.map((p) => Number(p.budgetStt)));
}

export function maxTaskBudgetSttForAgent(agent: ConsoleBudgetAgent): number {
  const perTask = Number(agent.maxPerTask);
  const dailyLeft = Math.max(0, Number(agent.dailyCap) - Number(agent.dailySpent));
  const wallet = Number(agent.tbaBalance);
  const parts = [perTask, dailyLeft, wallet].filter((n) => n > 0);
  return parts.length ? Math.min(...parts) : 0;
}

/** Suggested console task budget — prefers console prompt ceiling when policy allows. */
export function suggestedConsoleBudgetStt(agent: ConsoleBudgetAgent | null | undefined): string {
  const ceiling = getMaxPromptBudgetStt();
  if (!agent) return CONSOLE_MAX_PROMPT_BUDGET_STT;

  const affordable = maxTaskBudgetSttForAgent(agent);
  if (affordable <= 0) return "1";

  const suggested = Math.min(affordable, ceiling);
  return suggested.toFixed(1);
}

export function formatConsolePromptGoal(prompt: ConsolePromptDef): string {
  return `${prompt.goal} Budget: ${prompt.budgetStt} STT`;
}

export function getLowSignalSuggestions(): string[] {
  return CONSOLE_PROMPTS.map(formatConsolePromptGoal);
}

export function getSuggestedPromptSequence(): ConsolePromptDef[] {
  return [...CONSOLE_PROMPTS].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function getConsolePromptById(id: ConsolePromptId): ConsolePromptDef | undefined {
  return CONSOLE_PROMPTS.find((p) => p.id === id);
}

export function getHeroPrompt(): ConsolePromptDef {
  return getConsolePromptById(HERO_PROMPT_ID) ?? CONSOLE_PROMPTS[0]!;
}

export function formatPromptSubtitle(prompt: ConsolePromptDef): string {
  const reachCount = prompt.lanes.reach.length;
  const trustCount = prompt.lanes.trust.length;
  return `${prompt.stepCount} steps · ${prompt.budgetStt} STT · ${reachCount} reach → briefsmith`;
}

export function promptNeedsPolicyRaise(
  prompt: ConsolePromptDef,
  agent: ConsoleBudgetAgent,
): boolean {
  return Number(prompt.budgetStt) > Number(agent.maxPerTask);
}
