import { parseAbiItem } from "viem";
import Anthropic from "@anthropic-ai/sdk";
import { StepState } from "@twiin/shared";
import { publicClient } from "../clients";
import { addresses, orchestratorContract } from "../contracts";
import { env } from "../env";
import {
  getCursor,
  setCursor,
  getStep,
  isRatingSubmitted,
  saveSubmittedRating,
  deleteSubmittedRating,
  upsertStep,
} from "../db";
import { publish } from "../sse";

const CURSOR_KEY = "rater";
const POLL_MS = 6_000;
const CHUNK = 500n;
const MIN_QUALITY = 40;
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

let running = false;

export function startRater(): void {
  if (running) return;
  running = true;
  void poll();
}

async function poll(): Promise<void> {
  while (running) {
    try {
      await tick();
    } catch (e) {
      console.error("[rater] error:", e);
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
      "event ExternalResultPending(uint256 indexed taskId, uint8 stepIdx, address registrant, bytes result)",
    ),
    fromBlock: from,
    toBlock: to,
  });

  for (const log of logs) {
    const { taskId, stepIdx, result } = log.args;
    if (taskId == null || stepIdx == null) continue;

    const taskIdStr = taskId.toString();
    if (await isRatingSubmitted(taskIdStr, stepIdx)) continue;

    try {
      await rateStep(taskId, stepIdx, result ?? "0x");
    } catch (e) {
      console.error(`[rater] failed task=${taskIdStr} step=${stepIdx}:`, e);
    }
  }

  await setCursor(CURSOR_KEY, to + 1n);
}

async function rateStep(
  taskId: bigint,
  stepIdx: number,
  resultHex: `0x${string}`,
): Promise<void> {
  const taskIdStr = taskId.toString();

  let resultText: string;
  try {
    resultText = new TextDecoder().decode(
      Buffer.from(resultHex.slice(2), "hex"),
    );
  } catch {
    resultText = resultHex;
  }

  const stepRecord = await getStep(taskIdStr, stepIdx);
  const instruction = stepRecord?.payload ?? "(unknown instruction)";

  const score = await scoreWithClaude(instruction, resultText);
  console.log(`[rater] task=${taskIdStr} step=${stepIdx} score=${score}`);

  // Optimistic lock BEFORE chain call — prevents double-rating on crash
  await saveSubmittedRating(taskIdStr, stepIdx, score);
  try {
    await orchestratorContract.write.finalizeExternalStep([
      taskId,
      stepIdx,
      score,
    ]);
  } catch (e) {
    const msg = String(e);
    // If the chain reverted (step already finalized/timed-out), keep the DB row
    // to prevent an infinite retry loop — just log and move on
    if (
      msg.includes("revert") ||
      msg.includes("Revert") ||
      msg.includes("execution reverted")
    ) {
      console.warn(
        `[rater] finalizeExternalStep reverted task=${taskIdStr} step=${stepIdx} — step likely already finalized, suppressing retry`,
      );
      return;
    }
    await deleteSubmittedRating(taskIdStr, stepIdx);
    throw e;
  }

  const newState =
    score >= MIN_QUALITY ? StepState.Succeeded : StepState.Failed;
  await upsertStep(
    taskIdStr,
    stepIdx,
    "0",
    newState,
    instruction,
    null,
    resultHex,
    score,
    null,
  );

  publish(taskIdStr, "step_rated", {
    taskId: taskIdStr,
    stepIdx,
    score,
    approved: score >= MIN_QUALITY,
  });
}

async function scoreWithClaude(
  instruction: string,
  result: string,
): Promise<number> {
  const prompt = `Rate the quality of this AI agent's work on a scale of 0-100.
A score >= 40 means the result is acceptable and payment will be released.

INSTRUCTION: ${instruction.slice(0, 800)}

RESULT: ${result.slice(0, 1200)}

Respond with ONLY a JSON object: {"score": <number 0-100>, "reason": "<one sentence>"}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 128,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(json) as { score: number };
    return Math.max(0, Math.min(100, Math.round(parsed.score)));
  } catch (e) {
    console.error("[rater] scoring failed, withholding payment (score=0):", e);
    return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
