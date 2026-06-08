import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTwiinDigest,
  StepState,
  TaskState,
  TrustlessAwaiting,
} from "@twiin/shared";
import AgentOrchestratorAbi from "@twiin/shared/abis/AgentOrchestrator.json";
import TwiinAccountAbi from "@twiin/shared/abis/TwiinAccount.json";
import { encodeAbiParameters, encodeFunctionData } from "viem";
import { decodeTrustlessJaniceResult } from "@twiin/shared";
import { privateKeyToAccount } from "viem/accounts";

const baseEnv = {
  ANTHROPIC_API_KEY: "test-key",
  KEEPER_PRIVATE_KEY:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  TURSO_DB_URL: "file:./test.db",
  RUN_KEEPERS: "false",
};

async function loadKeepers() {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(baseEnv)) {
    vi.stubEnv(key, value);
  }
  const [
    { createIndexer },
    { createRelay },
    { createRater },
    { createTimeoutKeeper },
    { createExternalAgentBootstrap, verifyExternalAgentsNow },
    { createTrustlessResumeKeeper },
  ] = await Promise.all([
    import("../src/keepers/indexer"),
    import("../src/keepers/relay"),
    import("../src/keepers/rater"),
    import("../src/keepers/timeouts"),
    import("../src/keepers/externals"),
    import("../src/keepers/trustless-resume"),
  ]);
  return {
    createIndexer,
    createRelay,
    createRater,
    createTimeoutKeeper,
    createExternalAgentBootstrap,
    verifyExternalAgentsNow,
    createTrustlessResumeKeeper,
  };
}

const externalAgentAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
);

function relayStepRow(
  configId: string,
  reqId: string,
  state: StepState,
  extras: Partial<{
    timeout_seconds: number | null;
    payload: string;
    result_hex: string | null;
    score: number | null;
  }> = {},
) {
  return {
    config_id: configId,
    req_id: reqId,
    state,
    timeout_seconds: 120,
    payload: "",
    result_hex: null,
    score: null,
    ...extras,
  };
}

async function runRelayTicks(
  relay: { tick: () => Promise<void> },
  count = 2,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await relay.tick();
  }
}

