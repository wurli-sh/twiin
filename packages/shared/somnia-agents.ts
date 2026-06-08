import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  formatEther,
  hexToString,
  isHex,
  stringToHex,
  type Hex,
} from "viem";
import { NativeConfigId, EXTERNAL_MIN_CONFIG_ID, MAX_PRIOR_CONTEXT_CHARS } from "./constants";

/**
 * Somnia Agents API base-agent ABIs.
 *
 * Native steps are dispatched on-chain via `agentsApi.createRequest(somniaId, …, payload)`.
 * Somnia validators decode `payload` as a standard Solidity ABI call against the target
 * base agent — it MUST be `abi.encodeWithSelector(agentFn, params…)`, NOT a raw JSON blob.
 * Signatures verified against docs.somnia.network/agents.
 */

// JSON API Request agent — configId ORACLE (somnia-oracle@twiin)
export const JsonApiAgentAbi = [
  {
    type: "function",
    name: "fetchString",
    stateMutability: "nonpayable",
    inputs: [
      { name: "url", type: "string" },
      { name: "selector", type: "string" },
    ],
    outputs: [{ name: "result", type: "string" }],
  },
  {
    type: "function",
    name: "fetchUint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "url", type: "string" },
      { name: "selector", type: "string" },
      { name: "decimals", type: "uint8" },
    ],
    outputs: [{ name: "result", type: "uint256" }],
  },
] as const;

// LLM Parse Website agent — configId WEB_INTEL (web-intel@twiin)
export const ParseWebsiteAgentAbi = [
  {
    type: "function",
    name: "ExtractString",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", type: "string" },
      { name: "description", type: "string" },
      { name: "options", type: "string[]" },
      { name: "prompt", type: "string" },
      { name: "url", type: "string" },
      { name: "resolveUrl", type: "bool" },
      { name: "numPages", type: "uint8" },
      { name: "confidenceThreshold", type: "uint8" },
    ],
    outputs: [{ name: "output", type: "string" }],
  },
  {
    type: "function",
    name: "ExtractANumber",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", type: "string" },
      { name: "description", type: "string" },
      { name: "min", type: "uint256" },
      { name: "max", type: "uint256" },
      { name: "prompt", type: "string" },
      { name: "url", type: "string" },
      { name: "resolveUrl", type: "bool" },
      { name: "numPages", type: "uint8" },
      { name: "confidenceThreshold", type: "uint8" },
    ],
    outputs: [{ name: "output", type: "uint256" }],
  },
] as const;

// LLM Inference agent — configId ANALYSIS / REPORTER (analysis-bot@twiin, reporter-bot@twiin)
export const LlmInferenceAgentAbi = [
  {
    type: "function",
    name: "inferString",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "chainOfThought", type: "bool" },
      { name: "allowedValues", type: "string[]" },
    ],
    outputs: [{ name: "response", type: "string" }],
  },
  {
    type: "function",
    name: "inferNumber",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prompt", type: "string" },
      { name: "system", type: "string" },
      { name: "minValue", type: "int256" },
      { name: "maxValue", type: "int256" },
      { name: "chainOfThought", type: "bool" },
    ],
    outputs: [{ name: "response", type: "int256" }],
  },
] as const;

const ANALYSIS_SYSTEM =
  "You are an analysis sub-agent. Analyze the provided text/data and return concise, factual insights. Use only provided evidence. If a requested fact is missing, say unavailable instead of guessing.";
const REPORTER_SYSTEM =
  "You are a reporting sub-agent. Write a clear, well-structured final report from the provided data. Use only provided evidence. Do not invent dates, prices, percentages, or other facts. If a requested fact is missing, say unavailable or omit it.";

/** Returns true for native sub-agents whose payload needs Somnia ABI encoding. */
export function isSomniaNativeConfigId(configId: number): boolean {
  return (
    configId === NativeConfigId.WEB_INTEL ||
    configId === NativeConfigId.ORACLE ||
    configId === NativeConfigId.ANALYSIS ||
    configId === NativeConfigId.REPORTER
  );
}

