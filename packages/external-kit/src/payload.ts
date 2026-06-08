import { hexToString, isHex, toHex } from "viem";

export type ParsedPayload = {
  raw: string;
  json: Record<string, unknown> | null;
};

export function decodePayload(payloadHex: string): string {
  if (payloadHex.length === 0) return "";
  const normalized = payloadHex.startsWith("0x") ? payloadHex : `0x${payloadHex}`;
  if (!isHex(normalized)) return payloadHex;
  try {
    return hexToString(normalized as `0x${string}`);
  } catch {
    return toHex(normalized as `0x${string}`);
  }
}

export function parsePayload(payloadHex: string): ParsedPayload {
  const raw = decodePayload(payloadHex);
  if (!raw.trim()) return { raw, json: null };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { raw, json: parsed as Record<string, unknown> };
    }
  } catch {
    /* plain text */
  }
  return { raw, json: null };
}

export function buildVerificationResult(agentName: string, reqId: string): string {
  return JSON.stringify({
    type: "verification",
    agentName,
    reqId,
    ts: new Date().toISOString(),
  });
}

export function structuredError(
  agentName: string,
  source: string,
  error: string,
  partial: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "external-error",
    agentName,
    source,
    error,
    partial,
    ts: new Date().toISOString(),
  });
}