function relayQueueDeps() {
  const queue: Array<{
    task_id: string;
    step_idx: number;
    config_id: string;
    req_id: string;
    payload: string;
    registrant: string;
    endpoint_hash: string;
    attempts: number;
  }> = [];

  return {
    getStepsForTask: vi.fn().mockResolvedValue([]),
    getRelayJob: vi.fn().mockResolvedValue(null),
    listFailedRelayJobs: vi.fn().mockResolvedValue([]),
    markRelayJobIndexerLagRetry: vi.fn().mockResolvedValue(undefined),
    reactivateRelayJob: vi.fn().mockResolvedValue(undefined),
    enqueueRelayJob: vi.fn().mockImplementation(async (input: {
      taskId: string;
      stepIdx: number;
      configId: string;
      reqId: string;
      payload: string;
      registrant: string;
      endpointHash: string;
    }) => {
      const exists = queue.some(
        (row) => row.task_id === input.taskId && row.step_idx === input.stepIdx,
      );
      if (exists) return false;
      queue.push({
        task_id: input.taskId,
        step_idx: input.stepIdx,
        config_id: input.configId,
        req_id: input.reqId,
        payload: input.payload,
        registrant: input.registrant,
        endpoint_hash: input.endpointHash,
        attempts: 0,
      });
      return true;
    }),
    listDueRelayJobs: vi.fn().mockImplementation(async () => queue.slice()),
    markRelayJobRetry: vi.fn().mockResolvedValue(undefined),
    completeRelayJob: vi.fn().mockImplementation(async (taskId: string, stepIdx: number) => {
      const idx = queue.findIndex(
        (row) => row.task_id === taskId && row.step_idx === stepIdx,
      );
      if (idx >= 0) queue.splice(idx, 1);
    }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("externals keeper", () => {
  it("retries startup verification until pending agents verify", async () => {
    const { verifyExternalAgentsNow } = await loadKeepers();
    const log = vi.fn();
    const warn = vi.fn();
    let verified = false;

    const summary = await verifyExternalAgentsNow({
      listExternalAgents: vi.fn(async () => [
        {
          config_id: "6",
          registrant: "0x1234567890123456789012345678901234567890",
          endpoint_url: "http://127.0.0.1:3011",
          endpoint_hash: "0x" + "44".repeat(32),
          capabilities: [],
          is_active: 1,
          is_verified: verified ? 1 : 0,
          last_verified_at: null,
          last_error: null,
        },
      ]),
      verifyExternalAgent: vi.fn(async () => {
        verified = true;
        return true;
      }),
      getExternalAgent: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
      startupVerifyIntervalMs: 1,
      startupVerifyMaxAttempts: 3,
      logger: { log, warn, error: vi.fn() },
    });

    expect(summary).toEqual({ total: 1, verified: 1, failed: 0 });
    expect(log).toHaveBeenCalledWith(
      "[externals] startup verification complete: 1/1 verified",
    );
  });

  it("reports incomplete startup verification after max attempts", async () => {
    const { verifyExternalAgentsNow } = await loadKeepers();
    const warn = vi.fn();

    const summary = await verifyExternalAgentsNow({
      listExternalAgents: vi.fn(async () => [
        {
          config_id: "7",
          registrant: "0x1234567890123456789012345678901234567890",
          endpoint_url: "http://127.0.0.1:3016",
          endpoint_hash: "0x" + "55".repeat(32),
          capabilities: [],
          is_active: 1,
          is_verified: 0,
          last_verified_at: null,
          last_error: "fetch failed",
        },
      ]),
      verifyExternalAgent: vi.fn().mockResolvedValue(false),
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "7",
        last_error: "fetch failed",
      }),
      sleep: vi.fn().mockResolvedValue(undefined),
      startupVerifyIntervalMs: 1,
      startupVerifyMaxAttempts: 2,
      logger: { log: vi.fn(), warn, error: vi.fn() },
    });

    expect(summary).toEqual({ total: 1, verified: 0, failed: 1 });
    expect(warn).toHaveBeenCalledWith(
      "[externals] startup verification incomplete: 1/1 still unverified",
    );
  });
});

describe("indexer keeper", () => {
  it("rewinds the indexer cursor when it is ahead of the chain tip", async () => {
    const { createIndexer } = await loadKeepers();
    const setCursor = vi.fn().mockResolvedValue(undefined);
    const indexer = createIndexer({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(150n),
      setCursor,
      getLogs: vi.fn(),
      getTransaction: vi.fn(),
      getStep: vi.fn(),
      getExternalAgent: vi.fn().mockResolvedValue(null),
      upsertExternalAgent: vi.fn().mockResolvedValue(undefined),
      deactivateExternalAgent: vi.fn().mockResolvedValue(undefined),
      upsertTask: vi.fn().mockResolvedValue(undefined),
      deleteTaskArtifactsForTask: vi.fn().mockResolvedValue(undefined),
      finalizeTaskSteps: vi.fn().mockResolvedValue(undefined),
      upsertStep: vi.fn().mockResolvedValue(undefined),
      updateTaskState: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
      addresses: {
        orchestrator: "0x1234567890123456789012345678901234567890",
        agentRegistry: "0x9999999999999999999999999999999999999999",
      },
      startBlock: 50n,
    });

    await indexer.tick();

    expect(setCursor).toHaveBeenCalledWith("indexer", 99n);
  });

  it("indexes task and step lifecycle events into the DB layer", async () => {
    const { createIndexer } = await loadKeepers();
    const upsertTask = vi.fn().mockResolvedValue(undefined);
    const upsertStep = vi.fn().mockResolvedValue(undefined);
    const updateTaskState = vi.fn().mockResolvedValue(undefined);
    const finalizeTaskSteps = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const setCursor = vi.fn().mockResolvedValue(undefined);
    const upsertExternalAgent = vi.fn().mockResolvedValue(undefined);
    const getLogs = vi.fn(async ({ event }: { event: { name?: string } }) => {
      switch (event.name) {
        case "TaskCreated":
          return [
            {
              blockNumber: 25n,
              args: {
                taskId: 7n,
                personalAgentId: 9n,
                mode: 1,
                budgetWei: 1000n,
              },
            },
          ];
        case "ExternalAgentRequest":
          return [
            {
              args: {
                taskId: 7n,
                stepIdx: 0,
                configId: 6n,
                payload: "0x68656c6c6f",
                reqId: "0x" + "11".repeat(32),
                deadline: 500n,
              },
            },
          ];
        case "StepStateChanged":
          return [{ args: { taskId: 7n, stepIdx: 0, state: StepState.RunningExternal } }];
        case "ExternalResultPending":
          return [{ args: { taskId: 7n, stepIdx: 0, result: "0x626f6479" } }];
        case "ExternalStepApproved":
          return [{ args: { taskId: 7n, stepIdx: 0, score: 88 } }];
        case "ExternalStepRejected":
          return [];
        case "TaskCompleted":
          return [{ args: { taskId: 7n, result: "done" } }];
        case "TaskAborted":
          return [];
        case "ExternalAgentRegistered":
          return [
            {
              args: {
                configId: 6n,
                registrant: externalAgentAccount.address,
                endpointUrl: "https://agent.example",
                endpointHash: "0x" + "44".repeat(32),
                caps: [],
              },
            },
          ];
        case "ExternalEndpointUpdated":
          return [];
        case "ExternalDeregistered":
          return [];
        default:
          return [];
      }
    });

    const indexer = createIndexer({
      getBlockNumber: vi.fn().mockResolvedValue(50n),
      getCursor: vi.fn().mockResolvedValue(20n),
      setCursor,
      getLogs: getLogs as never,
      deleteTaskArtifactsForTask: vi.fn().mockResolvedValue(undefined),
      finalizeTaskSteps,
      getExternalAgent: vi.fn().mockResolvedValue(null),
      upsertExternalAgent,
      deactivateExternalAgent: vi.fn().mockResolvedValue(undefined),
      upsertTask,
      upsertStep,
      updateTaskState,
      patchTrustlessTask: vi.fn().mockResolvedValue(undefined),
      publish,
      addresses: {
        orchestrator: "0x1234567890123456789012345678901234567890",
        agentRegistry: "0x9999999999999999999999999999999999999999",
      },
      startBlock: 0n,
    });

    await indexer.tick();

    expect(upsertTask).toHaveBeenCalledWith(
      "7",
      "9",
      1,
      "1000",
      TaskState.Running,
      0,
      0,
      25,
    );
    expect(upsertStep).toHaveBeenCalledWith(
      "7",
      0,
      "6",
      null,
      StepState.RunningExternal,
      "hello",
      "0x" + "11".repeat(32),
      null,
      null,
      500,
    );
    expect(updateTaskState).toHaveBeenCalledWith("7", TaskState.Completed);
    expect(finalizeTaskSteps).toHaveBeenCalledWith("7", StepState.Succeeded);
    expect(upsertExternalAgent).toHaveBeenCalledWith(
      "6",
      externalAgentAccount.address,
      "https://agent.example",
      "0x" + "44".repeat(32),
      [],
    );
    expect(setCursor).toHaveBeenCalledWith("indexer", 51n);
    expect(publish).toHaveBeenCalledWith(
      "7",
      "task_completed",
      expect.objectContaining({
        taskId: "7",
        result: "done",
        preview: "done",
      }),
    );
  });

  it("derives native step deadlines from createTask calldata", async () => {
    const { createIndexer } = await loadKeepers();
    const upsertStep = vi.fn().mockResolvedValue(undefined);
    const createTaskCalldata = encodeFunctionData({
      abi: AgentOrchestratorAbi,
      functionName: "createTask",
      args: [
        9n,
        [
          {
            subAgentConfigId: 2n,
            payload: "0x",
            maxCostWei: 1000n,
            timeoutSeconds: 60,
          },
        ],
        1000n,
        1,
      ],
    });
    const executeCalldata = encodeFunctionData({
      abi: TwiinAccountAbi,
      functionName: "execute",
      args: [
        "0x1234567890123456789012345678901234567890",
        1000n,
        createTaskCalldata,
        0,
      ],
    });

    const indexer = createIndexer({
      getBlockNumber: vi.fn().mockResolvedValue(30n),
      getBlockTimestamp: vi.fn().mockResolvedValue(1_000),
      getCursor: vi.fn().mockResolvedValue(20n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn(async ({ event }: { event: { name?: string } }) => {
        switch (event.name) {
          case "TaskCreated":
            return [
              {
                blockNumber: 25n,
                transactionHash: "0x" + "12".repeat(32),
                args: {
                  taskId: 7n,
                  personalAgentId: 9n,
                  mode: 1,
                  budgetWei: 1000n,
                },
              },
            ];
          case "StepStateChanged":
            return [
              {
                blockNumber: 25n,
                args: {
                  taskId: 7n,
                  stepIdx: 0,
                  state: StepState.RunningNative,
                },
              },
            ];
          default:
            return [];
        }
      }) as never,
      getTransaction: vi.fn().mockResolvedValue({ input: executeCalldata }),
      getStep: vi.fn().mockResolvedValue({
        config_id: "2",
        timeout_seconds: 60,
        state: StepState.Pending,
        payload: "",
        req_id: null,
        result_hex: null,
        score: null,
      }),
      getExternalAgent: vi.fn().mockResolvedValue(null),
      upsertExternalAgent: vi.fn().mockResolvedValue(undefined),
      deactivateExternalAgent: vi.fn().mockResolvedValue(undefined),
      upsertTask: vi.fn().mockResolvedValue(undefined),
      deleteTaskArtifactsForTask: vi.fn().mockResolvedValue(undefined),
      finalizeTaskSteps: vi.fn().mockResolvedValue(undefined),
      upsertStep,
      updateTaskState: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
      addresses: {
        orchestrator: "0x1234567890123456789012345678901234567890",
        agentRegistry: "0x9999999999999999999999999999999999999999",
      },
      startBlock: 0n,
    });

    await indexer.tick();

    expect(upsertStep).toHaveBeenCalledWith(
      "7",
      0,
      "0",
      null,
      StepState.RunningNative,
      "",
      null,
      null,
      null,
      1060,
    );
  });
});

describe("relay keeper", () => {
  it("rewinds the relay cursor when it is ahead of the chain tip", async () => {
    const { createRelay } = await loadKeepers();
    const setCursor = vi.fn().mockResolvedValue(undefined);
    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(150n),
      setCursor,
      getLogs: vi.fn(),
      isResultSubmitted: vi.fn(),
      saveSubmittedResult: vi.fn(),
      deleteSubmittedResult: vi.fn(),
      getStep: vi.fn(),
      upsertStep: vi.fn(),
      publish: vi.fn(),
      getExternalAgent: vi.fn(),
      setExternalAgentVerification: vi.fn(),
      submitExternalResult: vi.fn(),
      fetchImpl: vi.fn(),
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 50n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
    });

    await relay.tick();

    expect(setCursor).toHaveBeenCalledWith("relay", 99n);
  });

  it("submits external results and updates the step state", async () => {
    const { createRelay } = await loadKeepers();
    const saveSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const upsertStep = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const submitExternalResult = vi.fn().mockResolvedValue(undefined);
    const reqId = "0x" + "22".repeat(32);
    const resultText = "analysis complete";
    const digest = buildTwiinDigest({
      chainId: 50312n,
      orchestrator: "0x1234567890123456789012345678901234567890",
      taskId: 5n,
      stepIdx: 1,
      externalRequestId: reqId as `0x${string}`,
      result: resultText,
    });
    const signature = await externalAgentAccount.signMessage({
      message: { raw: digest },
    });

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult,
      deleteSubmittedResult: vi.fn().mockResolvedValue(undefined),
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("6", reqId, StepState.RunningExternal),
      ),
      upsertStep,
      publish,
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "6",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      submitExternalResult,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: resultText,
            signature,
            registrant: externalAgentAccount.address,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as never,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
    });

    await runRelayTicks(relay);

    expect(saveSubmittedResult).toHaveBeenCalledOnce();
    expect(submitExternalResult).toHaveBeenCalledOnce();
    expect(upsertStep).toHaveBeenCalledWith(
      "5",
      1,
      "6",
      null,
      StepState.AwaitingRating,
      "instruction",
      reqId,
      expect.stringMatching(/^0x/),
      null,
      null,
    );
    expect(publish).toHaveBeenCalledWith(
      "5",
      "step_result_submitted",
      { taskId: "5", stepIdx: 1 },
    );
  });

  it("re-fetches step state after executeExternalAgent before submitting", async () => {
    const { createRelay } = await loadKeepers();
    const saveSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const upsertStep = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const submitExternalResult = vi.fn().mockResolvedValue(undefined);
    const reqId = "0x" + "22".repeat(32);
    const resultText = "analysis complete";

    // Signature must match the (taskId, stepIdx, reqId, resultText) digest.
    const digest = buildTwiinDigest({
      chainId: 50312n,
      orchestrator: "0x1234567890123456789012345678901234567890",
      taskId: 5n,
      stepIdx: 1,
      externalRequestId: reqId as `0x${string}`,
      result: resultText,
    });
    const signature = await externalAgentAccount.signMessage({
      message: { raw: digest },
    });

    const getStep = vi
      .fn()
      // Pre-execute gate requires an aligned RunningExternal row.
      .mockResolvedValueOnce(relayStepRow("6", reqId, StepState.RunningExternal))
      // Post-execute re-fetch should still allow submission.
      .mockResolvedValueOnce(relayStepRow("6", reqId, StepState.RunningExternal));

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult,
      deleteSubmittedResult: vi.fn().mockResolvedValue(undefined),
      getStep,
      upsertStep,
      publish,
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "6",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      submitExternalResult,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: resultText,
            signature,
            registrant: externalAgentAccount.address,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as never,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
    });

    await runRelayTicks(relay);

    expect(saveSubmittedResult).toHaveBeenCalledOnce();
    expect(submitExternalResult).toHaveBeenCalledOnce();
    expect(upsertStep).toHaveBeenCalledWith(
      "5",
      1,
      "6",
      null,
      StepState.AwaitingRating,
      "instruction",
      reqId,
      expect.stringMatching(/^0x/),
      null,
      null,
    );
    expect(publish).toHaveBeenCalledWith(
      "5",
      "step_result_submitted",
      { taskId: "5", stepIdx: 1 },
    );
  });

  it("does not poison submitted_results when fresh step state is terminal", async () => {
    const { createRelay } = await loadKeepers();
    const saveSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const upsertStep = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const submitExternalResult = vi.fn().mockResolvedValue(undefined);
    const reqId = "0x" + "22".repeat(32);
    const resultText = "analysis complete";

    const digest = buildTwiinDigest({
      chainId: 50312n,
      orchestrator: "0x1234567890123456789012345678901234567890",
      taskId: 5n,
      stepIdx: 1,
      externalRequestId: reqId as `0x${string}`,
      result: resultText,
    });
    const signature = await externalAgentAccount.signMessage({
      message: { raw: digest },
    });

    const getStep = vi
      .fn()
      .mockResolvedValueOnce(relayStepRow("6", reqId, StepState.RunningExternal))
      .mockResolvedValueOnce(relayStepRow("6", reqId, StepState.TimedOut));

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult,
      deleteSubmittedResult: vi.fn().mockResolvedValue(undefined),
      getStep,
      upsertStep,
      publish,
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "6",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      submitExternalResult,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: resultText,
            signature,
            registrant: externalAgentAccount.address,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as never,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
    });

    await runRelayTicks(relay);

    expect(saveSubmittedResult).not.toHaveBeenCalled();
    expect(submitExternalResult).not.toHaveBeenCalled();
    expect(upsertStep).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("proceeds via chain fallback when step row is Pending before execute", async () => {
    const { createRelay } = await loadKeepers();
    const saveSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const upsertStep = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const submitExternalResult = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn();
    const reqId = "0x" + "22".repeat(32);

    const markRelayJobRetry = vi.fn().mockResolvedValue(undefined);

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult,
      deleteSubmittedResult: vi.fn().mockResolvedValue(undefined),
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("6", reqId, StepState.Pending, { req_id: null }),
      ),
      readOnChainTask: vi.fn().mockResolvedValue([0, 0n, 0, 0n, 0n, 0n, 1]),
      upsertStep,
      publish,
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "6",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      submitExternalResult,
      fetchImpl: fetchImpl as never,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
      markRelayJobRetry,
    });

    await runRelayTicks(relay);

    expect(fetchImpl).toHaveBeenCalled();
    expect(markRelayJobRetry).toHaveBeenCalled();
  });

  it("retries when step row is stale from task-id reuse (Succeeded + wrong config)", async () => {
    const { createRelay } = await loadKeepers();
    const saveSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const upsertStep = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const submitExternalResult = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn();
    const reqId = "0x" + "22".repeat(32);
    const staleReqId = "0x" + "11".repeat(32);

    const markRelayJobRetry = vi.fn().mockResolvedValue(undefined);

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 3n,
            stepIdx: 0,
            configId: 7n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult,
      deleteSubmittedResult: vi.fn().mockResolvedValue(undefined),
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("2", staleReqId, StepState.Succeeded),
      ),
      upsertStep,
      publish,
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "7",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      submitExternalResult,
      fetchImpl: fetchImpl as never,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
      markRelayJobRetry,
    });

    await runRelayTicks(relay);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(saveSubmittedResult).not.toHaveBeenCalled();
    expect(submitExternalResult).not.toHaveBeenCalled();
    expect(markRelayJobRetry).toHaveBeenCalled();
  });

  it("enriches external payloads with prior step outputs before execute", async () => {
    const { createRelay } = await loadKeepers();
    const priorJson = '{"sentiment":"bullish"}';
    const priorHex = `0x${Buffer.from(priorJson, "utf8").toString("hex")}` as `0x${string}`;
    const reqId = "0x" + "33".repeat(32);
    const resultText = "brief complete";
    const digest = buildTwiinDigest({
      chainId: 50312n,
      orchestrator: "0x1234567890123456789012345678901234567890",
      taskId: 9n,
      stepIdx: 1,
      externalRequestId: reqId as `0x${string}`,
      result: resultText,
    });
    const signature = await externalAgentAccount.signMessage({
      message: { raw: digest },
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: resultText,
          signature,
          registrant: externalAgentAccount.address,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as never;

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 9n,
            stepIdx: 1,
            configId: 7n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "55".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult: vi.fn().mockResolvedValue(undefined),
      deleteSubmittedResult: vi.fn().mockResolvedValue(undefined),
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("7", reqId, StepState.RunningExternal),
      ),
      upsertStep: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
      submitExternalResult: vi.fn().mockResolvedValue(undefined),
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "7",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "55".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      fetchImpl,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
      getStepsForTask: vi.fn().mockResolvedValue([
        {
          step_idx: 0,
          config_id: "6",
          timeout_seconds: null,
          state: StepState.Succeeded,
          payload: '{"channel":"somnia"}',
          req_id: null,
          result_hex: priorHex,
          score: null,
          deadline: null,
          consensus_validators: null,
          consensus_receipt_id: null,
          consensus_median_cost_wei: null,
        },
      ]),
    });

    await runRelayTicks(relay);

    expect(fetchImpl).toHaveBeenCalled();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body)) as { payload: string };
    const decodedPayload = Buffer.from(body.payload, "hex").toString("utf8");
    expect(decodedPayload).toContain("Previous step outputs:");
    expect(decodedPayload).toContain('"sentiment":"bullish"');
  });

  it("rolls back dedupe state when chain submission fails", async () => {
    const { createRelay } = await loadKeepers();
    const deleteSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const reqId = "0x" + "22".repeat(32);
    const digest = buildTwiinDigest({
      chainId: 50312n,
      orchestrator: "0x1234567890123456789012345678901234567890",
      taskId: 5n,
      stepIdx: 1,
      externalRequestId: reqId as `0x${string}`,
      result: "analysis complete",
    });
    const signature = await externalAgentAccount.signMessage({
      message: { raw: digest },
    });
    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult: vi.fn().mockResolvedValue(undefined),
      deleteSubmittedResult,
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("6", reqId, StepState.RunningExternal),
      ),
      upsertStep: vi.fn(),
      publish: vi.fn(),
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "6",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      submitExternalResult: vi.fn().mockRejectedValue(new Error("rpc failed")),
      fetchImpl: vi.fn(() =>
        Promise.resolve(new Response(
          JSON.stringify({
            result: resultText,
            signature,
            registrant: externalAgentAccount.address,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )),
      ) as never,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
    });

    await relay.tick();

    expect(deleteSubmittedResult).toHaveBeenCalledWith("5", 1);
  });

  it("skips expired external requests", async () => {
    const { createRelay } = await loadKeepers();
    const submitExternalResult = vi.fn();
    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x00",
            reqId: "0x" + "22".repeat(32),
            deadline: 1n,
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult: vi.fn(),
      deleteSubmittedResult: vi.fn(),
      getStep: vi.fn(),
      upsertStep: vi.fn(),
      publish: vi.fn(),
      getExternalAgent: vi.fn(),
      setExternalAgentVerification: vi.fn(),
      submitExternalResult,
      fetchImpl: vi.fn(),
      nowMs: () => 10_000,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
    });

    await relay.tick();

    expect(submitExternalResult).not.toHaveBeenCalled();
  });

  it("clears stale submitted_results when step is still RunningExternal", async () => {
    const { createRelay } = await loadKeepers();
    const reqId = "0x" + "22".repeat(32);
    const resultText = "analysis complete";
    const digest = buildTwiinDigest({
      chainId: 50312n,
      orchestrator: "0x1234567890123456789012345678901234567890",
      taskId: 5n,
      stepIdx: 1,
      externalRequestId: reqId as `0x${string}`,
      result: resultText,
    });
    const signature = await externalAgentAccount.signMessage({
      message: { raw: digest },
    });
    const deleteSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const saveSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const submitExternalResult = vi.fn().mockResolvedValue(undefined);
    const completeRelayJob = vi.fn().mockResolvedValue(undefined);

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false),
      saveSubmittedResult,
      deleteSubmittedResult,
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("6", reqId, StepState.RunningExternal),
      ),
      upsertStep: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
      submitExternalResult,
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "6",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: resultText,
            signature,
            registrant: externalAgentAccount.address,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as never,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
      completeRelayJob,
    });

    await runRelayTicks(relay);

    expect(deleteSubmittedResult).toHaveBeenCalledWith("5", 1);
    expect(submitExternalResult).toHaveBeenCalledOnce();
    expect(completeRelayJob).toHaveBeenCalledOnce();
    expect(
      submitExternalResult.mock.invocationCallOrder[0],
    ).toBeLessThan(completeRelayJob.mock.invocationCallOrder[0]!);
  });

  it("uses indexer-lag retry when step row stays Pending after execute", async () => {
    const { createRelay } = await loadKeepers();
    const reqId = "0x" + "22".repeat(32);
    const resultText = "analysis complete";
    const digest = buildTwiinDigest({
      chainId: 50312n,
      orchestrator: "0x1234567890123456789012345678901234567890",
      taskId: 5n,
      stepIdx: 1,
      externalRequestId: reqId as `0x${string}`,
      result: resultText,
    });
    const signature = await externalAgentAccount.signMessage({
      message: { raw: digest },
    });
    const relayDeps = relayQueueDeps();
    const markRelayJobRetry = vi.fn().mockResolvedValue(undefined);
    const markRelayJobIndexerLagRetry = vi.fn().mockResolvedValue(undefined);
    relayDeps.markRelayJobRetry = markRelayJobRetry;
    relayDeps.markRelayJobIndexerLagRetry = markRelayJobIndexerLagRetry;

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult: vi.fn(),
      deleteSubmittedResult: vi.fn().mockResolvedValue(undefined),
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("6", reqId, StepState.Pending, { req_id: null }),
      ),
      readOnChainTask: vi.fn().mockResolvedValue([0, 0n, 0, 0n, 0n, 0n, 1]),
      upsertStep: vi.fn(),
      publish: vi.fn(),
      submitExternalResult: vi.fn(),
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "6",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn(() =>
        Promise.resolve(new Response(
          JSON.stringify({
            result: resultText,
            signature,
            registrant: externalAgentAccount.address,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )),
      ) as never,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayDeps,
    });

    await runRelayTicks(relay, 1);

    expect(markRelayJobIndexerLagRetry).toHaveBeenCalledOnce();
    expect(markRelayJobRetry).not.toHaveBeenCalled();
  });

  it("reactivates failed relay jobs when a new dispatch is detected", async () => {
    const { createRelay } = await loadKeepers();
    const reqId = "0x" + "22".repeat(32);
    const deleteSubmittedResult = vi.fn().mockResolvedValue(undefined);
    const enqueueRelayJob = vi.fn().mockResolvedValue(false);
    const getRelayJob = vi.fn().mockResolvedValue({
      status: "failed",
      attempts: 3,
      last_error: "exhausted",
    });
    const reactivateRelayJob = vi.fn().mockResolvedValue(undefined);

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        {
          args: {
            taskId: 5n,
            stepIdx: 1,
            configId: 6n,
            registrant: externalAgentAccount.address,
            endpointHash: "0x" + "44".repeat(32),
            payload: "0x696e737472756374696f6e",
            reqId,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
          },
        },
      ]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult: vi.fn(),
      getStep: vi.fn(),
      upsertStep: vi.fn(),
      publish: vi.fn(),
      submitExternalResult: vi.fn(),
      getExternalAgent: vi.fn(),
      setExternalAgentVerification: vi.fn(),
      fetchImpl: vi.fn(),
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
      deleteSubmittedResult,
      enqueueRelayJob,
      getRelayJob,
      reactivateRelayJob,
    });

    await relay.tick();

    expect(deleteSubmittedResult).toHaveBeenCalledWith("5", 1);
    expect(reactivateRelayJob).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "5",
        stepIdx: 1,
        configId: "6",
        reqId,
      }),
    );
  });

  it("reactivates failed relay jobs for running external steps during recovery scan", async () => {
    const { createRelay } = await loadKeepers();
    const reqId = "0x" + "22".repeat(32);
    const reactivateRelayJob = vi.fn().mockResolvedValue(undefined);

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(100n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult: vi.fn(),
      deleteSubmittedResult: vi.fn(),
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("8", reqId, StepState.RunningExternal),
      ),
      readOnChainTask: vi.fn().mockResolvedValue([0, 0n, 0, 0n, 0n, 0n, 1]),
      upsertStep: vi.fn(),
      publish: vi.fn(),
      submitExternalResult: vi.fn(),
      getExternalAgent: vi.fn(),
      setExternalAgentVerification: vi.fn(),
      fetchImpl: vi.fn(),
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayQueueDeps(),
      listFailedRelayJobs: vi.fn().mockResolvedValue([
        {
          task_id: "26",
          step_idx: 0,
          config_id: "8",
          req_id: reqId,
          payload: "0x00",
          registrant: externalAgentAccount.address,
          endpoint_hash: "0x" + "44".repeat(32),
          attempts: 3,
        },
      ]),
      reactivateRelayJob,
    });

    await relay.tick();

    expect(reactivateRelayJob).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "26",
        stepIdx: 0,
        configId: "8",
        reqId,
      }),
    );
  });

  it("retries via regular backoff when step is Pending and chain says task not running", async () => {
    const { createRelay } = await loadKeepers();
    const reqId = "0x" + "22".repeat(32);
    const relayDeps = relayQueueDeps();
    const markRelayJobIndexerLagRetry = vi.fn().mockResolvedValue(undefined);
    const markRelayJobRetry = vi.fn().mockResolvedValue(undefined);
    relayDeps.markRelayJobIndexerLagRetry = markRelayJobIndexerLagRetry;
    relayDeps.markRelayJobRetry = markRelayJobRetry;

    const relay = createRelay({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([]) as never,
      isResultSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedResult: vi.fn(),
      deleteSubmittedResult: vi.fn(),
      getStep: vi.fn().mockResolvedValue(
        relayStepRow("6", reqId, StepState.Pending, { req_id: null }),
      ),
      readOnChainTask: vi.fn().mockResolvedValue([0, 0n, 0, 0n, 0n, 0n, 0]),
      upsertStep: vi.fn(),
      publish: vi.fn(),
      submitExternalResult: vi.fn(),
      getExternalAgent: vi.fn().mockResolvedValue({
        config_id: "6",
        registrant: externalAgentAccount.address,
        endpoint_url: "https://agent.example",
        endpoint_hash: "0x" + "44".repeat(32),
        capabilities: [],
        is_active: 1,
        is_verified: 1,
        last_verified_at: 1,
        last_error: null,
      }),
      setExternalAgentVerification: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn(),
      nowMs: () => 1_000_000_000_000,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      chainId: 50312n,
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...relayDeps,
      listDueRelayJobs: vi.fn().mockResolvedValue([
        {
          task_id: "5",
          step_idx: 1,
          config_id: "6",
          req_id: reqId,
          payload: "0x696e737472756374696f6e",
          registrant: externalAgentAccount.address,
          endpoint_hash: "0x" + "44".repeat(32),
          attempts: 0,
        },
      ]),
    });

    for (let i = 0; i < 4; i += 1) {
      await relay.tick();
    }

    expect(markRelayJobRetry).toHaveBeenCalled();
    expect(markRelayJobIndexerLagRetry).not.toHaveBeenCalled();
  });
});

