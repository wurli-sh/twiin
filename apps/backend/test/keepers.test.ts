import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTwiinDigest, StepState, TaskState } from "@twiin/shared";
import AgentOrchestratorAbi from "@twiin/shared/abis/AgentOrchestrator.json";
import TwiinAccountAbi from "@twiin/shared/abis/TwiinAccount.json";
import { encodeFunctionData } from "viem";
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
    { createExternalAgentBootstrap },
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
    createTrustlessResumeKeeper,
  };
}

const externalAgentAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
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
      deleteStepsForTask: vi.fn().mockResolvedValue(undefined),
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

    expect(setCursor).toHaveBeenCalledWith("indexer", 50n);
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
      deleteStepsForTask: vi.fn().mockResolvedValue(undefined),
      finalizeTaskSteps,
      getExternalAgent: vi.fn().mockResolvedValue(null),
      upsertExternalAgent,
      deactivateExternalAgent: vi.fn().mockResolvedValue(undefined),
      upsertTask,
      upsertStep,
      updateTaskState,
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
      deleteStepsForTask: vi.fn().mockResolvedValue(undefined),
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
    });

    await relay.tick();

    expect(setCursor).toHaveBeenCalledWith("relay", 50n);
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
      getStep: vi.fn().mockResolvedValue({ state: StepState.RunningExternal }),
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
    });

    await relay.tick();

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
      getStep: vi.fn().mockResolvedValue({ state: StepState.RunningExternal }),
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
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: "analysis complete",
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
    });

    await relay.tick();

    expect(submitExternalResult).not.toHaveBeenCalled();
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

    expect(setCursor).toHaveBeenCalledWith("rater", 50n);
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
      { taskId: "8", stepIdx: 2, score: 91, approved: true },
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

describe("trustless resume keeper", () => {
  it("reconstructs a resume payload and submits resumeTrustlessTask", async () => {
    const { createTrustlessResumeKeeper } = await loadKeepers();
    const resumeTrustlessTask = vi.fn().mockResolvedValue(undefined);
    const keeper = createTrustlessResumeKeeper({
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
});
