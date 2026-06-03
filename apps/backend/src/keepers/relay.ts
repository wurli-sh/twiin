import { parseAbiItem, toHex } from "viem";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildTwiinDigest,
  CHAIN_ID,
  NativeConfigId,
  StepState,
} from "@twiin/shared";
import { publicClient, walletClient, keeperAccount } from "../clients";
import {
  addresses,
  orchestratorContract,
  agentRegistryContract,
} from "../contracts";
import { env } from "../env";
import {
  getCursor,
  setCursor,
  getStep,
  isResultSubmitted,
  saveSubmittedResult,
  deleteSubmittedResult,
  upsertStep,
} from "../db";
import { publish } from "../sse";

const CURSOR_KEY = "relay";
const POLL_MS = 4_000;
const CHUNK = 500n;
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

let running = false;

export function startRelay(): void {
  if (running) return;
  running = true;
  void poll();
}

async function poll(): Promise<void> {
  while (running) {
    try {
      await tick();
    } catch (e) {
      console.error("[relay] error:", e);
    }
    await sleep(POLL_MS);
  }
}

async function tick(): Promise<void> {
  const latest = await publicClient.getBlockNumber();
  const stored = await getCursor(CURSOR_KEY);
  const from = stored === 0n && env.START_BLOCK > 0n ? env.START_BLOCK : stored;
  if (from > latest) return;
  const to = from + CHUNK < latest ? from + CHUNK : latest;

  const logs = await publicClient.getLogs({
    address: addresses.orchestrator,
    event: parseAbiItem(
      "event ExternalAgentRequest(uint256 indexed taskId, uint8 stepIdx, uint256 configId, address registrant, bytes32 endpointHash, bytes payload, bytes32 reqId, uint64 deadline)",
    ),
    fromBlock: from,
    toBlock: to,
  });

  for (const log of logs) {
    const { taskId, stepIdx, configId, payload, reqId, deadline } = log.args;
    if (taskId == null || stepIdx == null || reqId == null) continue;

    const taskIdStr = taskId.toString();
    if (await isResultSubmitted(taskIdStr, stepIdx)) continue;

    if (deadline && BigInt(Math.floor(Date.now() / 1000)) > deadline) {
      console.log(
        `[relay] step ${taskIdStr}:${stepIdx} deadline passed, skipping`,
      );
      continue;
    }

    try {
      await processExternalStep(
        taskId,
        stepIdx,
        configId ?? 0n,
        payload ?? "0x",
        reqId,
      );
    } catch (e) {
      console.error(`[relay] failed task=${taskIdStr} step=${stepIdx}:`, e);
    }
  }

  await setCursor(CURSOR_KEY, to + 1n);
}

async function processExternalStep(
  taskId: bigint,
  stepIdx: number,
  configId: bigint,
  payloadHex: `0x${string}`,
  reqId: `0x${string}`,
): Promise<void> {
  const taskIdStr = taskId.toString();

  let instruction: string;
  try {
    instruction = new TextDecoder().decode(
      Buffer.from(payloadHex.slice(2), "hex"),
    );
  } catch {
    instruction = payloadHex;
  }

  let agentName = `agent-${configId}`;
  try {
    const agent = await agentRegistryContract.read.get([configId]);
    agentName = agent.name;
  } catch {
    /* non-fatal */
  }

  console.log(
    `[relay] executing ${agentName} task=${taskIdStr} step=${stepIdx}`,
  );

  const result = await callClaudeForStep(agentName, instruction, configId);
  const resultHex = toHex(new TextEncoder().encode(result)) as `0x${string}`;

  const digest = buildTwiinDigest({
    chainId: BigInt(CHAIN_ID),
    orchestrator: addresses.orchestrator,
    taskId,
    stepIdx,
    externalRequestId: reqId,
    result: resultHex,
  });

  const sig = await walletClient.signMessage({
    account: keeperAccount,
    message: { raw: digest },
  });

  // Check step is still awaiting submission (may have timed out while Claude ran)
  const stepRow = await getStep(taskIdStr, stepIdx);
  if (stepRow && stepRow.state !== StepState.RunningExternal) {
    console.log(
      `[relay] step ${taskIdStr}:${stepIdx} no longer RunningExternal, skipping`,
    );
    await saveSubmittedResult(taskIdStr, stepIdx, resultHex, sig);
    return;
  }

  // Optimistic lock BEFORE chain call — prevents double-submit on crash
  await saveSubmittedResult(taskIdStr, stepIdx, resultHex, sig);
  try {
    await orchestratorContract.write.submitExternalResult([
      taskId,
      stepIdx,
      resultHex,
      sig,
    ]);
  } catch (e) {
    await deleteSubmittedResult(taskIdStr, stepIdx);
    throw e;
  }

  await upsertStep(
    taskIdStr,
    stepIdx,
    configId.toString(),
    StepState.AwaitingRating,
    instruction,
    reqId,
    resultHex,
    null,
    null,
  );
  publish(taskIdStr, "step_result_submitted", { taskId: taskIdStr, stepIdx });
  console.log(`[relay] submitted result task=${taskIdStr} step=${stepIdx}`);
}

async function callClaudeForStep(
  agentName: string,
  instruction: string,
  configId: bigint,
): Promise<string> {
  if (configId === BigInt(NativeConfigId.WEB_INTEL)) {
    return runWebIntel(instruction);
  }
  if (configId === BigInt(NativeConfigId.ORACLE)) {
    return runOracle(instruction);
  }

  const personas: Record<string, string> = {
    "3": "You are an analysis agent. Analyze the provided data and produce structured insights.",
    "4": "You are a reporter agent. Write a clear, concise report based on the provided information.",
  };
  const system =
    personas[configId.toString()] ??
    `You are ${agentName}, an AI sub-agent. Complete the task as instructed.`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: instruction }],
  });

  return msg.content[0].type === "text" ? msg.content[0].text : "";
}

async function runWebIntel(instruction: string): Promise<string> {
  const payload = parseJsonPayload<{ url: string; query?: string }>(instruction);
  const response = await fetch(payload.url, {
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  const content = normalizeWebText(body);
  return [
    `SOURCE_URL: ${payload.url}`,
    `HTTP_STATUS: ${response.status}`,
    `QUERY: ${payload.query ?? ""}`,
    "CONTENT:",
    content.slice(0, 12_000),
  ].join("\n");
}

async function runOracle(instruction: string): Promise<string> {
  const payload = parseJsonPayload<{ url: string; path?: string }>(instruction);
  const response = await fetch(payload.url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json()) as unknown;
  const value = payload.path ? getPathValue(json, payload.path) : json;
  return JSON.stringify(
    {
      url: payload.url,
      path: payload.path ?? "",
      status: response.status,
      value,
    },
    null,
    2,
  ).slice(0, 12_000);
}

function parseJsonPayload<T>(instruction: string): T {
  const parsed = JSON.parse(instruction) as T;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("instruction payload must be a JSON object");
  }
  return parsed;
}

function normalizeWebText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getPathValue(input: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((acc, key) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) {
        const index = Number(key);
        return Number.isInteger(index) ? acc[index] : undefined;
      }
      if (typeof acc === "object") {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, input);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
