const AGENT_TYPE_LABELS: Record<string, string> = {
  "dreamdex-mcp": "DreamDEX market",
  "docs-lens": "Somnia docs",
  "reactivity-lens": "Reactivity scan",
  "onchain-lens": "On-chain RPC",
  "receipt-auditor": "Consensus receipts",
  "briefsmith": "Executive brief",
  "external-error": "Agent error",
};

type TopPair = {
  symbol?: string;
  name?: string;
  quote?: string;
  priceUsd?: string;
  liquidityUsd?: number;
  volume24h?: number;
  change24h?: number;
  dex?: string;
  chain?: string;
};

function formatCompactUsd(value?: number | string | null): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatPercent(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function tryParseAgentJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not valid JSON */
  }
  return null;
}

export function resolveAgentDisplayName(label: string, raw?: string): string {
  const parsed = raw ? tryParseAgentJson(raw) : null;
  if (parsed) {
    if (typeof parsed.agentName === "string" && parsed.agentName.trim()) {
      return parsed.agentName.replace(/@twiin$/i, "").trim();
    }
    if (typeof parsed.type === "string") {
      return AGENT_TYPE_LABELS[parsed.type] ?? parsed.type;
    }
  }

  if (/^external-\d+$/i.test(label) && raw) {
    const lower = raw.toLowerCase();
    if (lower.includes("coingecko") || lower.includes("dexscreener") || /~\$/.test(raw)) {
      return AGENT_TYPE_LABELS["dreamdex-mcp"];
    }
    if (lower.includes("scanned blocks") || lower.includes("feedpublished")) {
      return AGENT_TYPE_LABELS["reactivity-lens"];
    }
    if (lower.includes("somnia docs") || lower.includes("agents") && lower.includes("oracles")) {
      return AGENT_TYPE_LABELS["docs-lens"];
    }
    if (lower.includes("rpc") || lower.includes("latest block")) {
      return AGENT_TYPE_LABELS["onchain-lens"];
    }
  }

  return label.replace(/^external-\d+$/i, "Sub-agent");
}

function pairLabel(pair: TopPair | null, fallback?: string): string {
  if (!pair) return fallback ?? "Market";
  const symbol = pair.symbol ?? fallback ?? "Token";
  const quote = pair.quote ? `/${pair.quote}` : "";
  return `${symbol}${quote}`;
}

