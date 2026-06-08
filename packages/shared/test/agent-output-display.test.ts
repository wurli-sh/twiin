import { describe, expect, it } from "vitest";
import {
  formatKeyMetricEntry,
  formatReportSectionContent,
  resolveAgentDisplayName,
} from "../agent-output-display";

describe("resolveAgentDisplayName", () => {
  it("uses agentName from JSON instead of external-N", () => {
    const raw = JSON.stringify({
      type: "dreamdex-mcp",
      agentName: "dreamdex-mcp@twiin",
      source: "coingecko",
      somnia: { usd: 0.113896 },
      findings: ["somnia ~$0.113896 (CoinGecko)"],
    });
    expect(resolveAgentDisplayName("external-7", raw)).toBe("dreamdex-mcp");
  });

  it("infers agent type from plain summary text", () => {
    expect(
      resolveAgentDisplayName(
        "external-10",
        "Scanned blocks 403967009–403968009 (1001 blocks). Found 0 FeedPublished, 0 RefreshScheduled, 0 RefreshSkipped.",
      ),
    ).toBe("Reactivity scan");
  });
});

describe("formatKeyMetricEntry", () => {
  it("renders structured market metrics instead of opaque labels", () => {
    const raw = JSON.stringify({
      type: "dreamdex-mcp",
      agentName: "dreamdex-mcp@twiin",
      source: "coingecko",
      somnia: { usd: 0.113896, usd_24h_change: -1.2 },
      findings: ["somnia ~$0.113896 (CoinGecko)"],
    });

    const formatted = formatKeyMetricEntry("external-7", raw);
    expect(formatted).toContain("### dreamdex-mcp");
    expect(formatted).toContain("Spot: $0.113896");
    expect(formatted).not.toContain("external-7");
  });

  it("dedupes docs bullet soup into readable bullets", () => {
    const raw = JSON.stringify({
      type: "docs-lens",
      agentName: "docs-lens@twiin",
      question: "What agents, oracles, and dev tools does Somnia expose?",
      answered: true,
      summary:
        "• What agents, oracles, and dev tools does Somnia expose?\n• What agents, oracles, and dev tools does Somnia expose?\n• Agents (Somnia Agents)\n• JSON API Request",
    });

    const formatted = formatKeyMetricEntry("external-8", raw);
    expect(formatted).toContain("### docs-lens");
    expect(formatted).toContain("Question:");
    expect(formatted).not.toContain("external-8");
    expect(formatted).toContain("Agents (Somnia Agents)");
    expect(formatted).not.toMatch(/- What agents.*\n- What agents/s);
  });
});

describe("formatReportSectionContent", () => {
  it("formats fallback brief key metrics with agent headings", () => {
    const content = [
      '- **external-8**: • What agents, oracles, and dev tools does Somnia expose? • What agents, oracles, and dev tools does Somnia expose? • Agents (Somnia Agents)',
      '- **external-10**: Scanned blocks 403967009–403968009 (1001 blocks). Found 0 FeedPublished, 0 RefreshScheduled, 0 RefreshSkipped.',
      '- **external-7**: somnia ~$0.113896 (CoinGecko)',
    ].join("\n");

    const formatted = formatReportSectionContent(content, "Key Metrics");
    expect(formatted).toContain("### Somnia docs");
    expect(formatted).toContain("### Reactivity scan");
    expect(formatted).toContain("### DreamDEX market");
    expect(formatted).not.toContain("external-7");
  });
});