function parseJsonObject(payload: string, errorMessage: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(errorMessage);
  }
}

function parseJsonObjectIfPresent(payload: string): Record<string, unknown> | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function requireString(value: unknown, errorMessage: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(errorMessage);
  }
  return value.trim();
}

// Matches "https://<host>/…" — host must have at least one non-space, non-slash char.
const HTTPS_URL_RE = /^https:\/\/[^\s/]+(\/\S*)?$/i;

function requireHttpsUrl(value: unknown, errorMessage: string): string {
  const raw = requireString(value, errorMessage);
  if (!HTTPS_URL_RE.test(raw)) throw new Error(errorMessage);
  return raw;
}

function parseUint8(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${field} must be an integer 0–255`);
  }
  return value;
}

function wantsNumericOutput(parsed: Record<string, unknown>): boolean {
  const output = parsed.output;
  if (output === "number" || output === "uint") return true;
  if (parsed.numeric === true) return true;
  return false;
}

/** Reject oracle plans that usually fail on Somnia (empty search results, array races). */
export function validateOraclePlannerPayload(
  url: string,
  selector: string,
): void {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("/search?") || lowerUrl.includes("/search&")) {
    throw new Error(
      "somnia-oracle: do not use search/discovery API URLs (e.g. coingecko /search). Use a direct JSON endpoint with a known id, or skip oracle and use analysis-bot instead.",
    );
  }
  if (/\bcoins\.\d+\./i.test(selector) || /\[\d+\]/.test(selector)) {
    throw new Error(
      'somnia-oracle: avoid array-index selectors like "coins.0.id" — they fail when the API returns no rows. Use a stable path on a direct endpoint, or use analysis-bot for research goals.',
    );
  }
  if (
    lowerUrl.includes("/simple/price") &&
    !selector.includes(".")
  ) {
    throw new Error(
      'somnia-oracle: CoinGecko /simple/price needs a leaf selector (e.g. "somnia.usd"). Prefer fetchString (omit decimals) so the API float is returned as a decimal string.',
    );
  }
}

export function validateExternalAgentPayload(
  agentName: string,
  rawPayload: string,
): void {
  const parsed = parseJsonObjectIfPresent(rawPayload);

  switch (agentName) {
    case "docs-lens": {
      if (!parsed) {
        requireString(rawPayload, "docs-lens payload must be non-empty text or JSON");
        return;
      }
      requireString(
        parsed.question ?? "What agents and oracles does Somnia expose?",
        'docs-lens payload requires a non-empty "question"',
      );
      if (parsed.docPath !== undefined) {
        requireString(parsed.docPath, 'docs-lens "docPath" must be non-empty when provided');
      }
      return;
    }
    case "dreamdex-mcp": {
      if (!parsed) {
        throw new Error(
          'dreamdex-mcp payload must be JSON: {"action":"orderbook|pairs|snapshot|coingecko","pair":"SOMI/USDC"} or {"action":"coingecko","id":"somnia"}',
        );
      }
      const action =
        typeof parsed.action === "string" ? parsed.action.toLowerCase() : "snapshot";
      if (!["orderbook", "pairs", "snapshot", "coingecko"].includes(action)) {
        throw new Error(
          'dreamdex-mcp "action" must be orderbook, pairs, snapshot, or coingecko',
        );
      }
      if (action === "coingecko") {
        if (parsed.id !== undefined) {
          requireString(parsed.id, 'dreamdex-mcp "id" must be non-empty when provided');
        }
        return;
      }
      requireString(
        parsed.pair ?? parsed.symbol ?? "SOMI",
        'dreamdex-mcp payload requires non-empty "pair" or "symbol"',
      );
      return;
    }
    case "onchain-lens": {
      if (!parsed) {
        throw new Error(
          'onchain-lens payload must be JSON: {"blockWindow":5} or {"lookbackHours":24}',
        );
      }
      if (
        parsed.blockWindow !== undefined &&
        (typeof parsed.blockWindow !== "number" ||
          !Number.isFinite(parsed.blockWindow) ||
          parsed.blockWindow <= 0)
      ) {
        throw new Error('onchain-lens "blockWindow" must be a positive number');
      }
      if (
        parsed.lookbackHours !== undefined &&
        (typeof parsed.lookbackHours !== "number" ||
          !Number.isFinite(parsed.lookbackHours) ||
          parsed.lookbackHours <= 0)
      ) {
        throw new Error('onchain-lens "lookbackHours" must be a positive number');
      }
      return;
    }
    case "reactivity-lens": {
      if (!parsed) {
        throw new Error(
          'reactivity-lens payload must be JSON: {"lookbackBlocks":1000} or {"agentId":1,"topic":"..."}',
        );
      }
      if (
        parsed.lookbackBlocks !== undefined &&
        (typeof parsed.lookbackBlocks !== "number" ||
          !Number.isFinite(parsed.lookbackBlocks) ||
          parsed.lookbackBlocks <= 0)
      ) {
        throw new Error('reactivity-lens "lookbackBlocks" must be a positive number');
      }
      if (
        typeof parsed.lookbackBlocks === "number" &&
        parsed.lookbackBlocks > 1000
      ) {
        throw new Error('reactivity-lens "lookbackBlocks" must be <= 1000 (Somnia RPC limit)');
      }
      if (
        parsed.agentId !== undefined &&
        (typeof parsed.agentId !== "number" || !Number.isFinite(parsed.agentId))
      ) {
        throw new Error('reactivity-lens "agentId" must be a number when provided');
      }
      if (parsed.topic !== undefined) {
        requireString(parsed.topic, 'reactivity-lens "topic" must be non-empty when provided');
      }
      return;
    }
    case "receipt-auditor": {
      if (!parsed) {
        throw new Error(
          'receipt-auditor payload must be JSON: {"receiptId":"latest"} or {"requestId":"..."}',
        );
      }
      requireString(
        parsed.requestId ?? parsed.receiptId ?? parsed.taskId ?? "latest",
        'receipt-auditor payload requires non-empty "requestId", "receiptId", or "taskId"',
      );
      return;
    }
    case "briefsmith": {
      if (!parsed) {
        requireString(rawPayload, "briefsmith payload must be non-empty text or JSON");
        return;
      }
      requireString(
        parsed.goal ?? parsed.priorContext ?? parsed.text ?? "brief",
        "briefsmith payload must include non-empty brief context",
      );
      return;
    }
    case "agent-adapter": {
      requireString(rawPayload, "agent-adapter payload must be non-empty text or JSON");
      return;
    }
    default:
      return;
  }
}

function encodeOraclePayload(parsed: Record<string, unknown>): Hex {
  const url = requireHttpsUrl(parsed.url, "somnia-oracle payload requires a valid HTTPS url");
  const selector = requireString(
    parsed.selector ?? parsed.path,
    'somnia-oracle payload requires a non-empty "selector" (dot-notation path)',
  );
  validateOraclePlannerPayload(url, selector);

  if (parsed.decimals !== undefined && parsed.decimals !== null) {
    const decimals = parseUint8(parsed.decimals, "decimals");
    return encodeFunctionData({
      abi: JsonApiAgentAbi,
      functionName: "fetchUint",
      args: [url, selector, decimals],
    });
  }

  return encodeFunctionData({
    abi: JsonApiAgentAbi,
    functionName: "fetchString",
    args: [url, selector],
  });
}

function encodeWebIntelPayload(parsed: Record<string, unknown>): Hex {
  const url = requireHttpsUrl(parsed.url, "web-intel payload requires a valid HTTPS url");
  const prompt = requireString(
    parsed.prompt ?? parsed.query,
    'web-intel payload requires a non-empty "prompt"',
  );
  const resolveUrl = parsed.resolveUrl === true;
  const numPages =
    parsed.numPages !== undefined ? parseUint8(parsed.numPages, "numPages") : 1;

  if (wantsNumericOutput(parsed)) {
    const min =
      parsed.min !== undefined ? BigInt(String(parsed.min)) : 0n;
    const max =
      parsed.max !== undefined ? BigInt(String(parsed.max)) : 0n;
    return encodeFunctionData({
      abi: ParseWebsiteAgentAbi,
      functionName: "ExtractANumber",
      args: [
        "result",
        prompt,
        min,
        max,
        prompt,
        url,
        resolveUrl,
        numPages,
        0,
      ],
    });
  }

  return encodeFunctionData({
    abi: ParseWebsiteAgentAbi,
    functionName: "ExtractString",
    args: [
      "result",
      prompt,
      [],
      prompt,
      url,
      resolveUrl,
      numPages,
      0,
    ],
  });
}

function encodeLlmPayload(configId: number, rawPayload: string): Hex {
  let prompt = rawPayload;
  let minValue = -2_147_483_648n;
  let maxValue = 2_147_483_647n;
  let useNumber = false;

  const trimmed = rawPayload.trim();
  if (trimmed.startsWith("{")) {
    const parsed = parseJsonObject(
      trimmed,
      "analysis/reporter JSON payload must be {\"prompt\":\"…\"} or plain text",
    );
    prompt = requireString(parsed.prompt ?? parsed.text, "llm payload requires a non-empty prompt");
    if (parsed.minValue !== undefined) minValue = BigInt(String(parsed.minValue));
    if (parsed.maxValue !== undefined) maxValue = BigInt(String(parsed.maxValue));
    useNumber =
      parsed.output === "number" ||
      parsed.numeric === true ||
      parsed.minValue !== undefined ||
      parsed.maxValue !== undefined;
  } else {
    requireString(prompt, "llm payload must be non-empty text");
  }

  const system =
    configId === NativeConfigId.ANALYSIS ? ANALYSIS_SYSTEM : REPORTER_SYSTEM;

  if (useNumber) {
    return encodeFunctionData({
      abi: LlmInferenceAgentAbi,
      functionName: "inferNumber",
      args: [prompt, system, minValue, maxValue, false],
    });
  }

  return encodeFunctionData({
    abi: LlmInferenceAgentAbi,
    functionName: "inferString",
    args: [prompt, system, false, []],
  });
}

/**
 * Encodes a planner step payload into the exact ABI calldata the target Somnia base agent
 * expects. `rawPayload` is the planner-emitted string (JSON for web-intel/oracle, plain text
 * for analysis/reporter). Throws on malformed input so the request never goes on-chain.
 */
export function encodeNativeAgentPayload(configId: number, rawPayload: string): Hex {
  if (configId === NativeConfigId.ORACLE) {
    const parsed = parseJsonObject(
      rawPayload,
      'somnia-oracle payload must be JSON: {"url":"https://…","selector":"dot.path"} or add "decimals":8 for prices',
    );
    return encodeOraclePayload(parsed);
  }

  if (configId === NativeConfigId.WEB_INTEL) {
    const parsed = parseJsonObject(
      rawPayload,
      'web-intel payload must be JSON: {"url":"https://…","prompt":"what to extract"}',
    );
    return encodeWebIntelPayload(parsed);
  }

  if (
    configId === NativeConfigId.ANALYSIS ||
    configId === NativeConfigId.REPORTER
  ) {
    return encodeLlmPayload(configId, rawPayload);
  }

  throw new Error(`configId ${configId} is not a Somnia native agent`);
}

/**
 * Builds the on-chain payload for a step. Native sub-agents get Somnia ABI calldata;
 * external HTTP agents keep the raw UTF-8 bytes their `/execute` endpoint expects.
 */
export function encodeStepPayload(
  configId: number,
  rawPayload: string,
  isNative: boolean,
): Hex {
  if (isNative && isSomniaNativeConfigId(configId)) {
    return encodeNativeAgentPayload(configId, rawPayload);
  }
  return stringToHex(rawPayload);
}

/**
 * Parses `TaskCompleted` log data and decodes the Somnia step bytes (often ABI uint256/string).
 * The contract emits `string(bytes)` so viem's string decode can truncate at NUL — prefer log `data`.
 */
export function decodeTaskCompletionFromLogData(logData: Hex): string | null {
  const hex = logData.startsWith("0x") ? logData.slice(2) : logData;
  if (hex.length < 128) return null;

  const len = Number.parseInt(hex.slice(64, 128), 16);
  if (!Number.isFinite(len) || len <= 0 || len > 4096) return null;

  const bodyEnd = 128 + len * 2;
  if (hex.length < bodyEnd) return null;

  const body = `0x${hex.slice(128, bodyEnd)}` as Hex;
  return (
    normalizeDisplayText(decodeNativeAgentResult(body)) ??
    normalizeDisplayText(hexToString(body))
  );
}

/**
 * Decodes a Somnia base-agent result (ABI-encoded string or uint256/int256).
 * Returns null when the bytes are empty or not a recognized ABI value.
 */

export function decodeNativeAgentResult(resultHex: string | null | undefined): string | null {
  if (!resultHex || resultHex === "0x") return null;

  try {
    const [text] = decodeAbiParameters([{ type: "string" }], resultHex as Hex);
    return normalizeDisplayText(text);
  } catch {
    /* not a string */
  }

  const byteLength = (resultHex.length - 2) / 2;
  if (byteLength === 32) {
    try {
      const [n] = decodeAbiParameters([{ type: "uint256" }], resultHex as Hex);
      return n.toString();
    } catch {
      /* not uint256 */
    }

    try {
      const [n] = decodeAbiParameters([{ type: "int256" }], resultHex as Hex);
      return n.toString();
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Decodes any step result — native ABI first, then raw UTF-8 for external agents.
 */
export function decodeStepResult(resultHex: string | null | undefined): string | null {
  if (!resultHex || resultHex === "0x") return null;
  return (
    decodeNativeAgentResult(resultHex) ??
    normalizeDisplayText(hexToString(resultHex as Hex))
  );
}

export type PriorStepInput = {
  stepIdx: number;
  configId: string | number;
  resultHex: string | null;
  payload?: string | null;
};

/** Label for a prior step output line (mirrors AgentOrchestrator._stepOutputLabel). */
export function stepOutputLabel(configId: number, payloadHex?: string | null): string {
  if (configId === NativeConfigId.WEB_INTEL) return "web-intel";
  if (configId === NativeConfigId.ANALYSIS) return "analysis";
  if (configId === NativeConfigId.REPORTER) return "reporter";
  if (configId >= EXTERNAL_MIN_CONFIG_ID) return `external-${configId}`;

  if (configId === NativeConfigId.ORACLE && payloadHex && isHex(payloadHex)) {
    try {
      const decoded = decodeFunctionData({ abi: JsonApiAgentAbi, data: payloadHex as Hex });
      if (decoded.functionName === "fetchString" || decoded.functionName === "fetchUint") {
        const selectorText = String(decoded.args?.[1] ?? "metric");
        if (decoded.functionName === "fetchUint") {
          const decimals = decoded.args?.[2];
          return `oracle ${selectorText} (decimals=${String(decimals)})`;
        }
        return `oracle ${selectorText}`;
      }
    } catch {
      /* plain payload */
    }
  }

  return "prior result";
}

/** Prefer agent name/type from decoded step result over opaque external-N labels. */
export function stepOutputLabelFromResult(
  configId: number,
  resultText?: string | null,
  payloadHex?: string | null,
): string {
  if (resultText?.trim()) {
    try {
      const parsed = JSON.parse(resultText.trim()) as Record<string, unknown>;
      if (typeof parsed.agentName === "string" && parsed.agentName.trim()) {
        return parsed.agentName.replace(/@twiin$/i, "").trim();
      }
      if (typeof parsed.type === "string" && parsed.type.trim()) {
        return parsed.type.trim();
      }
    } catch {
      /* plain text result */
    }
  }
  return stepOutputLabel(configId, payloadHex);
}

function truncateForPriorContext(text: string): string {
  if (text.length <= MAX_PRIOR_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_PRIOR_CONTEXT_CHARS)}...`;
}

