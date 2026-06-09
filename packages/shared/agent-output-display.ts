const GITBOOK_TAG_RE = /\{%[^%]*%\}/g;

function stripGitBookTags(text: string): string {
  return text.replace(GITBOOK_TAG_RE, "").trim();
}

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
  const parsed = raw ? tryRecoverAgentFields(raw) : null;
  if (parsed) {
    if (typeof parsed.agentName === "string" && parsed.agentName.trim()) {
      return parsed.agentName.replace(/@twiin$/i, "").trim();
    }
    if (typeof parsed.type === "string") {
      return AGENT_TYPE_LABELS[parsed.type] ?? parsed.type;
    }
  }

  const normalizedLabel = label.replace(/@twiin$/i, "").trim().toLowerCase();
  if (AGENT_TYPE_LABELS[normalizedLabel]) {
    return AGENT_TYPE_LABELS[normalizedLabel];
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

function trimAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

function normalizeBulletText(text: string): string {
  return text
    .replace(/^[\s•·\-*]+/, "")
    .replace(/^(question|query):\s*/i, "")
    .trim();
}

const DOCS_DISPLAY_MAX_BULLETS = 24;

function formatMarkdownBullet(text: string, max = 400): string {
  return `- ${trimAtWordBoundary(normalizeBulletText(text), max)}`;
}

function formatDocsBullet(text: string): string {
  return `- ${normalizeBulletText(text)}`;
}

function isBareHeadingBullet(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes(" — ")) return false;
  return trimmed.length <= 15 && /^[A-Z][a-zA-Z/-]*$/.test(trimmed);
}

/** Recover docs-lens fields from truncated or malformed JSON strings. */
export function extractDocsLensFields(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.includes('"type"') && !trimmed.includes("docs-lens")) return null;

  const questionMatch = trimmed.match(/"question"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
  const summaryMatch = trimmed.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
  const answeredMatch = trimmed.match(/"answered"\s*:\s*(true|false)/);
  const docPathMatch = trimmed.match(/"docPath"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const docUrlMatch = trimmed.match(/"docUrl"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const agentNameMatch = trimmed.match(/"agentName"\s*:\s*"((?:[^"\\]|\\.)*)"/);

  if (!questionMatch && !summaryMatch && !trimmed.includes("docs-lens")) return null;

  const unescape = (s: string) =>
    s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  const fields: Record<string, unknown> = { type: "docs-lens" };
  if (agentNameMatch) fields.agentName = unescape(agentNameMatch[1]!);
  if (questionMatch) fields.question = unescape(questionMatch[1]!);
  if (summaryMatch) fields.summary = unescape(summaryMatch[1]!);
  if (answeredMatch) fields.answered = answeredMatch[1] === "true";
  if (docPathMatch) fields.docPath = unescape(docPathMatch[1]!);
  if (docUrlMatch) fields.docUrl = unescape(docUrlMatch[1]!);

  return fields;
}

function tryRecoverAgentFields(payload: string): Record<string, unknown> | null {
  const parsed = tryParseAgentJson(payload);
  if (parsed) return parsed;

  const docsFields = extractDocsLensFields(payload);
  if (docsFields) return docsFields;

  const typeMatch = payload.match(/"type"\s*:\s*"([^"]+)"/);
  if (!typeMatch) return null;

  const type = typeMatch[1]!;
  const fields: Record<string, unknown> = { type };

  const strField = (key: string) => {
    const match = payload.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return match ? match[1]!.replace(/\\n/g, "\n").replace(/\\"/g, '"') : undefined;
  };

  for (const key of ["agentName", "question", "summary", "pair", "source", "action"]) {
    const value = strField(key);
    if (value) fields[key] = value;
  }

  const numField = (key: string) => {
    const match = payload.match(new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
    return match ? Number(match[1]) : undefined;
  };

  for (const key of ["blocksScanned", "fromBlock", "latestBlock"]) {
    const value = numField(key);
    if (value != null) fields[key] = value;
  }

  if (payload.includes('"somnia"')) {
    const somniaUsd = payload.match(/"usd"\s*:\s*([\d.]+)/);
    if (somniaUsd) {
      fields.somnia = { usd: Number(somniaUsd[1]) };
    }
  }

  return Object.keys(fields).length > 1 ? fields : null;
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
      `- Price: **${topPair.priceUsd ? `$${topPair.priceUsd}` : "—"}**`,
      `- Liquidity: **${formatCompactUsd(topPair.liquidityUsd)}**`,
      `- 24h volume: **${formatCompactUsd(topPair.volume24h)}**`,
      `- 24h change: **${formatPercent(topPair.change24h)}**`,
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
    if (typeof somnia.usd === "number") lines.push(`- Spot: **$${somnia.usd}**`);
    if (typeof somnia.usd_market_cap === "number") {
      lines.push(`- Market cap: **${formatCompactUsd(somnia.usd_market_cap)}**`);
    }
    if (typeof somnia.usd_24h_vol === "number") {
      lines.push(`- 24h volume: **${formatCompactUsd(somnia.usd_24h_vol)}**`);
    }
    if (typeof somnia.usd_24h_change === "number") {
      lines.push(`- 24h change: **${formatPercent(somnia.usd_24h_change)}**`);
    }
  }

  if (findings.length > 0) lines.push("", ...findings.map((f) => `- ${f}`));
  if (lpRiskHints.length > 0) lines.push("", ...lpRiskHints.map((h) => `- ${h}`));

  return lines.join("\n");
}

