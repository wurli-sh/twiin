import { describe, expect, it } from "vitest";
import {
  isExternalHealthy,
  pickSubstitute,
  resolveByCapability,
  type AgentCandidate,
} from "../agent-catalog";
import { AgentLane, CapabilityId } from "../constants";

const base = (overrides: Partial<AgentCandidate>): AgentCandidate => ({
  configId: 1,
  lane: "native",
  name: "web-intel",
  exactCostWei: 100n,
  capabilities: [CapabilityId.WEB_SCRAPE],
  capabilityNames: ["web.scrape"],
  healthy: true,
  rank: 0,
  isActive: true,
  suspended: false,
  ...overrides,
});

describe("agent-catalog", () => {
  it("marks external agents unhealthy when verification is stale", () => {
    const now = 1_000_000;
    expect(
      isExternalHealthy({
        lane: AgentLane.ExternalHTTP,
        isVerified: true,
        lastVerifiedAt: now - 400,
        nowSeconds: now,
        healthTtlSeconds: 300,
      }),
    ).toBe(false);
  });

  it("does not substitute web.scrape agents to other scrapers", () => {
    const candidates = [
      base({ configId: 1, exactCostWei: 200n }),
      base({
        configId: 7,
        lane: "external",
        name: "ext-scraper",
        exactCostWei: 150n,
        rank: 1,
      }),
    ];
    const alt = pickSubstitute(candidates, 1, 160n);
    expect(alt).toBeNull();
  });

  it("picks substitute by shared capability within budget", () => {
    const candidates = [
      base({
        configId: 2,
        capabilities: [CapabilityId.JSON_FETCH],
        capabilityNames: ["json.fetch"],
        exactCostWei: 200n,
      }),
      base({
        configId: 3,
        capabilities: [CapabilityId.JSON_FETCH],
        capabilityNames: ["json.fetch"],
        exactCostWei: 150n,
        rank: 1,
      }),
    ];
    const alt = pickSubstitute(candidates, 2, 160n);
    expect(alt?.configId).toBe(3);
  });

  it("resolves by capability sorted by rank", () => {
    const candidates = [
      base({ configId: 2, capabilities: [CapabilityId.JSON_FETCH], rank: 2 }),
      base({ configId: 3, capabilities: [CapabilityId.JSON_FETCH], rank: 0 }),
    ];
    const resolved = resolveByCapability(
      candidates,
      CapabilityId.JSON_FETCH,
      500n,
    );
    expect(resolved.map((c) => c.configId)).toEqual([3, 2]);
  });
});