function dedupeBullets(text: string): string[] {
  const parts = text
    .split(/•/g)
    .map((part) => part.replace(/\*\*/g, "").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique;
}

function formatDreamdexOutput(data: Record<string, unknown>): string {
  const topPair =
    data.topPair && typeof data.topPair === "object" ? (data.topPair as TopPair) : null;
  const pair = typeof data.pair === "string" ? data.pair : undefined;
  const source = typeof data.source === "string" ? data.source : "market";
  const action = typeof data.action === "string" ? data.action : undefined;
  const findings = asStringArray(data.findings).slice(0, 3);
  const lpRiskHints = asStringArray(data.lpRiskHints).slice(0, 2);

  const lines: string[] = [];
  lines.push(`**${pairLabel(topPair, pair)}** · ${source}${action ? ` · ${action}` : ""}`);

  if (topPair) {
    lines.push(
      `- Price: ${topPair.priceUsd ? `$${topPair.priceUsd}` : "—"}`,
      `- Liquidity: ${formatCompactUsd(topPair.liquidityUsd)}`,
      `- 24h volume: ${formatCompactUsd(topPair.volume24h)}`,
      `- 24h change: ${formatPercent(topPair.change24h)}`,
    );
    if (topPair.dex || topPair.chain) {
      lines.push(`- Venue: ${[topPair.dex, topPair.chain].filter(Boolean).join(" · ")}`);
    }
  }

  const somnia =
    data.somnia && typeof data.somnia === "object"
      ? (data.somnia as Record<string, unknown>)
      : null;
  if (somnia) {
    if (typeof somnia.usd === "number") lines.push(`- Spot: $${somnia.usd}`);
    if (typeof somnia.usd_market_cap === "number") {
      lines.push(`- Market cap: ${formatCompactUsd(somnia.usd_market_cap)}`);
    }
    if (typeof somnia.usd_24h_vol === "number") {
      lines.push(`- 24h volume: ${formatCompactUsd(somnia.usd_24h_vol)}`);
    }
    if (typeof somnia.usd_24h_change === "number") {
      lines.push(`- 24h change: ${formatPercent(somnia.usd_24h_change)}`);
    }
  }

  if (findings.length > 0) lines.push("", ...findings.map((f) => `- ${f}`));
  if (lpRiskHints.length > 0) lines.push("", ...lpRiskHints.map((h) => `- ${h}`));

  return lines.join("\n");
}

function formatDocsLensOutput(data: Record<string, unknown>): string {
  const question = typeof data.question === "string" ? data.question : null;
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const findings = asStringArray(data.findings).slice(0, 2);
  const answered = data.answered === true;

  const lines: string[] = [];
  if (question) lines.push(`- Question: ${question}`);
  lines.push(`- Answered: ${answered ? "Yes" : "Needs review"}`);

  const questionKey = question?.toLowerCase().trim();
  const bullets = dedupeBullets(summary)
    .filter((b) => !questionKey || b.toLowerCase().trim() !== questionKey)
    .slice(0, 4);
  if (bullets.length > 0) {
    lines.push("", ...bullets.map((b) => `- ${b.slice(0, 180)}`));
  } else if (findings.length > 0) {
    lines.push("", ...findings.map((f) => `- ${f}`));
  }

  return lines.join("\n");
}

function formatReactivityLensOutput(data: Record<string, unknown>): string {
  const refreshEvents =
    data.refreshEvents && typeof data.refreshEvents === "object"
      ? (data.refreshEvents as Record<string, unknown>)
      : null;

  const lines: string[] = [];
  if (typeof data.fromBlock === "string" && typeof data.latestBlock === "string") {
    lines.push(`- Block window: #${data.fromBlock}–#${data.latestBlock}`);
  }
  if (typeof data.blocksScanned === "number") {
    lines.push(`- Blocks scanned: ${data.blocksScanned.toLocaleString()}`);
  }
  if (refreshEvents) {
    lines.push(
      `- FeedPublished: ${refreshEvents.feedPublished ?? 0}`,
      `- RefreshScheduled: ${refreshEvents.scheduled ?? 0}`,
      `- RefreshSkipped: ${refreshEvents.skipped ?? 0}`,
    );
  }

  const findings = asStringArray(data.findings).slice(0, 2);
  if (findings.length > 0) lines.push("", ...findings.map((f) => `- ${f}`));

  return lines.join("\n");
}

function formatOnchainLensOutput(data: Record<string, unknown>): string {
  const lines: string[] = [];
  if (typeof data.latestBlock === "number" || typeof data.latestBlock === "string") {
    lines.push(`- Latest block: ${data.latestBlock}`);
  }
  if (typeof data.blockWindow === "number") lines.push(`- Blocks sampled: ${data.blockWindow}`);
  if (typeof data.avgTxPerBlock === "number") lines.push(`- Avg tx/block: ${data.avgTxPerBlock}`);
  if (typeof data.largeTransferCount === "number") {
    lines.push(`- Large transfers: ${data.largeTransferCount}`);
  }
  const summary = typeof data.summary === "string" ? data.summary : null;
  if (summary) lines.push(`- ${summary}`);
  return lines.join("\n");
}

function formatPlainSummary(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const priceMatch = trimmed.match(/(\w+)\s+~\$([0-9.]+)\s+\(([^)]+)\)/i);
  if (priceMatch) {
    return [
      `- Token: ${priceMatch[1]}`,
      `- Price: $${priceMatch[2]}`,
      `- Source: ${priceMatch[3]}`,
    ].join("\n");
  }

  const scanMatch = trimmed.match(
    /Scanned blocks (\d+)–(\d+) \((\d+) blocks\)\.\s*Found (\d+) FeedPublished, (\d+) RefreshScheduled, (\d+) RefreshSkipped\./i,
  );
  if (scanMatch) {
    return [
      `- Block window: #${scanMatch[1]}–#${scanMatch[2]}`,
      `- Blocks scanned: ${Number(scanMatch[3]).toLocaleString()}`,
      `- FeedPublished: ${scanMatch[4]}`,
      `- RefreshScheduled: ${scanMatch[5]}`,
      `- RefreshSkipped: ${scanMatch[6]}`,
    ].join("\n");
  }

  if (trimmed.includes("•")) {
    const bullets = dedupeBullets(trimmed).slice(0, 4);
    if (bullets.length > 0) return bullets.map((b) => `- ${b.slice(0, 180)}`).join("\n");
  }

  if (trimmed.length > 160) {
    return `- ${trimmed.slice(0, 160)}…`;
  }

  return `- ${trimmed}`;
}

