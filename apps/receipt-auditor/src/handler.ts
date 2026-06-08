import {
  parsePayload,
  structuredError,
  type ExternalExecuteInput,
} from "@twiin/external-kit";
import type { ReceiptAuditorEnv } from "./env";

const DEFAULT_RECEIPTS_URL = "https://receipts.testnet.agents.somnia.host";

export async function executeReceiptAuditor(input: ExternalExecuteInput): Promise<string> {
  const env = input.env as ReceiptAuditorEnv;
  const parsed = parsePayload(input.payloadHex);
  const baseUrl = env.RECEIPTS_BASE_URL ?? DEFAULT_RECEIPTS_URL;
  const requestId =
    typeof parsed.json?.requestId === "string"
      ? parsed.json.requestId
      : typeof parsed.json?.receiptId === "string"
        ? parsed.json.receiptId
        : typeof parsed.json?.taskId === "string"
          ? parsed.json.taskId
          : "latest";

  try {
    const url = `${baseUrl.replace(/\/$/, "")}?requestId=${encodeURIComponent(requestId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let receipt: unknown = text;
    try {
      receipt = JSON.parse(text);
    } catch {
      // keep raw text
    }

    const summary = summarizeReceipt(receipt, requestId);

    return JSON.stringify({
      type: "receipt-auditor",
      agentName: env.AGENT_NAME,
      source: "somnia-receipts",
      requestId,
      status: res.status,
      ok: res.ok,
      summary,
      receipt: typeof receipt === "object" ? receipt : { raw: String(receipt).slice(0, 4000) },
      findings: summary.findings,
      ts: new Date().toISOString(),
    });
  } catch (error) {
    return structuredError(env.AGENT_NAME, "somnia-receipts", String(error), {
      requestId,
      partial: true,
    });
  }
}

function summarizeReceipt(
  receipt: unknown,
  requestId: string,
): { verified: boolean; agentCount: number; findings: string[] } {
  if (!receipt || typeof receipt !== "object") {
    return {
      verified: false,
      agentCount: 0,
      findings: [`No structured receipt for requestId=${requestId}`],
    };
  }
  const record = receipt as Record<string, unknown>;
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const verified = record.verified === true || record.status === "verified";
  return {
    verified,
    agentCount: steps.length,
    findings: [
      `Receipt lookup for ${requestId}: ${verified ? "verified" : "unverified or partial"}`,
      steps.length ? `${steps.length} step(s) in receipt trail` : "No step trail in receipt payload",
    ],
  };
}
