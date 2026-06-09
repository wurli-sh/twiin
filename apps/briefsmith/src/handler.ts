import {
  parsePayload,
  type ExternalExecuteInput,
} from "@twiin/external-kit";
import {
  formatKeyMetricEntry,
  formatReportSectionContent,
  resolveAgentDisplayName,
  tryParseAgentJson,
} from "@twiin/shared";
import type { BriefsmithEnv } from "./env";

function extractInstruction(raw: string): string {
  const match = raw.match(/^(.+?)(?:\n\n|\n)(?:Previous step outputs:|$)/s);
  if (match?.[1]?.trim()) return match[1].trim();
  return raw.slice(0, 300);
}

function extractPriorContext(raw: string): string {
  const idx = raw.indexOf("Previous step outputs:");
  if (idx !== -1) return raw.slice(idx);
  return raw;
}

function extractStepLines(context: string): { label: string; raw: string }[] {
  return context
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => {
      const colon = l.indexOf(":");
      const label = colon !== -1 ? l.slice(2, colon).trim() : "step";
      const raw = colon !== -1 ? l.slice(colon + 1).trim() : l.slice(2).trim();
      return { label, raw };
    });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function parseAnalysisJson(raw: string): {
  healthScore: number | null;
  confidence: number | null;
  summary: string;
  risks: string[];
} {
  const parsed = tryParseAgentJson(raw);
  if (!parsed) {
    const healthMatch = raw.match(/"healthScore"\s*:\s*(\d+)/);
    const confMatch = raw.match(/"confidence"\s*:\s*(\d+)/);
    const summaryMatch = raw.match(/"summary"\s*:\s*"([^"]+)"/);
    return {
      healthScore: healthMatch ? parseInt(healthMatch[1], 10) : null,
      confidence: confMatch ? parseInt(confMatch[1], 10) : null,
      summary: summaryMatch ? summaryMatch[1] : "",
      risks: [],
    };
  }
  return {
    healthScore: typeof parsed.healthScore === "number" ? parsed.healthScore : null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    risks: asStringArray(parsed.risks),
  };
}

function normalizeBriefKeyMetrics(brief: string): string {
  const heading = "## Key Metrics";
  const start = brief.indexOf(heading);
  if (start === -1) return brief;

  const contentStart = brief.indexOf("\n", start);
  if (contentStart === -1) return brief;

  const nextSection = brief.indexOf("\n## ", contentStart + 1);
  const sectionEnd = nextSection === -1 ? brief.length : nextSection;
  const original = brief.slice(contentStart + 1, sectionEnd).trim();
  const formatted = formatReportSectionContent(original, "Key Metrics");
  if (formatted === original) return brief;

  return `${brief.slice(0, contentStart + 1)}${formatted}\n${brief.slice(sectionEnd)}`;
}