describe("timeout keeper", () => {
  it("fires the relevant timeout functions for expired steps and tasks", async () => {
    const { createTimeoutKeeper } = await loadKeepers();
    const timeoutExternalStep = vi.fn().mockResolvedValue(undefined);
    const timeoutRating = vi.fn().mockResolvedValue(undefined);
    const timeoutNativeStep = vi.fn().mockResolvedValue(undefined);
    const timeoutTask = vi.fn().mockResolvedValue(undefined);

    const keeper = createTimeoutKeeper({
      getTimedOutSteps: vi.fn().mockResolvedValue([
        { task_id: "1", step_idx: 0, state: StepState.RunningExternal, deadline: 10 },
        { task_id: "2", step_idx: 1, state: StepState.AwaitingRating, deadline: 10 },
        { task_id: "3", step_idx: 2, state: StepState.RunningNative, deadline: 10 },
      ]),
      readNextTaskId: vi.fn().mockResolvedValue(4n),
      readTask: vi
        .fn(async (taskId: bigint) => {
          if (taskId === 4n) {
            return [0, 1n, 0, 100n, 0n, 10n, TaskState.Running] as const;
          }
          return [0, 1n, 0, 100n, 0n, 999999n, TaskState.Completed] as const;
        }),
      timeoutExternalStep,
      timeoutRating,
      timeoutNativeStep,
      timeoutTask,
      nowSeconds: () => 20,
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await keeper.tick();

    expect(timeoutExternalStep).toHaveBeenCalledWith([1n, 0]);
    expect(timeoutRating).toHaveBeenCalledWith([2n, 1]);
    expect(timeoutNativeStep).toHaveBeenCalledWith([3n, 2]);
    expect(timeoutTask).toHaveBeenCalledWith([4n]);
  });
});

describe("rater helpers", () => {
  it("prepareResultForRating extracts structured JSON fields", async () => {
    const { prepareResultForRating, buildRatingPrompt } = await import(
      "../src/keepers/rater-scoring"
    );
    const raw = JSON.stringify({
      type: "dreamdex-mcp",
      source: "dexscreener",
      findings: ["SOMI ~$0.42"],
      topPair: { symbol: "SOMI", priceUsd: "0.42" },
      orderbook: { midPrice: "0.42", note: "proxy" },
    });
    const prepared = prepareResultForRating(raw);
    expect(prepared).toContain("type: dreamdex-mcp");
    expect(prepared).toContain("SOMI ~$0.42");
    expect(prepared).toContain('"symbol":"SOMI"');
    expect(prepared.length).toBeLessThanOrEqual(4096);

    const prompt = buildRatingPrompt(
      '{"action":"orderbook"}',
      prepared,
      "\nRATING GUIDANCE: proxy ok",
    );
    expect(prompt).toContain("RATING GUIDANCE");
    expect(prompt).toContain("orderbook:");
  });

  it("prepareResultForRating falls back to raw text for non-JSON", async () => {
    const { prepareResultForRating } = await import("../src/keepers/rater-scoring");
    const raw = "plain text result " + "x".repeat(5000);
    expect(prepareResultForRating(raw).length).toBe(4096);
  });

  it("buildAgentRatingHints includes coingecko corroboration guidance", async () => {
    const { buildAgentRatingHints, prepareResultForRating } = await import(
      "../src/keepers/rater-scoring"
    );
    const raw = JSON.stringify({
      type: "dreamdex-mcp",
      source: "coingecko",
      id: "somnia",
      somnia: { usd: 0.76, usd_24h_change: -1.2 },
      findings: ["somnia ~$0.76 (CoinGecko)"],
    });
    expect(prepareResultForRating(raw)).toContain('"usd":0.76');
    expect(buildAgentRatingHints(raw)).toContain("CoinGecko corroboration");
  });

  it("prepareResultForRating includes reactivity-lens block range and events", async () => {
    const { prepareResultForRating } = await import("../src/keepers/rater-scoring");
    const raw = JSON.stringify({
      type: "reactivity-lens",
      source: "somnia-reactivity",
      lookbackBlocks: 1000,
      fromBlock: "403892195",
      latestBlock: "403893195",
      blocksScanned: 1001,
      summary: "Scanned blocks 403892195–403893195 (1001 blocks). Found 0 FeedPublished.",
      refreshEvents: { feedPublished: 0, scheduled: 0, skipped: 0 },
      findings: ["Block window: #403892195–#403893195 (1001 blocks scanned via eth_getLogs)"],
    });
    const prepared = prepareResultForRating(raw);
    expect(prepared).toContain("lookbackBlocks: 1000");
    expect(prepared).toContain("fromBlock: 403892195");
    expect(prepared).toContain("blocksScanned: 1001");
    expect(prepared).toContain('"feedPublished":0');
  });

  it("buildAgentRatingHints includes reactivity-lens guidance", async () => {
    const { buildAgentRatingHints } = await import("../src/keepers/rater-scoring");
    const raw = JSON.stringify({ type: "reactivity-lens", source: "somnia-reactivity" });
    expect(buildAgentRatingHints(raw)).toContain("reactivity-lens");
    expect(buildAgentRatingHints(raw)).toContain("Zero events");
  });

  it("getDeterministicScoreFloor approves valid empty reactivity-lens scans", async () => {
    const { getDeterministicScoreFloor } = await import("../src/keepers/rater-scoring");
    const valid = JSON.stringify({
      type: "reactivity-lens",
      lookbackBlocks: 1000,
      fromBlock: "403892195",
      latestBlock: "403893195",
      blocksScanned: 1001,
      refreshEvents: { feedPublished: 0, scheduled: 0, skipped: 0 },
    });
    expect(getDeterministicScoreFloor(valid)).toBe(45);

    const derived = JSON.stringify({
      type: "reactivity-lens",
      lookbackBlocks: 1000,
      fromBlock: "100",
      latestBlock: "1100",
    });
    expect(getDeterministicScoreFloor(derived)).toBe(45);
  });

  it("getDeterministicScoreFloor returns null for errors and invalid scans", async () => {
    const { getDeterministicScoreFloor } = await import("../src/keepers/rater-scoring");
    expect(
      getDeterministicScoreFloor(
        JSON.stringify({ type: "external-error", error: "rpc down" }),
      ),
    ).toBeNull();
    expect(
      getDeterministicScoreFloor(
        JSON.stringify({
          type: "reactivity-lens",
          lookbackBlocks: 100,
          fromBlock: "500",
          latestBlock: "400",
        }),
      ),
    ).toBeNull();
  });

  it("prepareResultForRating includes onchain-lens transfer scan fields", async () => {
    const { prepareResultForRating } = await import("../src/keepers/rater-scoring");
    const raw = JSON.stringify({
      type: "onchain-lens",
      source: "somnia-rpc",
      blockWindow: 50,
      latestBlock: 403893195,
      totalTxSampled: 1200,
      minTransferStt: 1000,
      largeTransferCount: 2,
      largeTransfers: [{ blockNumber: 100, hash: "0xabc", from: "0x1", to: "0x2", valueStt: 1500 }],
      summary: "Sampled 50 blocks; found 2 native transfers >= 1000 STT",
      transferScanNote: "native STT tx.value only; ERC-20 not scanned",
    });
    const prepared = prepareResultForRating(raw);
    expect(prepared).toContain("blockWindow: 50");
    expect(prepared).toContain("largeTransferCount: 2");
    expect(prepared).toContain("minTransferStt: 1000");
    expect(prepared).toContain("native STT");
  });

  it("buildAgentRatingHints includes onchain-lens guidance", async () => {
    const { buildAgentRatingHints } = await import("../src/keepers/rater-scoring");
    const raw = JSON.stringify({ type: "onchain-lens", source: "somnia-rpc" });
    expect(buildAgentRatingHints(raw)).toContain("onchain-lens");
    expect(buildAgentRatingHints(raw)).toContain("Zero matching transfers");
  });

  it("getDeterministicScoreFloor approves valid onchain-lens scans", async () => {
    const { getDeterministicScoreFloor } = await import("../src/keepers/rater-scoring");
    const withTransfers = JSON.stringify({
      type: "onchain-lens",
      blockWindow: 50,
      latestBlock: 403893195,
      minTransferStt: 1000,
      largeTransferCount: 0,
    });
    expect(getDeterministicScoreFloor(withTransfers)).toBe(45);

    const activityOnly = JSON.stringify({
      type: "onchain-lens",
      blockWindow: 20,
      latestBlock: 1000,
      totalTxSampled: 400,
    });
    expect(getDeterministicScoreFloor(activityOnly)).toBe(45);
  });
});

describe("rater keeper", () => {
  it("rewinds the rater cursor when it is ahead of the chain tip", async () => {
    const { createRater } = await loadKeepers();
    const setCursor = vi.fn().mockResolvedValue(undefined);
    const rater = createRater({
      anthropic: { messages: { create: vi.fn() } } as never,
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(150n),
      setCursor,
      getLogs: vi.fn(),
      getStep: vi.fn(),
      isRatingSubmitted: vi.fn(),
      saveSubmittedRating: vi.fn(),
      deleteSubmittedRating: vi.fn(),
      upsertStep: vi.fn(),
      publish: vi.fn(),
      finalizeExternalStep: vi.fn(),
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      startBlock: 50n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    await rater.tick();

    expect(setCursor).toHaveBeenCalledWith("rater", 99n);
  });

  it("finalizes acceptable results and publishes approval", async () => {
    const { createRater } = await loadKeepers();
    const finalizeExternalStep = vi.fn().mockResolvedValue(undefined);
    const upsertStep = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();

    const rater = createRater({
      anthropic: {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: '{"score": 91, "reason": "good"}' }],
          }),
        },
      } as never,
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        { args: { taskId: 8n, stepIdx: 2, result: "0x726573756c74" } },
      ]) as never,
      getStep: vi.fn().mockResolvedValue({ payload: "do analysis" }),
      isRatingSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedRating: vi.fn().mockResolvedValue(undefined),
      deleteSubmittedRating: vi.fn().mockResolvedValue(undefined),
      upsertStep,
      publish,
      finalizeExternalStep,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    await rater.tick();

    expect(finalizeExternalStep).toHaveBeenCalledWith([8n, 2, 91]);
    expect(upsertStep).toHaveBeenCalledWith(
      "8",
      2,
      "0",
      null,
      StepState.Succeeded,
      "do analysis",
      null,
      "0x726573756c74",
      91,
      null,
    );
    expect(publish).toHaveBeenCalledWith(
      "8",
      "step_rated",
      { taskId: "8", stepIdx: 2, score: 91, reason: "good", approved: true },
    );
  });

  it("suppresses retries when finalize reverts", async () => {
    const { createRater } = await loadKeepers();
    const deleteSubmittedRating = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();
    const rater = createRater({
      anthropic: {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: '{"score": 25, "reason": "bad"}' }],
          }),
        },
      } as never,
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        { args: { taskId: 8n, stepIdx: 2, result: "0x726573756c74" } },
      ]) as never,
      getStep: vi.fn().mockResolvedValue({ payload: "do analysis" }),
      isRatingSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedRating: vi.fn().mockResolvedValue(undefined),
      deleteSubmittedRating,
      upsertStep: vi.fn(),
      publish: vi.fn(),
      finalizeExternalStep: vi.fn().mockRejectedValue(new Error("execution reverted")),
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn },
    });

    await rater.tick();

    expect(deleteSubmittedRating).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("falls back to score 0 when scoring output is malformed", async () => {
    const { createRater } = await loadKeepers();
    const finalizeExternalStep = vi.fn().mockResolvedValue(undefined);
    const rater = createRater({
      anthropic: {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "bad-json" }],
          }),
        },
      } as never,
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getCursor: vi.fn().mockResolvedValue(10n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: vi.fn().mockResolvedValue([
        { args: { taskId: 8n, stepIdx: 2, result: "0x726573756c74" } },
      ]) as never,
      getStep: vi.fn().mockResolvedValue({ payload: "do analysis" }),
      isRatingSubmitted: vi.fn().mockResolvedValue(false),
      saveSubmittedRating: vi.fn().mockResolvedValue(undefined),
      deleteSubmittedRating: vi.fn().mockResolvedValue(undefined),
      upsertStep: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
      finalizeExternalStep,
      addresses: { orchestrator: "0x1234567890123456789012345678901234567890" },
      startBlock: 0n,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    await rater.tick();

    expect(finalizeExternalStep).toHaveBeenCalledWith([8n, 2, 0]);
  });
});

