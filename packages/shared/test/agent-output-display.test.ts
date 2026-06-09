import { describe, expect, it } from "vitest";
import {
  extractDocsLensFields,
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
    expect(formatted).toContain("Spot: **$0.113896**");
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
    expect(formatted).toContain("Query:");
    expect(formatted).not.toContain("external-8");
    expect(formatted).toContain("Agents (Somnia Agents)");
    expect(formatted).not.toMatch(/- What agents.*\n- What agents/s);
  });

  it("recovers truncated docs-lens JSON into readable bullets", () => {
    const truncated =
      '{"type":"docs-lens","agentName":"docs-lens","question":"What agents does Somnia offer?","answered":true,"summary":"• Overview — Prototype Notice: Somnia Agents is in prototype state and deployed on both Somnia Mainnet (chain ID 5031) and Somnia Testnet (chain ID 50312). Features and APIs may change as development continues.","docPath":"readme","excerpt":"# Overview\\n\\nPrototype Notice: Somnia Agents is in prototype state and deployed on both Somnia Mainnet (chain ID 5031) and Somnia Testnet (chain ID 50312). Features and APIs may change as d';

    const formatted = formatKeyMetricEntry("docs-lens", truncated);
    expect(formatted).toContain("### docs-lens");
    expect(formatted).toContain("Prototype Notice");
    expect(formatted).not.toContain('{"type"');
    expect(formatted).not.toMatch(/as d…/);
  });

  it("shows full docs summary bullets without display truncation", () => {
    const longOverview =
      "Overview — Prototype Notice: Somnia Agents is in prototype state and deployed on both Somnia Mainnet (chain ID 5031) and Somnia Testnet (chain ID 50312). Features and APIs may change as development continues and the platform matures toward production readiness with agents, oracles, and developer tools.";
    const agents =
      "Agents (Somnia Agents) — JSON API Request agents provide structured HTTP endpoints. LLM inference agents support parse-website and consensus workflows.";
    const raw = JSON.stringify({
      type: "docs-lens",
      question: "What agents does Somnia offer?",
      answered: true,
      summary: `• ${longOverview}\n• ${agents}`,
      docPath: "readme",
    });

    const formatted = formatKeyMetricEntry("docs-lens", raw);
    expect(formatted).toContain("**Documentation**");
    expect(formatted).toContain("production readiness");
    expect(formatted).toContain("JSON API Request");
    expect(formatted).not.toMatch(/as d…/);
  });

  it("preserves long overview prose without mid-word truncation at 180 chars", () => {
    const longOverview =
      "Overview — Prototype Notice: Somnia Agents is in prototype state and deployed on both Somnia Mainnet (chain ID 5031) and Somnia Testnet (chain ID 50312). Features and APIs may change as development continues and the platform matures toward production readiness.";
    const raw = JSON.stringify({
      type: "docs-lens",
      question: "What agents does Somnia offer?",
      answered: true,
      summary: `• ${longOverview}`,
      docPath: "readme",
      docUrl: "https://docs.somnia.network/readme.md",
    });

    const formatted = formatKeyMetricEntry("docs-lens", raw);
    expect(formatted).toContain("50312");
    expect(formatted).toContain("production readiness");
    expect(formatted).not.toMatch(/as d…/);
    expect(formatted).toContain("Source: readme");
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

  it("formats Claude-style agent name + JSON blocks", () => {
    const content = [
      "docs-lens",
      '{"type":"docs-lens","question":"What agents?","answered":true,"summary":"• Agents (Somnia Agents)"}',
      "reactivity-lens",
      "Block window: #404585283–#404586283",
      "Blocks scanned: 1,001",
    ].join("\n");

    const formatted = formatReportSectionContent(content, "Key Metrics");
    expect(formatted).toContain("### Somnia docs");
    expect(formatted).toContain("Agents (Somnia Agents)");
    expect(formatted).not.toContain('{"type"');
    expect(formatted).toContain("Block window");
  });

  it("uses friendly agent labels for docs-lens and reactivity-lens headings", () => {
    const content = [
      "docs-lens",
      '{"type":"docs-lens","question":"What agents?","answered":true,"summary":"• Agents (Somnia Agents)"}',
      "reactivity-lens",
      '{"type":"reactivity-lens","fromBlock":"1","latestBlock":"2","blocksScanned":1001,"refreshEvents":{"feedPublished":0,"scheduled":0,"skipped":0},"findings":["Block window: #1–#2 (1001 blocks scanned via eth_getLogs)","Unique agents with feed publishes: 0 (quiet window is valid)"]}',
    ].join("\n");

    const formatted = formatReportSectionContent(content, "Key Metrics");
    expect(formatted).toContain("### Somnia docs");
    expect(formatted).toContain("### Reactivity scan");
    expect(formatted).not.toContain("### docs-lens");
    expect(formatted).not.toMatch(/Block window:.*\n.*Block window:/s);
  });
});

describe("formatKeyMetricEntry plain text", () => {
  it("sanitizes Claude-style bullet prefixes without double bullets", () => {
    const formatted = formatKeyMetricEntry(
      "docs-lens",
      "• Question: What agents does Somnia offer?\n• Overview — Prototype Notice: Somnia Agents is in prototype state.",
    );
    expect(formatted).not.toContain("•");
    expect(formatted).toContain("Overview — Prototype Notice");
  });
});

describe("extractDocsLensFields", () => {
  it("extracts summary and question from truncated JSON", () => {
    const truncated =
      '{"type":"docs-lens","question":"What agents?","answered":true,"summary":"• Overview — Prototype Notice: Somnia Agents is in prototype state","docPath":"readme","excerpt":"# Overview\\n\\nPrototype Notice: Somnia Agents is in prototype state and deployed on both Somnia Mainnet (chain ID 5031) and Somnia Testnet (chain ID 50312). Features and APIs may change as d';

    const fields = extractDocsLensFields(truncated);
    expect(fields?.question).toBe("What agents?");
    expect(fields?.summary).toContain("Overview");
    expect(fields?.answered).toBe(true);
  });
});
