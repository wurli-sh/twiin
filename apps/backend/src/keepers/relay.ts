import {
  keccak256,
  parseAbiItem,
  recoverMessageAddress,
  toBytes,
  toHex,
  type AbiEvent,
} from "viem";
import { buildTwiinDigest, CHAIN_ID, StepState } from "@twiin/shared";
import { publicClient } from "../clients";
import { addresses, defaultStartBlock, orchestratorContract } from "../contracts";
import { env } from "../env";
import {
  deleteSubmittedResult,
  getCursor,
  getExternalAgent,
  getStep,
  isResultSubmitted,
  saveSubmittedResult,
  setCursor,
  setExternalAgentVerification,
  upsertStep,
} from "../db";
import { publish } from "../sse";

const CURSOR_KEY = "relay";
const POLL_MS = 4_000;
const CHUNK = 500n;
const MAX_EXTERNAL_RESULT_SIZE = 16_384;
const externalAgentRequestEvent = parseAbiItem(
  "event ExternalAgentRequest(uint256 indexed taskId, uint8 stepIdx, uint256 configId, address registrant, bytes32 endpointHash, bytes payload, bytes32 reqId, uint64 deadline)",
) as AbiEvent;

type RelayLogArgs = {
  taskId?: bigint | null;
  stepIdx?: number | null;
  configId?: bigint | null;
  registrant?: `0x${string}` | null;
  endpointHash?: `0x${string}` | null;
  payload?: `0x${string}` | null;
  reqId?: `0x${string}` | null;
  deadline?: bigint | null;
};

type ExternalAgentRow = NonNullable<Awaited<ReturnType<typeof getExternalAgent>>>;

type RelayDeps = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<Array<{ args: RelayLogArgs }>>;
  chainId: bigint;
  addresses: { orchestrator: `0x${string}` };
  startBlock: bigint;
  getCursor: (name: string) => Promise<bigint>;
  setCursor: (name: string, block: bigint) => Promise<void>;
  isResultSubmitted: typeof isResultSubmitted;
  saveSubmittedResult: typeof saveSubmittedResult;
  deleteSubmittedResult: typeof deleteSubmittedResult;
  getStep: typeof getStep;
  upsertStep: typeof upsertStep;
  getExternalAgent: typeof getExternalAgent;
  setExternalAgentVerification: typeof setExternalAgentVerification;
  publish: typeof publish;
  submitExternalResult: (
    args: readonly [bigint, number, `0x${string}`, `0x${string}`],
  ) => Promise<unknown>;
  fetchImpl: typeof fetch;
  nowMs: () => number;
  logger: Pick<Console, "log" | "error" | "warn">;
};

type ExecuteResponse = {
  result?: string;
  resultHex?: `0x${string}`;
  signature?: `0x${string}`;
  registrant?: `0x${string}`;
};