describe("consensus indexer", () => {
  it("indexes StepConsensusReached into step consensus fields", async () => {
    const { createIndexer } = await loadKeepers();
    const patchStepConsensus = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const getLogs = vi.fn(async ({ event }: { event: { name?: string } }) => {
      if (event.name === "StepConsensusReached") {
        return [
          {
            args: {
              taskId: 3n,
              stepIdx: 1,
              requestId: 9n,
              validators: 3n,
              receiptId: 100n,
              medianExecutionCost: 50_000_000_000_000_000n,
            },
          },
        ];
      }
      return [];
    });

    const indexer = createIndexer({
      getBlockNumber: vi.fn().mockResolvedValue(50n),
      getCursor: vi.fn().mockResolvedValue(20n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: getLogs as never,
      getTransaction: vi.fn(),
      patchStepConsensus,
      publish,
      addresses: {
        orchestrator: "0x1234567890123456789012345678901234567890",
        agentRegistry: "0x1234567890123456789012345678901234567890",
      },
      startBlock: 0n,
    });

    await indexer.tick();

    expect(patchStepConsensus).toHaveBeenCalledWith("3", 1, {
      validators: 3,
      receiptId: "100",
      medianCostWei: "50000000000000000",
    });
    expect(publish).toHaveBeenCalledWith(
      "3",
      "step_consensus",
      expect.objectContaining({
        taskId: "3",
        stepIdx: 1,
        validators: 3,
      }),
    );
  });
});

describe("trustless indexer", () => {
  it("decodes Janice callback results from Agents API fulfill transactions", async () => {
    const { createIndexer } = await loadKeepers();
    const upsertTrustlessTurn = vi.fn().mockResolvedValue(undefined);
    const patchTrustlessTask = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const resultHex = encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "string[]" },
        { type: "string[]" },
        { type: "string[]" },
        { type: "bytes[]" },
      ],
      ["tool_calls", "Hiring analysis", [], [], [], []],
    );
    const fulfillInput = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "fulfill",
          stateMutability: "nonpayable",
          inputs: [
            { name: "reqId", type: "uint256" },
            { name: "result", type: "bytes" },
          ],
          outputs: [],
        },
      ],
      functionName: "fulfill",
      args: [1n, resultHex],
    });

    const getLogs = vi.fn(async ({ event }: { event: { name?: string } }) => {
      if (event.name === "JaniceIteration") {
        return [
          {
            transactionHash:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            args: {
              taskId: 11n,
              iteration: 1n,
              requestId: 1n,
              finishReason: "tool_calls",
              transcriptHash: "0x" + "11".repeat(32),
            },
          },
        ];
      }
      return [];
    });

    const indexer = createIndexer({
      getBlockNumber: vi.fn().mockResolvedValue(50n),
      getCursor: vi.fn().mockResolvedValue(20n),
      setCursor: vi.fn().mockResolvedValue(undefined),
      getLogs: getLogs as never,
      getTransaction: vi.fn().mockResolvedValue({ input: fulfillInput }),
      getStepsForTask: vi.fn().mockResolvedValue([]),
      deleteTaskArtifactsForTask: vi.fn().mockResolvedValue(undefined),
      upsertTrustlessTurn,
      patchTrustlessTask,
      publish,
      addresses: {
        orchestrator: "0x1234567890123456789012345678901234567890",
        agentRegistry: "0x9999999999999999999999999999999999999999",
      },
      startBlock: 0n,
    });

    await indexer.tick();

    expect(upsertTrustlessTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "11",
        assistantMessage: "Hiring analysis",
      }),
    );
    const stored = upsertTrustlessTurn.mock.calls[0]?.[0] as {
      rawResultHex: `0x${string}` | null;
    };
    expect(stored.rawResultHex).toBe(resultHex);
    expect(decodeTrustlessJaniceResult(resultHex).assistantMessage).toBe(
      "Hiring analysis",
    );
  });
});

