import { describe, expect, it } from "vitest";
import {
  buildChainActivityTemplate,
  buildConfigIdByName,
  buildEcosystemHealthTemplate,
  buildConsoleGoalTemplates,
  buildLpRiskNativeOracleTemplate,
  buildLpRiskOracleTemplate,
  buildReceiptAuditTemplate,
  ExternalAgentName,
  isChainActivityGoal,
  isEcosystemHealthGoal,
  isLpRiskNativeOracleGoal,
  isLpRiskOracleGoal,
  isReceiptAuditGoal,
  resolveTemplateSteps,
} from "../external-plan-templates";
import { MAX_CONSOLE_TEMPLATE_STEPS, MAX_TASK_STEPS, NativeConfigId } from "../constants";

describe("external-plan-templates", () => {
  const configIdByName = buildConfigIdByName([
    { name: ExternalAgentName.DOCS_LENS, configId: 6 },
    { name: ExternalAgentName.DREAMDEX_MCP, configId: 7 },
    { name: ExternalAgentName.ONCHAIN_LENS, configId: 8 },
    { name: ExternalAgentName.RECEIPT_AUDITOR, configId: 9 },
    { name: ExternalAgentName.BRIEFSMITH, configId: 10 },
    { name: ExternalAgentName.REACTIVITY_LENS, configId: 11 },
  ]);

  it("maps @twiin suffix aliases for template agentName resolution", () => {
    const aliases = buildConfigIdByName([{ name: "docs-lens@twiin", configId: 8 }]);
    const resolved = resolveTemplateSteps(
      buildEcosystemHealthTemplate().steps.slice(0, 1),
      aliases,
    );
    expect(resolved).not.toBeNull();
    expect(resolved![0]!.configId).toBe(8);
  });

  it("matches console goal patterns", () => {
    expect(isLpRiskOracleGoal("Assess dreamDEX LP risk for SOMI/USDC")).toBe(true);
    expect(
      isLpRiskNativeOracleGoal(
        "Assess dreamDEX LP risk with native oracle corroboration on-chain",
      ),
    ).toBe(true);
    expect(isLpRiskNativeOracleGoal("Assess dreamDEX LP risk for SOMI/USDC")).toBe(false);
    expect(isEcosystemHealthGoal("Score Somnia ecosystem health")).toBe(true);
    expect(isEcosystemHealthGoal("How healthy is the Somnia ecosystem today?")).toBe(true);
    expect(isReceiptAuditGoal("Audit receipt consensus trail")).toBe(true);
    expect(
      isReceiptAuditGoal(
        "Did the latest Somnia agent job actually reach validator consensus?",
      ),
    ).toBe(true);
    expect(isChainActivityGoal("Summarize Somnia on-chain network activity")).toBe(true);
    expect(isChainActivityGoal("What's happening on Somnia's network right now?")).toBe(
      true,
    );
    expect(
      isLpRiskOracleGoal("How risky is it to provide liquidity on dreamDEX right now?"),
    ).toBe(true);
    expect(
      isLpRiskNativeOracleGoal(
        "How risky is dreamDEX liquidity — and does the live on-chain SOMI price agree?",
      ),
    ).toBe(true);
  });

  it("resolves LP template agentName steps to configIds", () => {
    const resolved = resolveTemplateSteps(
      buildLpRiskOracleTemplate().steps,
      configIdByName,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.map((step) => step.configId)).toEqual([
      7, 6, 7, NativeConfigId.ANALYSIS, 10,
    ]);
    expect(resolved!.some((step) => step.configId === NativeConfigId.ORACLE)).toBe(false);
  });

  it("resolves native LP template with one oracle step", () => {
    const resolved = resolveTemplateSteps(
      buildLpRiskNativeOracleTemplate().steps,
      configIdByName,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.map((step) => step.configId)).toEqual([
      7, 6, NativeConfigId.ORACLE, NativeConfigId.ANALYSIS, 10,
    ]);
    expect(
      resolved!.filter((step) => step.configId === NativeConfigId.ORACLE),
    ).toHaveLength(1);
  });

  it("resolves ecosystem template with docs-lens and reactivity-lens", () => {
    const resolved = resolveTemplateSteps(
      buildEcosystemHealthTemplate().steps,
      configIdByName,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.map((step) => step.configId)).toEqual([
      6,
      11,
      7,
      NativeConfigId.ANALYSIS,
      10,
    ]);
    expect(resolved!.some((step) => step.configId === NativeConfigId.ORACLE)).toBe(
      false,
    );
  });

  it("resolves chain-activity template with reactivity-lens and docs-lens", () => {
    const resolved = resolveTemplateSteps(
      buildChainActivityTemplate().steps,
      configIdByName,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.map((step) => step.configId)).toEqual([
      8,
      11,
      7,
      NativeConfigId.ANALYSIS,
      10,
    ]);
    expect(resolved!.some((step) => step.configId === NativeConfigId.ORACLE)).toBe(
      false,
    );
  });

  it("returns null when an external agent is missing from catalog", () => {
    const partial = buildConfigIdByName([
      { name: ExternalAgentName.DREAMDEX_MCP, configId: 7 },
    ]);
    expect(resolveTemplateSteps(buildLpRiskOracleTemplate().steps, partial)).toBeNull();
  });

  it("builds console goal templates only for matching goals", () => {
    const lp = buildConsoleGoalTemplates("dreamDEX LP risk oracle");
    expect(lp).toHaveLength(1);
    expect(lp[0].label).toBe("lp-risk-oracle");

    const lpNative = buildConsoleGoalTemplates(
      "Assess dreamDEX LP risk with native oracle corroboration",
    );
    expect(lpNative).toHaveLength(1);
    expect(lpNative[0].label).toBe("lp-risk-native-oracle");

    const multi = buildConsoleGoalTemplates(
      "Score Somnia ecosystem health from on-chain network activity and receipt audit",
    );
    expect(multi.map((template) => template.label).sort()).toEqual(
      ["chain-activity", "ecosystem-health", "receipt-audit"].sort(),
    );
  });

  it("uses briefsmith instead of reporter-bot in all console pipelines", () => {
    for (const template of [
      buildLpRiskOracleTemplate(),
      buildLpRiskNativeOracleTemplate(),
      buildEcosystemHealthTemplate(),
      buildReceiptAuditTemplate(),
      buildChainActivityTemplate(),
    ]) {
      expect(template.steps.length).toBeLessThanOrEqual(MAX_CONSOLE_TEMPLATE_STEPS);
      expect(template.steps.length).toBeLessThanOrEqual(MAX_TASK_STEPS);
      const names = template.steps
        .map((step) => step.agentName)
        .filter(Boolean);
      expect(names).toContain(ExternalAgentName.BRIEFSMITH);
      expect(template.steps.every((step) => step.configId !== NativeConfigId.REPORTER)).toBe(
        true,
      );
    }
  });
});