/**
 * Builds prior-step context for external relay enrichment (mirrors on-chain _priorStepContext).
 */
export function buildPriorStepContext(
  steps: PriorStepInput[],
  uptoStepIdx: number,
): string {
  const sorted = [...steps]
    .filter((s) => s.stepIdx < uptoStepIdx)
    .sort((a, b) => a.stepIdx - b.stepIdx);

  const lines: string[] = [];
  for (const step of sorted) {
    const decoded = decodeStepResult(step.resultHex);
    if (!decoded) continue;
    const label = stepOutputLabelFromResult(
      Number(step.configId),
      decoded,
      step.payload ?? undefined,
    );
    lines.push(`- ${label}: ${truncateForPriorContext(decoded)}`);
  }

  if (lines.length === 0) return "";
  return `Previous step outputs:\n${lines.join("\n")}`;
}

/**
 * Appends prior-step context to an external agent payload hex before relay /execute.
 */
export function enrichExternalPayload(
  payloadHex: `0x${string}`,
  priorContext: string,
): `0x${string}` {
  if (!priorContext.trim()) return payloadHex;

  const raw = decodePayloadHex(payloadHex);
  if (!raw) {
    return stringToHex(`${priorContext}\n\n`) as `0x${string}`;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return stringToHex(
        JSON.stringify({ ...parsed, priorContext }),
      ) as `0x${string}`;
    }
  } catch {
    /* plain text */
  }

  return stringToHex(`${raw}\n\n${priorContext}`) as `0x${string}`;
}

