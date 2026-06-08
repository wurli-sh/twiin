import { AgentLane, CapabilityId, NativeConfigId } from "./constants";

export type AgentLaneLabel = "native" | "external";

export type AgentCandidate = {
  configId: number;
  lane: AgentLaneLabel;
  name: string;
  exactCostWei: bigint;
  capabilities: string[];
  capabilityNames: string[];
  healthy: boolean;
  rank: number;
  isActive: boolean;
  suspended: boolean;
};

/** Native configId → primary capability bytes32 (matches on-chain registry). */
export const NATIVE_CONFIG_CAPABILITIES: Record<number, string> = {
  [NativeConfigId.WEB_INTEL]: CapabilityId.WEB_SCRAPE,
  [NativeConfigId.ORACLE]: CapabilityId.JSON_FETCH,
  [NativeConfigId.ANALYSIS]: CapabilityId.LLM_ANALYZE,
  [NativeConfigId.REPORTER]: CapabilityId.LLM_REPORT,
};

export const RESERVED_CONFIG_IDS = new Set<number>([
  NativeConfigId.JANICE,
  NativeConfigId.WEB_INTEL,
  NativeConfigId.EXECUTOR,
]);

export function laneLabel(lane: number): AgentLaneLabel {
  return lane === AgentLane.SomniaNative ? "native" : "external";
}

export function isExternalHealthy(input: {
  lane: number;
  isVerified: boolean;
  lastVerifiedAt: number | null;
  nowSeconds: number;
  healthTtlSeconds?: number;
}): boolean {
  if (input.lane !== AgentLane.ExternalHTTP) return true;
  if (input.isVerified) {
    if (input.lastVerifiedAt == null) return true;
    const ttl = input.healthTtlSeconds ?? 300;
    return input.nowSeconds - input.lastVerifiedAt <= ttl;
  }
  return false;
}

export function pickSubstitute(
  candidates: AgentCandidate[],
  configId: number,
  budgetWei: bigint,
  exclude: Set<number> = new Set(),
): AgentCandidate | null {
  const current = candidates.find((c) => c.configId === configId);
  if (!current) return null;

  const capSet = new Set(current.capabilities.map((c) => c.toLowerCase()));
  const webScrape = CapabilityId.WEB_SCRAPE.toLowerCase();
  const ranked = candidates
    .filter(
      (c) =>
        c.configId !== configId &&
        c.configId !== NativeConfigId.WEB_INTEL &&
        !exclude.has(c.configId) &&
        c.healthy &&
        c.isActive &&
        !c.suspended &&
        c.exactCostWei <= budgetWei &&
        !c.capabilities.some((cap) => cap.toLowerCase() === webScrape) &&
        c.capabilities.some((cap) => capSet.has(cap.toLowerCase())),
    )
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(a.exactCostWei - b.exactCostWei),
    );

  return ranked[0] ?? null;
}

export function resolveByCapability(
  candidates: AgentCandidate[],
  capability: string,
  budgetWei: bigint,
): AgentCandidate[] {
  const cap = capability.toLowerCase();
  const webScrape = CapabilityId.WEB_SCRAPE.toLowerCase();
  return candidates
    .filter(
      (c) =>
        c.configId !== NativeConfigId.WEB_INTEL &&
        c.healthy &&
        c.isActive &&
        !c.suspended &&
        c.exactCostWei <= budgetWei &&
        cap !== webScrape &&
        c.capabilities.some((value) => value.toLowerCase() === cap),
    )
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(a.exactCostWei - b.exactCostWei),
    );
}
