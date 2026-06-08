import { describe, expect, it } from "vitest";
import {
  CONSOLE_PROMPTS,
  formatConsolePromptGoal,
  getHeroPrompt,
  getLowSignalSuggestions,
  getMaxPromptBudgetStt,
  HERO_PROMPT_ID,
  suggestedConsoleBudgetStt,
} from "../console-prompts";
import {
  buildChainActivityTemplate,
  buildEcosystemHealthTemplate,
  buildLpRiskOracleTemplate,
  buildReceiptAuditTemplate,
  isChainActivityGoal,
  isEcosystemHealthGoal,
  isLpRiskOracleGoal,
  isReceiptAuditGoal,
} from "../external-plan-templates";
import { NativeConfigId } from "../constants";

function workflowAgentNames(
  template: ReturnType<typeof buildLpRiskOracleTemplate>,
): string[] {
  const labels: Record<number, string> = {
    [NativeConfigId.WEB_INTEL]: "web-intel",
    [NativeConfigId.ORACLE]: "somnia-oracle",
    [NativeConfigId.ANALYSIS]: "analysis-bot",
  };
  return template.steps.map((step) => {
    if (step.agentName) return step.agentName;
    if (step.configId != null) return labels[step.configId] ?? `native-${step.configId}`;
    return "unknown";
  });
}

describe("console-prompts", () => {
  it("matches console goals exclusively", () => {
    for (const prompt of CONSOLE_PROMPTS) {
      const lp = isLpRiskOracleGoal(prompt.goal);
      const eco = isEcosystemHealthGoal(prompt.goal);
      const rec = isReceiptAuditGoal(prompt.goal);
      const chain = isChainActivityGoal(prompt.goal);
      const count = [lp, eco, rec, chain].filter(Boolean).length;
      expect(count).toBe(1);
    }
    expect(isLpRiskOracleGoal(CONSOLE_PROMPTS.find((p) => p.id === "lp-risk")!.goal)).toBe(true);
    expect(isEcosystemHealthGoal(CONSOLE_PROMPTS.find((p) => p.id === "ecosystem")!.goal)).toBe(
      true,
    );
    expect(isReceiptAuditGoal(CONSOLE_PROMPTS.find((p) => p.id === "receipt")!.goal)).toBe(true);
    expect(isChainActivityGoal(CONSOLE_PROMPTS.find((p) => p.id === "chain")!.goal)).toBe(true);
  });

  it("derives budgetStt from template minBudgetStt", () => {
    expect(CONSOLE_PROMPTS.find((p) => p.id === "lp-risk")?.budgetStt).toBe(
      buildLpRiskOracleTemplate().minBudgetStt,
    );
    expect(CONSOLE_PROMPTS.find((p) => p.id === "ecosystem")?.budgetStt).toBe(
      buildEcosystemHealthTemplate().minBudgetStt,
    );
    expect(CONSOLE_PROMPTS.find((p) => p.id === "receipt")?.budgetStt).toBe(
      buildReceiptAuditTemplate().minBudgetStt,
    );
    expect(CONSOLE_PROMPTS.find((p) => p.id === "chain")?.budgetStt).toBe(
      buildChainActivityTemplate().minBudgetStt,
    );
  });

  it("workflow arrays match external-plan-templates step order", () => {
    const pairs: Array<[string, ReturnType<typeof buildLpRiskOracleTemplate>]> = [
      ["lp-risk", buildLpRiskOracleTemplate()],
      ["ecosystem", buildEcosystemHealthTemplate()],
      ["receipt", buildReceiptAuditTemplate()],
      ["chain", buildChainActivityTemplate()],
    ];
    for (const [id, template] of pairs) {
      const prompt = CONSOLE_PROMPTS.find((p) => p.id === id)!;
      expect(prompt.workflow).toEqual(workflowAgentNames(template));
      expect(prompt.stepCount).toBe(template.steps.length);
    }
  });

  it("formatConsolePromptGoal includes parseable budget suffix", () => {
    for (const prompt of CONSOLE_PROMPTS) {
      const formatted = formatConsolePromptGoal(prompt);
      expect(formatted).toMatch(/Budget:\s*[\d.]+\s*STT$/);
      expect(formatted.startsWith(prompt.goal)).toBe(true);
    }
    expect(getLowSignalSuggestions()).toHaveLength(5);
  });

  it("hero prompt is Network Pulse", () => {
    expect(HERO_PROMPT_ID).toBe("chain");
    expect(getHeroPrompt().id).toBe("chain");
    expect(getHeroPrompt().label).toBe("Network Pulse");
  });

  it("suggestedConsoleBudgetStt prefers console prompt ceiling when affordable", () => {
    expect(getMaxPromptBudgetStt()).toBe(4);
    expect(
      suggestedConsoleBudgetStt({
        maxPerTask: "10",
        dailyCap: "20",
        dailySpent: "0",
        tbaBalance: "15",
      }),
    ).toBe("4.0");
    expect(
      suggestedConsoleBudgetStt({
        maxPerTask: "1",
        dailyCap: "2",
        dailySpent: "0",
        tbaBalance: "5",
      }),
    ).toBe("1.0");
  });
});