function decodePayloadHex(hex: `0x${string}`): string | null {
  if (!hex || hex === "0x") return null;
  try {
    return hexToString(hex);
  } catch {
    return null;
  }
}

/**
 * Removes NUL/control noise from decoded task text while preserving line breaks.
 * Returns null for empty or obviously corrupted strings.
 */
export function normalizeDisplayText(text: string | null | undefined): string | null {
  if (text == null) return null;

  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return null;
  if (normalized.includes("\uFFFD")) return null;

  const printableChars = Array.from(normalized).filter((char) =>
    char === "\n" || char === "\t" || (char >= " " && char !== "\u007f"),
  ).length;

  if (printableChars / normalized.length < 0.9) return null;
  return normalized;
}

export function taskTextPreview(
  text: string | null | undefined,
  maxLength = 120,
): string | null {
  const normalized = normalizeDisplayText(text);
  if (!normalized) return null;
  const singleLine = normalized.replace(/\s*\n\s*/g, " ").trim();
  if (!singleLine) return null;
  return singleLine.length > maxLength
    ? `${singleLine.slice(0, maxLength).trimEnd()}…`
    : singleLine;
}

/** Human-readable STT amount for a native step (deposit + per-agent × 3). */
export function formatNativeStepAuthorizationStt(
  requestDepositWei: bigint,
  perAgentCostWei: bigint,
  subcommitteeSize = 3,
): string {
  const total = requestDepositWei + perAgentCostWei * BigInt(subcommitteeSize);
  return formatEther(total);
}