function isQuestionDuplicate(bullet: string, question: string | null): boolean {
  if (!question) return false;
  const normalizedBullet = normalizeBulletText(bullet).toLowerCase();
  const questionKey = question.toLowerCase().trim();
  if (!normalizedBullet) return true;
  if (normalizedBullet === questionKey) return true;
  if (normalizedBullet.startsWith(questionKey.slice(0, 40))) return true;
  if (questionKey.startsWith(normalizedBullet.slice(0, 40)) && normalizedBullet.length > 20) {
    return true;
  }
  return false;
}

function isDocsMetaFinding(finding: string): boolean {
  const lower = finding.toLowerCase();
  return (
    lower.startsWith("official somnia docs query:") ||
    (lower.includes("retrieved ") && lower.includes(" chars from ")) ||
    lower.includes("documentation content retrieved but may not fully answer")
  );
}

function formatDocsLensOutput(data: Record<string, unknown>): string {
  const question = typeof data.question === "string" ? data.question : null;
  const summary = typeof data.summary === "string" ? stripGitBookTags(data.summary) : "";
  const findings = asStringArray(data.findings).filter((f) => !isDocsMetaFinding(f));
  const answered = data.answered === true;
  const docPath = typeof data.docPath === "string" ? data.docPath : null;
  const docUrl = typeof data.docUrl === "string" ? data.docUrl : null;

  const lines: string[] = [];
  if (question) lines.push(`- Query: ${question}`);
  lines.push(`- Answered: ${answered ? "Yes" : "Needs review"}`);

  let bullets = dedupeBullets(summary)
    .map((b) => normalizeBulletText(b))
    .filter((b) => b.length > 0 && !isQuestionDuplicate(b, question));

  const hasSubstantive = bullets.some((b) => !isBareHeadingBullet(b));
  if (hasSubstantive) {
    bullets = bullets.filter((b) => !isBareHeadingBullet(b) || bullets.length === 1);
  }

  bullets = bullets.slice(0, DOCS_DISPLAY_MAX_BULLETS);

  if (bullets.length > 0) {
    lines.push("", "**Documentation**", ...bullets.map((b) => formatDocsBullet(b)));
  }

  const extraFindings = findings
    .filter((f) => !bullets.some((b) => b.toLowerCase().includes(f.toLowerCase().slice(0, 40))))
    .slice(0, 3);
  if (extraFindings.length > 0) {
    lines.push("", ...extraFindings.map((f) => formatDocsBullet(f)));
  }

  if (bullets.length === 0 && extraFindings.length === 0 && findings.length > 0) {
    lines.push("", ...findings.map((f) => formatDocsBullet(f)));
  }

  if (docPath || docUrl) {
    const sourceParts = [docPath, docUrl].filter(Boolean);
    lines.push(`- Source: ${sourceParts.join(" · ")}`);
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

  const findings = asStringArray(data.findings)
    .filter((finding) => {
      const lower = finding.toLowerCase();
      if (lower.startsWith("block window:")) return false;
      if (lower.startsWith("events:") && lower.includes("feedpublished")) return false;
      return true;
    })
    .slice(0, 1);
  if (findings.length > 0) lines.push("", ...findings.map((f) => formatMarkdownBullet(f)));

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
  const trimmed = stripGitBookTags(text);
  if (!trimmed) return null;

  const recovered = tryRecoverAgentFields(trimmed);
  if (recovered) {
    const formatted = formatAgentJsonOutput(recovered);
    if (formatted) return formatted;
  }

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
    const bullets = dedupeBullets(trimmed)
      .map((b) => normalizeBulletText(b))
      .filter(Boolean)
      .slice(0, 8);
    if (bullets.length > 0) {
      return bullets.map((b) => formatMarkdownBullet(b)).join("\n");
    }
  }

  if (/^question:\s/i.test(trimmed)) {
    return formatMarkdownBullet(trimmed, 400);
  }

  if (trimmed.length > 400) {
    return formatMarkdownBullet(trimmed, 400);
  }

  return formatMarkdownBullet(trimmed, 400);
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
const AGENT_NAME_LINE_RE = /^([a-z][\w-]*(?:@[\w.-]+)?)\s*$/i;
const AGENT_HEADING_RE = /^#{1,3}\s+(.+)$/;

function extractJsonBlocks(content: string): { label: string; payload: string }[] {
  const blocks: { label: string; payload: string }[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) {
      i += 1;
      continue;
    }

    const metricMatch = line.match(METRIC_LINE_RE);
    if (metricMatch) {
      const restLines: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!.trim();
        if (!next) {
          i += 1;
          continue;
        }
        if (METRIC_LINE_RE.test(next) || AGENT_NAME_LINE_RE.test(next) || AGENT_HEADING_RE.test(next)) {
          break;
        }
        restLines.push(lines[i]!);
        i += 1;
      }
      const payload = [metricMatch[2]!.trim(), ...restLines].filter(Boolean).join(" ");
      blocks.push({ label: metricMatch[1]!, payload });
      continue;
    }

    const headingMatch = line.match(AGENT_HEADING_RE);
    if (headingMatch) {
      const label = headingMatch[1]!.trim();
      const restLines: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!.trim();
        if (!next) {
          i += 1;
          continue;
        }
        if (AGENT_HEADING_RE.test(next) || AGENT_NAME_LINE_RE.test(next) || METRIC_LINE_RE.test(next)) {
          break;
        }
        restLines.push(lines[i]!);
        i += 1;
      }
      if (restLines.length > 0) {
        blocks.push({ label, payload: restLines.join("\n").trim() });
      }
      continue;
    }

    const nameMatch = line.match(AGENT_NAME_LINE_RE);
    if (nameMatch) {
      const label = nameMatch[1]!;
      if (i + 1 < lines.length) {
        const payloadLines: string[] = [];
        i += 1;
        while (i < lines.length) {
          const next = lines[i]!.trim();
          if (!next) {
            i += 1;
            continue;
          }
          if (
            AGENT_NAME_LINE_RE.test(next) ||
            AGENT_HEADING_RE.test(next) ||
            METRIC_LINE_RE.test(next)
          ) {
            break;
          }
          payloadLines.push(lines[i]!);
          i += 1;
        }
        if (payloadLines.length > 0) {
          blocks.push({ label, payload: payloadLines.join("\n").trim() });
          continue;
        }
      }
    }

    if (line.startsWith("{") && line.includes('"type"')) {
      const payloadLines: string[] = [line];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!.trim();
        if (!next) {
          i += 1;
          continue;
        }
        if (
          AGENT_NAME_LINE_RE.test(next) ||
          AGENT_HEADING_RE.test(next) ||
          METRIC_LINE_RE.test(next) ||
          (next.startsWith("{") && next.includes('"type"'))
        ) {
          break;
        }
        payloadLines.push(lines[i]!);
        i += 1;
      }
      blocks.push({ label: "agent", payload: payloadLines.join("\n").trim() });
      continue;
    }

    i += 1;
  }

  return blocks;
}