export function createRelay(overrides: Partial<RelayDeps> = {}) {
  const deps: RelayDeps = {
    getBlockNumber: () => publicClient.getBlockNumber(),
    getLogs: (args) =>
      publicClient.getLogs(args) as Promise<Array<{ args: RelayLogArgs }>>,
    chainId: BigInt(CHAIN_ID),
    addresses: { orchestrator: addresses.orchestrator },
    startBlock: env.START_BLOCK ?? defaultStartBlock,
    getCursor,
    setCursor,
    isResultSubmitted,
    saveSubmittedResult,
    deleteSubmittedResult,
    getStep,
    upsertStep,
    getExternalAgent,
    setExternalAgentVerification,
    publish,
    submitExternalResult: (args) =>
      orchestratorContract.write.submitExternalResult(args),
    fetchImpl: fetch,
    nowMs: () => Date.now(),
    logger: console,
    ...overrides,
  };

  let running = false;

  async function tick(): Promise<void> {
    const latest = await deps.getBlockNumber();
    const stored = await deps.getCursor(CURSOR_KEY);
    const from = stored === 0n && deps.startBlock > 0n ? deps.startBlock : stored;
    if (from > latest) return;
    const to = from + CHUNK < latest ? from + CHUNK : latest;

    const logs = await deps.getLogs({
      address: deps.addresses.orchestrator,
      event: externalAgentRequestEvent,
      fromBlock: from,
      toBlock: to,
    });

    for (const log of logs) {
      const {
        taskId,
        stepIdx,
        configId,
        registrant,
        endpointHash,
        payload,
        reqId,
        deadline,
      } = log.args;
      if (
        taskId == null ||
        stepIdx == null ||
        configId == null ||
        registrant == null ||
        endpointHash == null ||
        reqId == null
      ) {
        continue;
      }

      const taskIdStr = taskId.toString();
      if (await deps.isResultSubmitted(taskIdStr, stepIdx)) continue;

      if (deadline && BigInt(Math.floor(deps.nowMs() / 1000)) > deadline) {
        deps.logger.log(
          `[relay] step ${taskIdStr}:${stepIdx} deadline passed, skipping`,
        );
        continue;
      }

      try {
        await processExternalStep(deps, {
          taskId,
          stepIdx,
          configId,
          registrant,
          endpointHash,
          payload: payload ?? "0x",
          reqId,
        });
      } catch (e) {
        deps.logger.error(`[relay] failed task=${taskIdStr} step=${stepIdx}:`, e);
      }
    }

    await deps.setCursor(CURSOR_KEY, to + 1n);
  }

  async function poll(): Promise<void> {
    while (running) {
      try {
        await tick();
      } catch (e) {
        deps.logger.error("[relay] error:", e);
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

async function processExternalStep(
  deps: RelayDeps,
  params: {
    taskId: bigint;
    stepIdx: number;
    configId: bigint;
    registrant: `0x${string}`;
    endpointHash: `0x${string}`;
    payload: `0x${string}`;
    reqId: `0x${string}`;
  },
): Promise<void> {
  const { taskId, stepIdx, configId, registrant, endpointHash, payload, reqId } =
    params;
  const taskIdStr = taskId.toString();

  const agent = await deps.getExternalAgent(configId.toString());
  if (!agent || agent.is_active !== 1) {
    throw new Error(`external agent ${configId} not cached or inactive`);
  }
  if (
    agent.registrant.toLowerCase() !== registrant.toLowerCase() ||
    agent.endpoint_hash.toLowerCase() !== endpointHash.toLowerCase()
  ) {
    throw new Error(`external agent ${configId} cache mismatch`);
  }

  if (!(await ensureVerified(deps, agent, configId))) {
    throw new Error(`external agent ${configId} failed verification`);
  }

  const { resultHex, signature } = await executeExternalAgent(
    deps,
    agent,
    taskId,
    stepIdx,
    payload,
    reqId,
  );

  const stepRow = await deps.getStep(taskIdStr, stepIdx);
  if (stepRow && stepRow.state !== StepState.RunningExternal) {
    deps.logger.log(
      `[relay] step ${taskIdStr}:${stepIdx} no longer RunningExternal, skipping`,
    );
    await deps.saveSubmittedResult(taskIdStr, stepIdx, resultHex, signature);
    return;
  }

  await deps.saveSubmittedResult(taskIdStr, stepIdx, resultHex, signature);
  try {
    await deps.submitExternalResult([taskId, stepIdx, resultHex, signature]);
  } catch (e) {
    await deps.deleteSubmittedResult(taskIdStr, stepIdx);
    throw e;
  }

  const payloadText = decodePayload(payload);
  await deps.upsertStep(
    taskIdStr,
    stepIdx,
    configId.toString(),
    StepState.AwaitingRating,
    payloadText,
    reqId,
    resultHex,
    null,
    null,
  );
  deps.publish(taskIdStr, "step_result_submitted", { taskId: taskIdStr, stepIdx });
  deps.logger.log(
    `[relay] submitted external result task=${taskIdStr} step=${stepIdx} config=${configId}`,
  );
}

async function ensureVerified(
  deps: RelayDeps,
  agent: ExternalAgentRow,
  configId: bigint,
): Promise<boolean> {
  if (agent.is_verified === 1) return true;

  try {
    const healthRes = await deps.fetchImpl(new URL("/health", agent.endpoint_url), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!healthRes.ok) {
      throw new Error(`health check failed with ${healthRes.status}`);
    }
    const health = (await healthRes.json()) as {
      status?: string;
      registrant?: string;
    };
    if (
      health.status !== "ok" ||
      health.registrant?.toLowerCase() !== agent.registrant.toLowerCase()
    ) {
      throw new Error("health registrant mismatch");
    }

    const reqId = keccak256(
      toBytes(`verify:${configId.toString()}:${deps.nowMs()}`),
    );
    const execute = await runExecute(deps, agent, 0n, 0, "0x", reqId);
    await verifySignedResult(
      deps,
      0n,
      0,
      reqId,
      agent.registrant as `0x${string}`,
      execute.resultHex,
      execute.signature,
    );

    await deps.setExternalAgentVerification(configId.toString(), true, null);
    return true;
  } catch (error) {
    await deps.setExternalAgentVerification(
      configId.toString(),
      false,
      String(error),
    );
    deps.logger.warn(
      `[relay] verification failed for config=${configId.toString()}: ${String(error)}`,
    );
    return false;
  }
}

async function executeExternalAgent(
  deps: RelayDeps,
  agent: ExternalAgentRow,
  taskId: bigint,
  stepIdx: number,
  payloadHex: `0x${string}`,
  reqId: `0x${string}`,
): Promise<{ resultHex: `0x${string}`; signature: `0x${string}` }> {
  const execute = await runExecute(deps, agent, taskId, stepIdx, payloadHex, reqId);
  await verifySignedResult(
    deps,
    taskId,
    stepIdx,
    reqId,
    agent.registrant as `0x${string}`,
    execute.resultHex,
    execute.signature,
  );
  return execute;
}

async function runExecute(
  deps: RelayDeps,
  agent: ExternalAgentRow,
  taskId: bigint,
  stepIdx: number,
  payloadHex: `0x${string}`,
  reqId: `0x${string}`,
): Promise<{ resultHex: `0x${string}`; signature: `0x${string}` }> {
  const res = await deps.fetchImpl(new URL("/execute", agent.endpoint_url), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      taskId: taskId.toString(),
      stepIdx,
      payload: payloadHex.slice(2),
      reqId,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`execute failed with ${res.status}`);
  }

  const body = (await res.json()) as ExecuteResponse;
  if (!body.signature) throw new Error("missing signature");
  const resultHex = normalizeResult(body);
  if (toBytes(resultHex).length > MAX_EXTERNAL_RESULT_SIZE) {
    throw new Error("result exceeds 16 KB cap");
  }
  if (
    body.registrant &&
    body.registrant.toLowerCase() !== agent.registrant.toLowerCase()
  ) {
    throw new Error("execute registrant mismatch");
  }
  return { resultHex, signature: body.signature };
}

async function verifySignedResult(
  deps: RelayDeps,
  taskId: bigint,
  stepIdx: number,
  reqId: `0x${string}`,
  registrant: `0x${string}`,
  resultHex: `0x${string}`,
  signature: `0x${string}`,
): Promise<void> {
  const digest = buildTwiinDigest({
    chainId: deps.chainId,
    orchestrator: deps.addresses.orchestrator,
    taskId,
    stepIdx,
    externalRequestId: reqId,
    result: resultHex,
  });

  const recovered = await recoverMessageAddress({
    message: { raw: digest },
    signature,
  });
  if (recovered.toLowerCase() !== registrant.toLowerCase()) {
    throw new Error("signed result registrant mismatch");
  }
}

function normalizeResult(body: ExecuteResponse): `0x${string}` {
  if (body.resultHex) return body.resultHex;
  if (typeof body.result === "string") {
    return toHex(new TextEncoder().encode(body.result)) as `0x${string}`;
  }
  throw new Error("missing result");
}

function decodePayload(hex: `0x${string}`): string {
  try {
    return new TextDecoder().decode(Buffer.from(hex.slice(2), "hex"));
  } catch {
    return hex;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const defaultRelay = createRelay();

export function startRelay(): void {
  defaultRelay.start();
}

export async function verifyExternalAgentCacheEntry(
  configId: string,
): Promise<boolean> {
  const agent = await getExternalAgent(configId);
  if (!agent || agent.is_active !== 1) return false;
  return ensureVerified(defaultRelayDeps, agent, BigInt(configId));
}

const defaultRelayDeps = {
  getBlockNumber: () => publicClient.getBlockNumber(),
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) =>
    publicClient.getLogs(args) as Promise<Array<{ args: RelayLogArgs }>>,
  chainId: BigInt(CHAIN_ID),
  addresses: { orchestrator: addresses.orchestrator },
  startBlock: env.START_BLOCK ?? defaultStartBlock,
  getCursor,
  setCursor,
  isResultSubmitted,
  saveSubmittedResult,
  deleteSubmittedResult,
  getStep,
  upsertStep,
  getExternalAgent,
  setExternalAgentVerification,
  publish,
  submitExternalResult: (args: readonly [bigint, number, `0x${string}`, `0x${string}`]) =>
    orchestratorContract.write.submitExternalResult(args),
  fetchImpl: fetch,
  nowMs: () => Date.now(),
  logger: console,
} satisfies RelayDeps;
