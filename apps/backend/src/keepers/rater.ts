import { parseAbiItem, type AbiEvent } from "viem";
import Anthropic from "@anthropic-ai/sdk";
import { StepState } from "@twiin/shared";
import {
  buildAgentRatingHints,
  buildRatingPrompt,
  getDeterministicScoreFloor,
  prepareResultForRating,
} from "./rater-scoring";
import { publicClient } from "../clients";
import { enqueueKeeperWrite } from "../keeper-writes";
import { addresses, defaultStartBlock, orchestratorContract } from "../contracts";
import { createAnthropicBudgetGuard } from "../budget";
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
import { logTaskTimeline } from "../task-log";

const CURSOR_KEY = "rater";
const POLL_MS = 6_000;
const CHUNK = 500n;
const MAX_RPC_LOG_RANGE = 1_000n;
const FAST_FORWARD_LAG_THRESHOLD = 100_000n;
const FAST_FORWARD_TAIL = 10_000n;
const MIN_QUALITY = 40;

const externalResultPendingEvent = parseAbiItem(
  "event ExternalResultPending(uint256 indexed taskId, uint8 stepIdx, address registrant, bytes result)",
) as AbiEvent;

type RaterLogArgs = {
  taskId?: bigint | null;
  stepIdx?: number | null;
  result?: `0x${string}` | null;
};

type RaterDeps = {
  anthropic: Pick<Anthropic, "messages">;
  budgetGuard: ReturnType<typeof createAnthropicBudgetGuard>;
  getBlockNumber: () => Promise<bigint>;
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<Array<{ args: RaterLogArgs }>>;
  addresses: { orchestrator: `0x${string}` };
  startBlock: bigint;
  getCursor: (name: string) => Promise<bigint>;
  setCursor: (name: string, block: bigint) => Promise<void>;
  getStep: typeof getStep;
  isRatingSubmitted: typeof isRatingSubmitted;
  saveSubmittedRating: typeof saveSubmittedRating;
  deleteSubmittedRating: typeof deleteSubmittedRating;
  upsertStep: typeof upsertStep;
  publish: typeof publish;
  finalizeExternalStep: (args: readonly [bigint, number, number]) => Promise<unknown>;
  logger: Pick<Console, "log" | "error" | "warn">;
};

export function createRater(overrides: Partial<RaterDeps> = {}) {
  const deps: RaterDeps = {
    anthropic: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    budgetGuard: createAnthropicBudgetGuard(env),
    getBlockNumber: () => publicClient.getBlockNumber(),
    getLogs: (args) =>
      publicClient.getLogs(args) as Promise<Array<{ args: RaterLogArgs }>>,
    addresses: { orchestrator: addresses.orchestrator },
    startBlock: env.START_BLOCK ?? defaultStartBlock,
    getCursor,
    setCursor,
    getStep,
    isRatingSubmitted,
    saveSubmittedRating,
    deleteSubmittedRating,
    upsertStep,
    publish,
    finalizeExternalStep: (args) =>
      enqueueKeeperWrite(() =>
        orchestratorContract.write.finalizeExternalStep(args),
      ),
    logger: console,
    ...overrides,
  };

  let running = false;

  async function tick(): Promise<void> {
    const latest = await deps.getBlockNumber();
    const stored = await deps.getCursor(CURSOR_KEY);
    if (stored > latest) {
      const rewindTo = latest > 1n ? latest - 1n : 0n;
      deps.logger.warn(
        `[rater] cursor ${stored} is ahead of latest block ${latest}; rewinding to ${rewindTo}`,
      );
      await deps.setCursor(CURSOR_KEY, rewindTo);
      return;
    }
    const from = stored === 0n && deps.startBlock > 0n ? deps.startBlock : stored;
    if (from > latest) return;
    const lag = latest - from;
    if (lag > FAST_FORWARD_LAG_THRESHOLD) {
      const fastForwardTo =
        latest > FAST_FORWARD_TAIL ? latest - FAST_FORWARD_TAIL : 0n;
      if (fastForwardTo > from) {
        deps.logger.warn(
          `[rater] lag ${lag} blocks is too large; fast-forwarding cursor from ${from} to ${fastForwardTo}`,
        );
        await deps.setCursor(CURSOR_KEY, fastForwardTo);
        return;
      }
    }
    const chunk = lag > MAX_RPC_LOG_RANGE ? MAX_RPC_LOG_RANGE : CHUNK;
    const to = from + chunk < latest ? from + chunk : latest;

    const logs = await deps.getLogs({
      address: deps.addresses.orchestrator,
      event: externalResultPendingEvent,
      fromBlock: from,
      toBlock: to,
    });

    for (const log of logs) {
      const { taskId, stepIdx, result } = log.args;
      if (taskId == null || stepIdx == null) continue;

      const taskIdStr = taskId.toString();
      if (await deps.isRatingSubmitted(taskIdStr, stepIdx)) continue;

      try {
        await rateStep(deps, taskId, stepIdx, result ?? "0x");
      } catch (e) {
        deps.logger.error(`[rater] failed task=${taskIdStr} step=${stepIdx}:`, e);
      }
    }

    await deps.setCursor(CURSOR_KEY, to + 1n);
  }

  async function poll(): Promise<void> {
    while (running) {
      try {
        await tick();
      } catch (e) {
        deps.logger.error("[rater] error:", e);
      }
      await sleep(POLL_MS);
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      void poll();
    },
    tick,
  };
}