function formatKeyMetricsSection(content: string): string | null {
  const blocks = extractJsonBlocks(content);
  if (blocks.length === 0) return null;

  const formatted = blocks
    .map(({ label, payload }) => formatKeyMetricEntry(label, payload))
    .filter(Boolean);

  if (formatted.length === 0) return null;

  return formatted.join("\n\n");
}

export function formatKeyMetricEntry(label: string, payload: string): string {
  const displayName = resolveAgentDisplayName(label, payload);
  const parsed = tryRecoverAgentFields(payload);
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
    const formatted = formatKeyMetricsSection(content);
    if (formatted) return formatted;

    const legacyBlocks = content.split(/\n(?=-\s+\*\*)/).map((b) => b.trim()).filter(Boolean);
    if (legacyBlocks.length > 0) {
      const legacyFormatted = legacyBlocks
        .map((block) => {
          const firstLine = block.split("\n")[0] ?? "";
          const match = firstLine.match(METRIC_LINE_RE);
          if (!match) return block;
          const rest = block.slice(firstLine.length).trim();
          const payload = [match[2].trim(), rest].filter(Boolean).join(" ");
          return formatKeyMetricEntry(match[1], payload);
        })
        .filter(Boolean);
      if (legacyFormatted.length > 0) return legacyFormatted.join("\n\n");
    }
  }

  const lines = content.split("\n");
  const formatted = lines.map((line) => formatMetricLine(line));
  if (formatted.every((line, i) => line === lines[i])) return content;
  return formatted.join("\n\n");
}
