import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, hexToString } from "viem";
import {
  AgentOrchestratorAbi,
  JsonApiAgentAbi,
  LlmInferenceAgentAbi,
  ParseWebsiteAgentAbi,
  PlanMode,
  TaskState,
} from "@twiin/shared";

const baseEnv = {
  ANTHROPIC_API_KEY: "test-key",
  KEEPER_PRIVATE_KEY:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  TURSO_DB_URL: "file:./test.db",
  RUN_KEEPERS: "false",
};

async function loadApp(envOverrides: Record<string, string> = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({ ...baseEnv, ...envOverrides })) {
    vi.stubEnv(key, value);
  }
  return import("../src/app");
}

function anthropicReply(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("app routes", () => {
  it("returns health payload", async () => {
    const { createApp } = await loadApp();
    const res = await createApp().request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("rejects invalid task ids before touching the chain", async () => {
    const { createApp } = await loadApp();
    const app = createApp();

    await expect(app.request("/api/tasks/not-a-number")).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      app.request("/api/stream/not-a-number"),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("returns an empty step list when the DB has no entries", async () => {
    const { createApp } = await loadApp();
    const res = await createApp({
      tasks: {
        getStepsForTask: vi.fn().mockResolvedValue([]),
      },
    }).request("/api/tasks/1/steps");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ taskId: "1", steps: [] });
  });

  it("returns task details with bigint fields serialized", async () => {
    const { createApp } = await loadApp();
    const res = await createApp({
      tasks: {
        readTask: vi
          .fn()
          .mockResolvedValue([0, 99n, 1, 1000n, 200n, 777n, TaskState.Completed]),
      },
    }).request("/api/tasks/42");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      taskId: "42",
      mode: 0,
      personalAgentId: "99",
      cursor: 1,
      budgetWei: "1000",
      spentWei: "200",
      deadline: "777",
      state: TaskState.Completed,
      stateName: "Completed",
    });
  });

  it("returns completion for completed tasks", async () => {
    const { createApp } = await loadApp();
    const res = await createApp({
      tasks: {
        readTask: vi
          .fn()
          .mockResolvedValue([0, 1n, 1, 750n, 120n, 0n, TaskState.Completed]),
        fetchTaskCompletion: vi.fn().mockResolvedValue({
          result: "\u00fd\u0012\u00fd",
          decoded: "12915400",
          blockNumber: "400226997",
          transactionHash: "0x9f3cd5510d822f927aee3a9d5cfbc2dfd6b9d278b6444d98930ed6022f321f41",
        }),
      },
    }).request("/api/tasks/2/completion");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      taskId: "2",
      decoded: "12915400",
      blockNumber: "400226997",
    });
  });

  it("returns 404 when task chain lookup fails", async () => {
    const { createApp } = await loadApp();
    const res = await createApp({
      tasks: {
        readTask: vi.fn().mockRejectedValue(new Error("missing")),
      },
    }).request("/api/tasks/42");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "task not found" });
  });

  it("returns SSE headers for valid stream subscriptions", async () => {
    const { createApp } = await loadApp();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": ok\n\n"));
        controller.close();
      },
    });

    const res = await createApp({
      stream: {
        makeSseStream: vi.fn().mockReturnValue(stream),
      },
    }).request("/api/stream/7");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe(": ok\n\n");
  });

  it("passes Last-Event-ID through to the stream layer", async () => {
    const { createApp } = await loadApp();
    const makeSseStream = vi.fn().mockReturnValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    );

    const res = await createApp({
      stream: { makeSseStream },
    }).request("/api/stream/7", {
      headers: { "last-event-id": "12" },
    });

    expect(res.status).toBe(200);
    expect(makeSseStream).toHaveBeenCalledWith(expect.anything(), "7", "12");
  });

  it("lists external agents with capability names", async () => {
    const { createApp } = await loadApp();
    const res = await createApp({
      agents: {
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent: vi.fn(async (configId: bigint) => ({
          name: configId === 6n ? "discord-bot@twiin" : `native-${configId.toString()}`,
          lane: configId === 6n ? 1 : 0,
          capabilities:
            configId === 6n
              ? [
                  "0xb9b830727b491d4493f6986755ce6f95e5b98aaeaadf5155bee13031e8a96670",
                ]
              : [],
          costWei: 123n,
          eloScore: 1200n,
          isActive: true,
          tasksCompleted: 2n,
          tasksFailed: 1n,
          avgLatencyMs: 45n,
          trustTier: 1,
          somniaAgentId: configId === 6n ? 0n : 99n,
          registrant: "0xabc",
          endpointHash: ("0x" + "44".repeat(32)) as `0x${string}`,
          depositWei: 5000000000000000000n,
          suspended: false,
        })),
        listExternalAgents: vi.fn().mockResolvedValue([
          {
            config_id: "6",
            registrant: "0xabc",
            endpoint_url: "https://agent.example",
            endpoint_hash: "0x" + "44".repeat(32),
            capabilities: [
              "0xb9b830727b491d4493f6986755ce6f95e5b98aaeaadf5155bee13031e8a96670",
            ],
            is_active: 1,
            is_verified: 1,
            last_verified_at: 123,
            last_error: null,
            updated_at: 456,
          },
        ]),
      },
    }).request("/api/agents");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      agents: expect.arrayContaining([
        expect.objectContaining({
          configId: 6,
          name: "discord-bot@twiin",
          lane: "ExternalHTTP",
          endpointUrl: "https://agent.example",
          isVerified: true,
          capabilityNames: ["web.scrape.discord"],
        }),
      ]),
    });
  });

  it("rejects unauthorized planner calls when PLAN_SECRET is configured", async () => {
    const { createApp } = await loadApp({ PLAN_SECRET: "secret" });

    const res = await createApp().request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "ping",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("rejects invalid planner request bodies before calling Anthropic", async () => {
    const { createApp } = await loadApp();

    const res = await createApp().request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid request body" });
  });

  it("hides trustless preflight when the feature flag is disabled", async () => {
    const { createApp } = await loadApp();
    const res = await createApp().request("/api/trustless-preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Ship it",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "trustless mode disabled" });
  });

  it("returns trustless create calldata after preflight", async () => {
    const { createApp } = await loadApp({ ENABLE_TRUSTLESS_JANICE: "true" });
    const res = await createApp({
      trustlessPreflight: {
        orchestrator: "0x1234567890123456789012345678901234567890",
        readJaniceAgent: vi.fn().mockResolvedValue({
          isActive: true,
          suspended: false,
          costWei: 70n,
        }),
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
      },
    }).request("/api/trustless-preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Finish the task",
        personalAgentId: "1",
        budgetWei: "2000",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orchestrator).toBe("0x1234567890123456789012345678901234567890");
    expect(body.minBudgetWei).toBe("480");
    const decoded = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    expect(decoded.functionName).toBe("createTrustlessTask");
    expect(decoded.args?.[0]).toBe(1n);
    expect(decoded.args?.[2]).toBe(2000n);
  });

  it("rejects underfunded Somnia stats trustless goals using the oracle-flow estimate", async () => {
    const { createApp } = await loadApp({ ENABLE_TRUSTLESS_JANICE: "true" });
    const res = await createApp({
      trustlessPreflight: {
        readJaniceAgent: vi.fn().mockResolvedValue({
          isActive: true,
          suspended: false,
          costWei: 70n,
        }),
        readAgent: vi.fn(async (configId: bigint) => ({
          name: configId === 2n ? "somnia-oracle@twiin" : "unused",
          costWei: configId === 2n ? 30n : 0n,
          isActive: true,
          suspended: false,
        })),
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
      },
    }).request("/api/trustless-preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Fetch Somnia ecosystem stats: price, 24h change, market cap, and 24h volume",
        personalAgentId: "1",
        budgetWei: "1000",
      }),
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "trustless budget below minimum",
      minBudgetWei: "1680",
      recommendedBudgetWei: "1680",
      janiceCostWei: "240",
    });
  });

  it("returns planned calldata for a valid planner response", async () => {
    const { createApp } = await loadApp();
    const savePlanRequest = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(
      {
        ...anthropicReply(
        JSON.stringify([
          {
            configId: 3,
            payload: "analyze previous results",
            maxCostWei: "30",
            timeoutSeconds: 90,
          },
        ]),
        ),
        usage: { input_tokens: 1000, output_tokens: 100 },
      },
    );

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent: vi.fn().mockResolvedValue({
          lane: 1,
          isActive: true,
          suspended: false,
          name: "analysis-bot@twiin",
          costWei: 24n,
        }),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest,
        addresses: {
          orchestrator: "0x1234567890123456789012345678901234567890",
        },
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "analyze the feed",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps).toHaveLength(1);
    expect(body.estimatedCostWei).toBe("24");
    expect(body.steps[0].maxCostWei).toBe("24");
    expect(body.orchestrator).toBe("0x1234567890123456789012345678901234567890");
    expect(savePlanRequest).toHaveBeenCalledWith(
      "1",
      "analyze the feed",
      JSON.stringify(body.steps),
      "100",
    );

    const decoded = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    expect(decoded.functionName).toBe("createTask");
    expect(decoded.args?.[0]).toBe(1n);
    expect(decoded.args?.[2]).toBe(100n);
    expect(decoded.args?.[3]).toBe(PlanMode.ClaudePlan);
    expect(hexToString(decoded.args?.[1][0].payload as `0x${string}`)).toContain(
      "analyze previous results",
    );
    expect(hexToString(decoded.args?.[1][0].payload as `0x${string}`)).toContain(
      "Do not invent or assume the current date",
    );
  });

  it("hardens analysis/reporter prompts against fabricated dates and values", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue({
      ...anthropicReply(
        JSON.stringify([
          {
            configId: 3,
            payload: "Analyze previous results and score sentiment.",
            maxCostWei: "1",
            timeoutSeconds: 120,
          },
          {
            configId: 4,
            payload: "Write a report with a date and current price.",
            maxCostWei: "1",
            timeoutSeconds: 120,
          },
        ]),
      ),
      usage: { input_tokens: 1000, output_tokens: 100 },
    });

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(0n),
        readNextConfigId: vi.fn().mockResolvedValue(10n),
        readAgent: vi.fn(async (configId: bigint) => ({
          lane: 0,
          isActive: true,
          suspended: false,
          name: configId === 3n ? "analysis-bot@twiin" : "reporter-bot@twiin",
          costWei: 1n,
        })),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Produce a market brief from previous results",
        personalAgentId: "1",
        budgetWei: "1000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { createTaskCalldata: `0x${string}` };
    const createTask = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    const onChainSteps = createTask.args?.[1] ?? [];
    const decodedPayloads = onChainSteps.map((step) => {
      const decodedStep = decodeFunctionData({
        abi: LlmInferenceAgentAbi,
        data: step.payload as `0x${string}`,
      });
      return String(decodedStep.args?.[0] ?? "");
    });
    expect(decodedPayloads[0]).toContain("Use only facts present in previous step outputs");
    expect(decodedPayloads[0]).toContain("Do not invent or assume the current date");
    expect(decodedPayloads[1]).toContain('write "unavailable" instead of guessing');
    expect(decodedPayloads[1]).toContain("Do not fabricate prices");
  });

  it("uses a deterministic somnia-oracle template for Somnia sentiment goals", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn();
    const savePlanRequest = vi.fn().mockResolvedValue(undefined);

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(10n),
        readAgent: vi.fn(async (configId: bigint) => ({
          lane: 0,
          isActive: true,
          suspended: false,
          name: configId === 2n ? "somnia-oracle@twiin" : "unused",
          costWei: configId === 2n ? 30000000000000000n : 0n,
        })),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest,
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Daily Somnia sentiment oracle",
        personalAgentId: "1",
        budgetWei: "3000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();

    const body = (await res.json()) as { createTaskCalldata: `0x${string}` };
    const createTask = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    const onChainSteps = createTask.args?.[1] ?? [];
    expect(onChainSteps).toHaveLength(4);

    const apiUrl =
      "https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true";

    const decodedSteps = onChainSteps.map((step) =>
      decodeFunctionData({
        abi: JsonApiAgentAbi,
        data: step.payload as `0x${string}`,
      }),
    );
    expect(decodedSteps.map((d) => d.args?.[0])).toEqual([
      apiUrl,
      apiUrl,
      apiUrl,
      apiUrl,
    ]);
    expect(decodedSteps[0].functionName).toBe("fetchUint");
    expect(decodedSteps[0].args?.[1]).toBe("somnia.usd");
    expect(decodedSteps[0].args?.[2]).toBe(8);
    expect(decodedSteps[1].functionName).toBe("fetchString");
    expect(decodedSteps[1].args?.[1]).toBe("somnia.usd_24h_change");
    expect(decodedSteps[2].functionName).toBe("fetchUint");
    expect(decodedSteps[2].args?.[1]).toBe("somnia.usd_market_cap");
    expect(decodedSteps[3].functionName).toBe("fetchUint");
    expect(decodedSteps[3].args?.[1]).toBe("somnia.usd_24h_vol");
    expect(savePlanRequest).toHaveBeenCalledOnce();
  });

  it("uses the deterministic somnia-oracle template for Somnia ecosystem stats goals", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn();

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(10n),
        readAgent: vi.fn(async (configId: bigint) => ({
          lane: 0,
          isActive: true,
          suspended: false,
          name: configId === 2n ? "somnia-oracle@twiin" : "unused",
          costWei: configId === 2n ? 30000000000000000n : 0n,
        })),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Fetch current Somnia ecosystem stats using the oracle, including price, 24h change, market cap, and 24h volume",
        personalAgentId: "1",
        budgetWei: "3000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();

    const body = (await res.json()) as { createTaskCalldata: `0x${string}` };
    const createTask = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    const onChainSteps = createTask.args?.[1] ?? [];
    expect(onChainSteps).toHaveLength(4);

    const decodedSteps = onChainSteps.map((step) =>
      decodeFunctionData({
        abi: JsonApiAgentAbi,
        data: step.payload as `0x${string}`,
      }),
    );
    expect(decodedSteps.map((d) => d.functionName)).toEqual([
      "fetchUint",
      "fetchString",
      "fetchUint",
      "fetchUint",
    ]);
    expect(decodedSteps.map((d) => d.args?.[1])).toEqual([
      "somnia.usd",
      "somnia.usd_24h_change",
      "somnia.usd_market_cap",
      "somnia.usd_24h_vol",
    ]);
  });

  it("rejects Somnia sentiment goals when the budget cannot support the oracle flow", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn();

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(10n),
        readAgent: vi.fn(async (configId: bigint) => ({
          lane: 0,
          isActive: true,
          suspended: false,
          name: configId === 2n ? "somnia-oracle@twiin" : "unused",
          costWei: configId === 2n ? 30000000000000000n : 0n,
        })),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Daily Somnia sentiment oracle",
        personalAgentId: "1",
        budgetWei: "200000000000000000",
      }),
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "somnia sentiment oracle requires a higher budget",
      estimatedCostWei: "480000000000000000",
      budgetWei: "200000000000000000",
      requiredStepCount: 4,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects over-budget planner output", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue(
      anthropicReply(
        JSON.stringify([
          {
            configId: 4,
            payload: "write report",
            maxCostWei: "150",
            timeoutSeconds: 120,
          },
        ]),
      ),
    );

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent: vi.fn().mockResolvedValue({
          lane: 0,
          isActive: true,
          suspended: false,
          name: "reporter-bot@twiin",
          costWei: 50n,
        }),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn(),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "report",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "planned step costs exceed task budget",
      estimatedCostWei: "180",
      budgetWei: "100",
    });
  });

  it("returns planner failure when LLM output is invalid", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue(anthropicReply("not-json"));

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn(),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "report",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "planner failed" });
  });

  it("rejects planner output with invalid somnia-oracle payloads before createTask", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue(
      anthropicReply(
        JSON.stringify([
          {
            configId: 2,
            payload: "Daily Somnia sentiment oracle",
            maxCostWei: "30",
            timeoutSeconds: 90,
          },
        ]),
      ),
    );

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent: vi.fn().mockResolvedValue({
          lane: 0,
          isActive: true,
          suspended: false,
          name: "somnia-oracle@twiin",
          costWei: 20n,
        }),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn(),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "daily sentiment oracle",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error:
        'somnia-oracle payload must be JSON: {"url":"https://…","selector":"dot.path"} or add "decimals":8 for prices',
    });
  });

  it("accepts planner output with valid somnia-oracle payloads", async () => {
    const { createApp } = await loadApp();
    const savePlanRequest = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(
      anthropicReply(
        JSON.stringify([
          {
            configId: 2,
            payload:
              '{"url":"https://api.example.com/feed","path":"data.sentiment"}',
            maxCostWei: "30",
            timeoutSeconds: 90,
          },
        ]),
      ),
    );

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent: vi.fn().mockResolvedValue({
          lane: 0,
          isActive: true,
          suspended: false,
          name: "somnia-oracle@twiin",
          costWei: 20n,
        }),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest,
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "fetch sentiment feed",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps).toHaveLength(1);
    expect(body.estimatedCostWei).toBe("90");
    expect(savePlanRequest).toHaveBeenCalledOnce();
  });

  it("includes only verified external agents in planner context", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue(
      anthropicReply(
        JSON.stringify([
          {
            configId: 6,
            payload: "scrape discord",
            maxCostWei: "30",
            timeoutSeconds: 90,
          },
        ]),
      ),
    );

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent: vi.fn(async (configId: bigint) => ({
          lane: configId === 6n ? 1 : 0,
          isActive: true,
          suspended: false,
          name: configId === 6n ? "discord-bot@twiin" : "bad-bot@twiin",
          costWei: 30n,
        })),
        listExternalAgents: vi.fn(async (options?: {
          activeOnly?: boolean;
          verifiedOnly?: boolean;
        }) => {
          expect(options).toEqual({ activeOnly: true, verifiedOnly: true });
          return [
            {
              config_id: "6",
              registrant: "0xabc",
              endpoint_url: "https://discord.example",
              endpoint_hash: "0x" + "44".repeat(32),
              capabilities: [
                "0xb9b830727b491d4493f6986755ce6f95e5b98aaeaadf5155bee13031e8a96670",
              ],
              is_active: 1,
              is_verified: 1,
              last_verified_at: 1,
              last_error: null,
              updated_at: 1,
            },
          ];
        }),
        savePlanRequest: vi.fn(),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "find ecosystem health chatter in Discord",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(200);
    const [{ system }] = create.mock.calls[0] ?? [];
    expect(system).toContain("discord-bot@twiin");
    expect(system).toContain("web.scrape.discord");
    expect(system).not.toContain("bad-bot@twiin");
  });

  it("hard-stops planner calls when the Anthropic budget guard blocks", async () => {
    const { createApp } = await loadApp();
    const res = await createApp({
      plan: {
        anthropic: { messages: { create: vi.fn() } } as never,
        readRequestDeposit: vi.fn(),
        readNextConfigId: vi.fn(),
        readAgent: vi.fn(),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn(),
        plannerBudgetGuard: {
          ensureRequestAllowed: vi.fn(() => {
            throw new Error("budget stop");
          }),
          recordUsage: vi.fn(),
          noteFailure: vi.fn(),
        },
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "analyze the feed",
        personalAgentId: "1",
        budgetWei: "100",
      }),
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "planner failed" });
  });

  it("enforces planner rate limiting", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue(
      anthropicReply(
        JSON.stringify([
          {
            configId: 3,
            payload: "do work",
            maxCostWei: "1",
            timeoutSeconds: 60,
          },
        ]),
      ),
    );
    const app = createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent: vi.fn().mockResolvedValue({
          lane: 1,
          isActive: true,
          suspended: false,
          name: "analysis-bot@twiin",
          costWei: 1n,
        }),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    });

    for (let i = 0; i < 10; i++) {
      const res = await app.request("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: `goal-${i}`,
          personalAgentId: "1",
          budgetWei: "10",
        }),
      });
      expect(res.status).toBe(200);
    }

    const blocked = await app.request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "goal-11",
        personalAgentId: "1",
        budgetWei: "10",
      }),
    });

    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({
      error: "rate limit exceeded, try again in 60s",
    });
  });

  it("trusts x-forwarded-for when proxy mode is enabled", async () => {
    const { createApp } = await loadApp({ TRUST_PROXY: "true" });
    const create = vi.fn().mockResolvedValue(
      anthropicReply(
        JSON.stringify([
          {
            configId: 3,
            payload: "do work",
            maxCostWei: "1",
            timeoutSeconds: 60,
          },
        ]),
      ),
    );
    const app = createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30n),
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent: vi.fn().mockResolvedValue({
          lane: 1,
          isActive: true,
          suspended: false,
          name: "analysis-bot@twiin",
          costWei: 1n,
        }),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    });

    const first = await app.request("/api/plan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.1.1.1",
      },
      body: JSON.stringify({
        goal: "goal-a",
        personalAgentId: "1",
        budgetWei: "10",
      }),
    });
    const second = await app.request("/api/plan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "2.2.2.2",
      },
      body: JSON.stringify({
        goal: "goal-b",
        personalAgentId: "1",
        budgetWei: "10",
      }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