export function formatAgentJsonOutput(data: Record<string, unknown>): string | null {
  const type = typeof data.type === "string" ? data.type : "";

  switch (type) {
    case "dreamdex-mcp":
      return formatDreamdexOutput(data);
    case "docs-lens":
      return formatDocsLensOutput(data);
    case "reactivity-lens":
      return formatReactivityLensOutput(data);
    case "onchain-lens":
      return formatOnchainLensOutput(data);
    case "receipt-auditor":
    case "external-error": {
      const findings = asStringArray(data.findings).slice(0, 3);
      const summary = typeof data.summary === "string" ? data.summary : null;
      const error = typeof data.error === "string" ? data.error : null;
      const lines: string[] = [];
      if (summary) lines.push(`- ${summary}`);
      if (error) lines.push(`- ${error.slice(0, 200)}`);
      if (findings.length > 0) lines.push(...findings.map((f) => `- ${f}`));
      return lines.length > 0 ? lines.join("\n") : null;
    }
    default: {
      const summary = typeof data.summary === "string" ? data.summary : null;
      const findings = asStringArray(data.findings).slice(0, 3);
      if (!summary && findings.length === 0) return null;
      const lines = [summary ? `- ${summary}` : ""];
      lines.push(...findings.map((f) => `- ${f}`));
      return lines.filter(Boolean).join("\n");
    }
  }
}

const METRIC_LINE_RE = /^-\s+\*\*(.+?)\*\*:\s*(.+)$/;

export function formatKeyMetricEntry(label: string, payload: string): string {
  const displayName = resolveAgentDisplayName(label, payload);
  const parsed = tryParseAgentJson(payload);
  const body = parsed ? formatAgentJsonOutput(parsed) : formatPlainSummary(payload);
  if (!body) return "";

  return [`### ${displayName}`, body].join("\n");
}

export function formatMetricLine(line: string): string {
  const match = line.trim().match(METRIC_LINE_RE);
  if (!match) return line;

  const formatted = formatKeyMetricEntry(match[1], match[2].trim());
  return formatted || line;
}

export function formatReportSectionContent(content: string, sectionTitle?: string): string {
  if (!content.trim()) return content;

  const isKeyMetrics = sectionTitle?.toLowerCase().includes("key metrics") ?? false;

  if (isKeyMetrics) {
    const blocks = content.split(/\n(?=-\s+\*\*)/).map((b) => b.trim()).filter(Boolean);
    if (blocks.length > 0) {
      const formatted = blocks
        .map((block) => {
          const firstLine = block.split("\n")[0] ?? "";
          const match = firstLine.match(METRIC_LINE_RE);
          if (!match) return block;
          const rest = block.slice(firstLine.length).trim();
          const payload = [match[2].trim(), rest].filter(Boolean).join(" ");
          return formatKeyMetricEntry(match[1], payload);
        })
        .filter(Boolean);
      if (formatted.length > 0) return formatted.join("\n\n");
    }
  }

  const lines = content.split("\n");
  const formatted = lines.map((line) => formatMetricLine(line));
  if (formatted.every((line, i) => line === lines[i])) return content;
  return formatted.join("\n\n");
}