async function rateStep(
  deps: RaterDeps,
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

  const stepRecord = await deps.getStep(taskIdStr, stepIdx);
  const instruction = stepRecord?.payload ?? "(unknown instruction)";

  deps.logger.log(
    `[rater] task=${taskIdStr} step=${stepIdx} instruction=${instruction.slice(0, 200)} result=${resultText.slice(0, 200)}`,
  );

  const { score, reason } = await scoreWithClaude(
    deps.anthropic,
    deps.budgetGuard,
    instruction,
    resultText,
  );
  deps.logger.log(`[rater] task=${taskIdStr} step=${stepIdx} score=${score} reason="${reason}"`);
  logTaskTimeline("rater_scored", {
    taskId: taskIdStr,
    stepIdx,
    score,
    reason,
  });

  await deps.saveSubmittedRating(taskIdStr, stepIdx, score);
  try {
    logTaskTimeline("rater_finalizing", {
      taskId: taskIdStr,
      stepIdx,
      score,
    });
    await deps.finalizeExternalStep([taskId, stepIdx, score]);
  } catch (e) {
    const msg = String(e);
    if (
      msg.includes("revert") ||
      msg.includes("Revert") ||
      msg.includes("execution reverted")
    ) {
      deps.logger.warn(
        `[rater] finalizeExternalStep reverted task=${taskIdStr} step=${stepIdx} — step likely already finalized, suppressing retry`,
      );
      return;
    }
    await deps.deleteSubmittedRating(taskIdStr, stepIdx);
    throw e;
  }

  const newState = score >= MIN_QUALITY ? StepState.Succeeded : StepState.Failed;
  await deps.upsertStep(
    taskIdStr,
    stepIdx,
    "0",
    null,
    newState,
    instruction,
    null,
    resultHex,
    score,
    null,
  );

  deps.publish(taskIdStr, "step_rated", {
    taskId: taskIdStr,
    stepIdx,
    score,
    reason,
    approved: score >= MIN_QUALITY,
  });
  logTaskTimeline("rater_finalized", {
    taskId: taskIdStr,
    stepIdx,
    score,
    approved: score >= MIN_QUALITY,
  });
}

async function scoreWithClaude(
  anthropic: Pick<Anthropic, "messages">,
  budgetGuard: ReturnType<typeof createAnthropicBudgetGuard>,
  instruction: string,
  result: string,
): Promise<{ score: number; reason: string }> {
  const resultForRating = prepareResultForRating(result);
  const agentHints = buildAgentRatingHints(result);
  const prompt = buildRatingPrompt(instruction, resultForRating, agentHints);

  try {
    budgetGuard.ensureRequestAllowed();
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 128,
      messages: [{ role: "user", content: prompt }],
    });
    budgetGuard.recordUsage((msg as { usage?: unknown }).usage, "claude-haiku-4-5-20251001");

    const text =
      msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(json) as { score: number; reason?: string };
    const haikuScore = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const floor = getDeterministicScoreFloor(result);
    const score = floor != null ? Math.max(floor, haikuScore) : haikuScore;
    return { score, reason: parsed.reason ?? "no reason given" };
  } catch (e) {
    budgetGuard.noteFailure(e);
    console.error("[rater] scoring failed, withholding payment (score=0):", e);
    return { score: 0, reason: String(e) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const defaultRater = createRater();

export function startRater(): void {
  defaultRater.start();
}