describe("trustless resume keeper", () => {
  it("reconstructs a resume payload and submits resumeTrustlessTask", async () => {
    const { createTrustlessResumeKeeper } = await loadKeepers();
    const resumeTrustlessTask = vi.fn().mockResolvedValue(undefined);
    const keeper = createTrustlessResumeKeeper({
      listTrustlessTasksAwaitingJanice: vi.fn().mockResolvedValue([]),
      listTrustlessTasksAwaitingResume: vi.fn().mockResolvedValue([
        {
          task_id: "11",
          goal: "Research X",
          iterations: 1,
          max_iterations: 8,
          awaiting: 2,
        },
      ]),
      listTrustlessTurns: vi.fn().mockResolvedValue([
        {
          iteration: 1,
          request_id: "1",
          finish_reason: "tool_calls",
          assistant_message: "I hired an agent",
          tool_calls_json: JSON.stringify([
            { toolName: "hireSubAgent", args: "0x1234" },
          ]),
          raw_result_hex: null,
          transcript_hash: null,
        },
      ]),
      getStepsForTask: vi.fn().mockResolvedValue([
        {
          step_idx: 0,
          config_id: "6",
          timeout_seconds: 90,
          state: StepState.Succeeded,
          payload: "scrape",
          req_id: null,
          result_hex: "0x6f6b",
          score: 90,
          deadline: null,
        },
      ]),
      readTask: vi.fn().mockResolvedValue([1, 1n, 1, 100n, 10n, 9999999999n, TaskState.Running]),
      readTrustlessContext: vi.fn().mockResolvedValue([
        0n,
        1,
        8,
        TrustlessAwaiting.Resume,
        9999999999n,
        "0x" + "00".repeat(32),
      ]),
      readJaniceCost: vi.fn().mockResolvedValue(123n),
      resumeTrustlessTask,
      logger: console,
    });

    await keeper.tick();

    expect(resumeTrustlessTask).toHaveBeenCalledWith([
      11n,
      expect.stringMatching(/^0x/),
      123n,
    ]);
  });

  it("skips resume submission when on-chain trustless context is not awaiting resume", async () => {
    const { createTrustlessResumeKeeper } = await loadKeepers();
    const resumeTrustlessTask = vi.fn().mockResolvedValue(undefined);
    const keeper = createTrustlessResumeKeeper({
      listTrustlessTasksAwaitingJanice: vi.fn().mockResolvedValue([]),
      listTrustlessTasksAwaitingResume: vi.fn().mockResolvedValue([
        {
          task_id: "11",
          goal: "Research X",
          iterations: 1,
          max_iterations: 8,
          awaiting: TrustlessAwaiting.Resume,
        },
      ]),
      listTrustlessTurns: vi.fn().mockResolvedValue([]),
      getStepsForTask: vi.fn().mockResolvedValue([]),
      readTask: vi.fn().mockResolvedValue([1, 1n, 1, 100n, 10n, 9999999999n, TaskState.Running]),
      readTrustlessContext: vi.fn().mockResolvedValue([
        0n,
        1,
        8,
        TrustlessAwaiting.Janice,
        9999999999n,
        "0x" + "00".repeat(32),
      ]),
      readJaniceCost: vi.fn().mockResolvedValue(123n),
      resumeTrustlessTask,
      logger: console,
    });

    await keeper.tick();

    expect(resumeTrustlessTask).not.toHaveBeenCalled();
  });
});
