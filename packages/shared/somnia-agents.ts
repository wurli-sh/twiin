import {
  decodeAbiParameters,
  encodeFunctionData,
  formatEther,
  stringToHex,
  type Hex,
} from "viem";
import { NativeConfigId } from "./constants";

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
  "You are an analysis sub-agent. Analyze the provided text/data and return concise, factual insights.";
const REPORTER_SYSTEM =
  "You are a reporting sub-agent. Write a clear, well-structured final report from the provided data.";

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
      'somnia-oracle: CoinGecko /simple/price needs a leaf selector (e.g. "somnia.usd" with "decimals":8), not just "somnia" — the API returns an object, not a string.',
    );
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
  return decodeNativeAgentResult(body);
}

/**
 * Decodes a Somnia base-agent result (ABI-encoded string or uint256/int256).
 * Returns null when the bytes are empty or not a recognized ABI value.
 */

export function decodeNativeAgentResult(resultHex: string | null | undefined): string | null {
  if (!resultHex || resultHex === "0x") return null;

  try {
    const [text] = decodeAbiParameters([{ type: "string" }], resultHex as Hex);
    return text;
  } catch {
    /* not a string */
  }

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

/** Human-readable STT amount for a native step (deposit + per-agent × 3). */
export function formatNativeStepAuthorizationStt(
  requestDepositWei: bigint,
  perAgentCostWei: bigint,
  subcommitteeSize = 3,
): string {
  const total = requestDepositWei + perAgentCostWei * BigInt(subcommitteeSize);
  return formatEther(total);
}
