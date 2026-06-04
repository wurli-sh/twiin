import type { Env } from "./env";

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type ModelPricing = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheWriteMultiplier: number;
  cacheReadPerMillionUsd: number;
};

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillionUsd: 1,
  outputPerMillionUsd: 5,
  cacheWriteMultiplier: 1.25,
  cacheReadPerMillionUsd: 0.1,
};

const pricingByModel: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": DEFAULT_PRICING,
};

let anthropicSpendUsd = 0;
let warnedLowBudget = false;

export function createAnthropicBudgetGuard(
  env: Pick<
    Env,
    | "ANTHROPIC_BUDGET_TOTAL_USD"
    | "ANTHROPIC_WARN_REMAINING_USD"
    | "ANTHROPIC_HARD_STOP_REMAINING_USD"
  >,
) {
  return {
    ensureRequestAllowed(): void {
      const remaining = env.ANTHROPIC_BUDGET_TOTAL_USD - anthropicSpendUsd;
      if (remaining <= env.ANTHROPIC_HARD_STOP_REMAINING_USD) {
        throw new Error(
          `anthropic budget hard stop reached: $${remaining.toFixed(2)} remaining`,
        );
      }
      if (!warnedLowBudget && remaining <= env.ANTHROPIC_WARN_REMAINING_USD) {
        warnedLowBudget = true;
        console.warn(
          `[budget] Anthropic budget low: $${remaining.toFixed(2)} remaining`,
        );
      }
    },
    recordUsage(usage: unknown, model: string): void {
      const pricing = pricingByModel[model] ?? DEFAULT_PRICING;
      anthropicSpendUsd += estimateUsageCost(usage as AnthropicUsage, pricing);
    },
    noteFailure(error: unknown): void {
      console.warn("[budget] Anthropic request failed:", String(error));
    },
    getSpendUsd(): number {
      return anthropicSpendUsd;
    },
  };
}

function estimateUsageCost(usage: AnthropicUsage, pricing: ModelPricing): number {
  if (!usage) return 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  return (
    (input / 1_000_000) * pricing.inputPerMillionUsd +
    (output / 1_000_000) * pricing.outputPerMillionUsd +
    (cacheWrite / 1_000_000) *
      pricing.inputPerMillionUsd *
      pricing.cacheWriteMultiplier +
    (cacheRead / 1_000_000) * pricing.cacheReadPerMillionUsd
  );
}