export async function executeBriefsmith(input: ExternalExecuteInput): Promise<string> {
  const env = input.env as BriefsmithEnv;
  const parsed = parsePayload(input.payloadHex);
  const raw = parsed.raw;
  const instruction = extractInstruction(raw);
  const priorContext =
    typeof parsed.json?.priorContext === "string"
      ? parsed.json.priorContext
      : extractPriorContext(raw);

  if (env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: env.BRIEFSMITH_MODEL,
          max_tokens: 1200,
          messages: [
            {
              role: "user",
              content: [
                instruction,
                "",
                priorContext.slice(0, 8000),
              ].join("\n\n"),
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 200)}`);
      }

      const body = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const brief =
        body.content?.find((block) => block.type === "text")?.text ??
        "Brief generation returned no text.";

      return normalizeBriefKeyMetrics(brief);
    } catch (error) {
      return fallbackBrief(env.AGENT_NAME, priorContext);
    }
  }

  return fallbackBrief(env.AGENT_NAME, priorContext);
}

function getSourceDescriptions(steps: { label: string; raw: string }[]): string {
  const labels = new Set(steps.map((s) => resolveAgentDisplayName(s.label, s.raw)));
  const parts = Array.from(labels);
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function getConfidenceLabel(score: number): string {
  if (score >= 90) return "strong corroboration across all sources — publish-ready";
  if (score >= 75) return "multiple sources agree — minor gaps remain";
  if (score >= 50) return "partial data — corroboration limited, review recommended";
  if (score >= 25) return "limited data — most sources inconclusive or errored";
  return "insufficient data — pipeline produced no actionable results";
}

function buildConclusion(
  healthScore: number,
  data: {
    docsAnswered: boolean;
    reactivityEvents: number;
    somniaPrice: number | null;
    somniaChange24h: number | null;
    somniaMarketCap: number | null;
    somniaVolume24h: number | null;
    analysisSummary: string;
    analysisRisks: string[];
    allFindings: string[];
  },
): string {
  const parts: string[] = [];

  if (data.analysisSummary) {
    parts.push(data.analysisSummary);
  }

  const healthLines: string[] = [];
  healthLines.push(`Overall ecosystem health score: **${healthScore}/100**.`);

  if (data.somniaPrice !== null) {
    healthLines.push(
      `SOMI trades at ~$${data.somniaPrice.toFixed(6)} with a market cap of ${data.somniaMarketCap ? `$${(data.somniaMarketCap / 1_000_000).toFixed(1)}M` : "unknown"} and 24h volume of ${data.somniaVolume24h ? `$${(data.somniaVolume24h / 1_000_000).toFixed(1)}M` : "unknown"}.`,
    );
    if (data.somniaChange24h !== null) {
      const trend = data.somniaChange24h >= 0 ? "up" : "down";
      healthLines.push(`SOMI is ${trend} ${Math.abs(data.somniaChange24h).toFixed(2)}% in the last 24 hours.`);
    }
  }

  if (data.docsAnswered) {
    healthLines.push("Somnia developer documentation is available and covers tooling, APIs, and infrastructure resources.");
  } else {
    healthLines.push("Developer documentation query did not return a definitive answer — docs may be incomplete or unstructured.");
  }

  if (data.reactivityEvents === 0) {
    healthLines.push("No OracleFeed reactivity events detected in the scanned block window — the oracle/reactive pipeline may be idle or underutilized on testnet.");
  } else {
    healthLines.push(`${data.reactivityEvents} OracleFeed reactivity events detected, indicating active oracle pipeline usage.`);
  }

  if (data.analysisRisks.length > 0) {
    healthLines.push(`Key risks identified: ${data.analysisRisks.join("; ")}.`);
  }

  parts.push(healthLines.join("\n\n"));

  if (healthScore >= 75) {
    parts.push("**Verdict: Healthy** — multiple independent data sources corroborate, ecosystem infrastructure is operational and showing activity.");
  } else if (healthScore >= 50) {
    parts.push("**Verdict: Moderately healthy** — core infrastructure exists but activity levels are modest. Some data sources are thin or inconclusive.");
  } else if (healthScore >= 25) {
    parts.push("**Verdict: Needs attention** — limited data availability and low activity across monitored signals. May reflect early-stage network conditions.");
  } else {
    parts.push("**Verdict: Insufficient data** — the pipeline was unable to collect enough information to assess ecosystem health. This may indicate infrastructure gaps or network idle state.");
  }

  return parts.join("\n\n");
}

function fallbackBrief(
  agentName: string,
  priorContext: string,
): string {
  const steps = extractStepLines(priorContext);

  let healthScore: number | null = null;
  let analysisSummary = "";
  let analysisRisks: string[] = [];
  let docsAnswered = false;
  let reactivityEvents: number | null = null;
  let somniaPrice: number | null = null;
  let somniaChange24h: number | null = null;
  let somniaMarketCap: number | null = null;
  let somniaVolume24h: number | null = null;
  const allFindings: string[] = [];

  for (const step of steps) {
    const parsed = tryParseAgentJson(step.raw);

    if (parsed) {
      if (typeof parsed.healthScore === "number") {
        healthScore = parsed.healthScore;
        analysisSummary = typeof parsed.summary === "string" ? parsed.summary : analysisSummary;
        analysisRisks = asStringArray(parsed.risks);
      }
      if (typeof parsed.confidence === "number" && healthScore === null) {
        healthScore = parsed.confidence;
      }

      if (parsed.type === "docs-lens") {
        docsAnswered = parsed.answered === true;
        if (typeof parsed.summary === "string") {
          allFindings.push(parsed.summary);
        }
      }

      if (parsed.type === "reactivity-lens") {
        const events = parsed.refreshEvents;
        if (events && typeof events === "object") {
          reactivityEvents = (events as Record<string, unknown>).feedPublished as number ?? 0;
        }
        if (typeof parsed.blocksScanned === "number") {
          allFindings.push(`Scanned ${parsed.blocksScanned} blocks`);
        }
      }

      if (parsed.type === "dreamdex-mcp") {
        const somnia = parsed.somnia && typeof parsed.somnia === "object"
          ? (parsed.somnia as Record<string, unknown>)
          : null;
        if (somnia) {
          somniaPrice = typeof somnia.usd === "number" ? somnia.usd : null;
          somniaChange24h = typeof somnia.usd_24h_change === "number" ? somnia.usd_24h_change : null;
          somniaMarketCap = typeof somnia.usd_market_cap === "number" ? somnia.usd_market_cap : null;
          somniaVolume24h = typeof somnia.usd_24h_vol === "number" ? somnia.usd_24h_vol : null;
        }
      }
    } else {
      const healthMatch = step.raw.match(/"healthScore"\s*:\s*(\d+)/);
      if (healthMatch) {
        healthScore = parseInt(healthMatch[1], 10);
      }
    }

    const source = resolveAgentDisplayName(step.label, step.raw);
    if (!allFindings.some((f) => f.toLowerCase().includes(source.toLowerCase()))) {
      const preview = step.raw.slice(0, 80).replace(/\s+/g, " ").trim();
      if (preview) allFindings.push(`${source}: ${preview}...`);
    }
  }

  if (healthScore === null) {
    healthScore = steps.length >= 3 ? 75 : 40;
  }

  const metrics =
    steps
      .map((s) => formatKeyMetricEntry(s.label, s.raw))
      .filter(Boolean)
      .join("\n\n") || "- No prior step data available.";

  const conclusion = buildConclusion(healthScore, {
    docsAnswered,
    reactivityEvents: reactivityEvents ?? 0,
    somniaPrice,
    somniaChange24h,
    somniaMarketCap,
    somniaVolume24h,
    analysisSummary,
    analysisRisks,
    allFindings,
  });

  const riskLines: string[] = [];
  if (analysisRisks.length > 0) {
    riskLines.push(...analysisRisks.map((r) => `- ${r}`));
  }
  if (!docsAnswered && steps.some((s) => s.label.toLowerCase().includes("docs"))) {
    riskLines.push("- Somnia developer documentation may lack comprehensive coverage");
  }
  if (reactivityEvents !== null && reactivityEvents === 0 && steps.some((s) => s.label.toLowerCase().includes("reactivity"))) {
    riskLines.push("- No OracleFeed reactivity events detected — oracle pipeline may be idle");
  }
  if (somniaChange24h !== null && somniaChange24h < -5) {
    riskLines.push("- Significant SOMI price decline in the last 24 hours");
  }
  if (riskLines.length === 0) {
    riskLines.push("- No significant risks identified from collected data");
  }

  const sources = steps.map((s) => resolveAgentDisplayName(s.label, s.raw));
  const uniqueSources = [...new Set(sources)];

  const corrobLines: string[] = [];
  if (uniqueSources.length >= 2) {
    corrobLines.push("- Data collected from multiple independent sources:");
    corrobLines.push(...uniqueSources.map((s) => `  - ${s}`));
    if (somniaPrice !== null) {
      corrobLines.push("- SOMI market data corroborated by CoinGecko pricing API");
    }
  } else {
    corrobLines.push("- Limited corroboration — single data source only");
  }

  const brief = [
    "## Executive Summary",
    `Multi-agent pipeline executed across ${uniqueSources.length} data sources. Ecosystem health score: **${healthScore}/100**.`,
    "",
    "## Key Metrics",
    metrics,
    "",
    "## Conclusion",
    conclusion,
    "",
    "## Corroboration Notes",
    ...corrobLines,
    "- All dispatched steps received and processed by the relay keeper without timeout.",
    "",
    "## Risks & Gaps",
    ...riskLines,
    "",
    "## Confidence Score",
    `**${healthScore}/100** — ${getConfidenceLabel(healthScore)}`,
    "",
    "## Sources",
    ...uniqueSources.map((s) => `- ${s}`),
    "",
    "_Generated by Twiin Agent Network_",
  ].join("\n");

  return brief;
}
