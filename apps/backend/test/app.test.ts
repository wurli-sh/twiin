import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, hexToString } from "viem";
import {
  AgentOrchestratorAbi,
  JsonApiAgentAbi,
  LlmInferenceAgentAbi,
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

function corroboratedReadAgent(configId: bigint) {
  const id = Number(configId);
  const costs: Record<number, bigint> = {
    1: 100000000000000000n,
    2: 30000000000000000n,
    3: 70000000000000000n,
    4: 70000000000000000n,
  };
  const names: Record<number, string> = {
    1: "web-intel@twiin",
    2: "somnia-oracle@twiin",
    3: "analysis-bot@twiin",
    4: "reporter-bot@twiin",
  };
  return {
    lane: 0,
    isActive: true,
    suspended: false,
    name: names[id] ?? "unused",
    costWei: costs[id] ?? 0n,
  };
}

function anthropicReply(input: string | Record<string, unknown>[]) {
  if (Array.isArray(input)) {
    return {
      content: [
        {
          type: "tool_use",
          name: "submit_plan",
          input: { steps: input },
        },
      ],
    };
  }
  const trimmed = input.trim();
  if (trimmed.startsWith("[")) {
    return {
      content: [
        {
          type: "tool_use",
          name: "submit_plan",
          input: { steps: JSON.parse(trimmed) },
        },
      ],
    };
  }
  return {
    content: [{ type: "text", text: input }],
  };
}

function makeMockCatalog(options: {
  readAgent: (configId: bigint) => Promise<{
    lane: number;
    isActive: boolean;
    suspended: boolean;
    name: string;
    costWei: bigint;
  }>;
  readRequestDeposit?: () => Promise<bigint>;
}) {
  return {
    getAgentsForPlanner: vi.fn().mockResolvedValue([]),
    renderPlannerContext: vi.fn().mockResolvedValue(""),
    loadCandidates: vi.fn().mockImplementation(async () => {
      const deposit = options.readRequestDeposit
        ? await options.readRequestDeposit()
        : 30n;
      const out = [];
      for (let id = 1; id <= 11; id++) {
        const agent = await options.readAgent(BigInt(id));
        if (!agent.name) continue;
        out.push({
          configId: id,
          lane: agent.lane === 0 ? "native" : "external",
          name: agent.name,
          exactCostWei:
            agent.lane === 0 ? deposit + agent.costWei * 3n : agent.costWei,
          capabilities: [],
          capabilityNames: [],
          healthy: agent.isActive && !agent.suspended,
          rank: id,
          isActive: agent.isActive,
          suspended: agent.suspended,
        });
      }
      return out;
    }),
    substitute: vi.fn().mockResolvedValue(null),
    resolveByCapability: vi.fn().mockResolvedValue([]),
    invalidate: vi.fn(),
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
      lastAbortReason: null,
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
          name: configId === 6n ? "docs-lens" : `native-${configId.toString()}`,
          lane: configId === 6n ? 1 : 0,
          capabilities:
            configId === 6n
              ? [
                  "0x211a6f8402f3737c40846db6e3aa0f19dcce37bf9d78695bd89121a2b0c21366",
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
              "0x211a6f8402f3737c40846db6e3aa0f19dcce37bf9d78695bd89121a2b0c21366",
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
          name: "docs-lens",
          lane: "ExternalHTTP",
          endpointUrl: "https://agent.example",
          isVerified: true,
          capabilityNames: ["data.specialized"],
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
        budgetWei: "1000",
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
        budgetWei: "1000",
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid request body",
      code: "INVALID_REQUEST",
    });
  });

  it("redirects disabled web-intel planner steps to docs-lens", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue({
      ...anthropicReply(
        JSON.stringify([
          {
            configId: 1,
            payload: JSON.stringify({
              url: "https://somnia.network",
              prompt: "Extract network metrics",
            }),
            maxCostWei: "0",
            timeoutSeconds: 120,
          },
        ]),
      ),
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const readAgent = vi.fn(async (configId: bigint) => {
      const id = Number(configId);
      if (id === 8) {
        return {
          lane: 1,
          isActive: true,
          suspended: false,
          name: "docs-lens",
          costWei: 150000000000000000n,
        };
      }
      if (id === 1) {
        return {
          lane: 0,
          isActive: true,
          suspended: false,
          name: "web-intel@twiin",
          costWei: 330000000000000000n,
        };
      }
      return { lane: 0, isActive: false, suspended: false, name: "", costWei: 0n };
    });

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(11n),
        readAgent,
        listExternalAgents: vi.fn().mockResolvedValue([]),
        agentCatalog: makeMockCatalog({ readAgent }) as never,
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
        addresses: {
          orchestrator: "0x1234567890123456789012345678901234567890",
        },
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Research Somnia network metrics from the web",
        personalAgentId: "1",
        budgetWei: "3000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      steps: Array<{ configId: number; payload: string }>;
      source: string;
    };
    expect(body.source).toBe("substituted");
    expect(body.steps[0]?.configId).toBe(8);
    expect(JSON.parse(body.steps[0]!.payload)).toEqual({
      question: "Extract network metrics",
      docPath: "readme",
    });
  });

  it("redirects web-intel market intent to dreamdex-mcp coingecko", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue({
      ...anthropicReply(
        JSON.stringify([
          {
            configId: 1,
            payload: JSON.stringify({
              url: "https://api.coingecko.com/api/v3/simple/price?ids=somnia",
              prompt: "Fetch Somnia token price and market cap",
            }),
            maxCostWei: "0",
            timeoutSeconds: 120,
          },
        ]),
      ),
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const readAgent = vi.fn(async (configId: bigint) => {
      const id = Number(configId);
      if (id === 7) {
        return {
          lane: 1,
          isActive: true,
          suspended: false,
          name: "dreamdex-mcp",
          costWei: 180000000000000000n,
        };
      }
      if (id === 1) {
        return {
          lane: 0,
          isActive: true,
          suspended: false,
          name: "web-intel@twiin",
          costWei: 330000000000000000n,
        };
      }
      return { lane: 0, isActive: false, suspended: false, name: "", costWei: 0n };
    });

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(11n),
        readAgent,
        listExternalAgents: vi.fn().mockResolvedValue([]),
        agentCatalog: makeMockCatalog({ readAgent }) as never,
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
        addresses: {
          orchestrator: "0x1234567890123456789012345678901234567890",
        },
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Fetch coingecko market cap data from the web",
        personalAgentId: "1",
        budgetWei: "3000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      steps: Array<{ configId: number; payload: string }>;
    };
    expect(body.steps[0]?.configId).toBe(7);
    expect(JSON.parse(body.steps[0]!.payload)).toEqual({
      action: "coingecko",
      id: "somnia",
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

    const readAgent = vi.fn().mockResolvedValue({
      lane: 0,
      isActive: true,
      suspended: false,
      name: "analysis-bot@twiin",
      costWei: 24n,
    });
    const readRequestDeposit = vi.fn().mockResolvedValue(30n);

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit,
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent,
        listExternalAgents: vi.fn().mockResolvedValue([]),
        agentCatalog: makeMockCatalog({ readAgent, readRequestDeposit }) as never,
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
        budgetWei: "1000",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps).toHaveLength(1);
    expect(body.estimatedCostWei).toBe("102");
    expect(body.steps[0].maxCostWei).toBe("102");
    expect(body.orchestrator).toBe("0x1234567890123456789012345678901234567890");
    expect(savePlanRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        personalAgentId: "1",
        goal: "analyze the feed",
        budgetWei: "1000",
      }),
    );

    const decoded = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    expect(decoded.functionName).toBe("createTask");
    expect(decoded.args?.[0]).toBe(1n);
    expect(decoded.args?.[2]).toBe(1000n);
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

  it("uses a corroborated template for Somnia sentiment goals", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn();
    const savePlanRequest = vi.fn().mockResolvedValue(undefined);

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(10n),
        readAgent: vi.fn(async (configId: bigint) => corroboratedReadAgent(configId)),
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

    const body = (await res.json()) as {
      createTaskCalldata: `0x${string}`;
      verificationTier: string;
    };
    expect(body.verificationTier).toBe("corroborated");

    const createTask = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    const onChainSteps = createTask.args?.[1] ?? [];
    expect(onChainSteps).toHaveLength(3);
    expect(onChainSteps.map((s) => Number(s.subAgentConfigId))).toEqual([2, 3, 4]);

    const apiUrl =
      "https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true";
    const oracleStep = decodeFunctionData({
      abi: JsonApiAgentAbi,
      data: onChainSteps[0].payload as `0x${string}`,
    });
    expect(oracleStep.functionName).toBe("fetchString");
    expect(oracleStep.args?.[0]).toBe(apiUrl);
    expect(oracleStep.args?.[1]).toBe("somnia.usd");

    const analysisStep = decodeFunctionData({
      abi: LlmInferenceAgentAbi,
      data: onChainSteps[1].payload as `0x${string}`,
    });
    expect(analysisStep.functionName).toBe("inferString");
    expect(String(analysisStep.args?.[0])).toContain(
      "Corroborate ONLY prior step JSON oracle/market fields",
    );

    expect(savePlanRequest).toHaveBeenCalledOnce();
  });

  it("falls back to a cheaper single-source template for low-budget Somnia sentiment goals", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn();

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(10n),
        readAgent: vi.fn(async (configId: bigint) => corroboratedReadAgent(configId)),
        listExternalAgents: vi.fn().mockResolvedValue([]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Daily Somnia sentiment oracle",
        personalAgentId: "1",
        budgetWei: "500000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      createTaskCalldata: `0x${string}`;
      verificationTier: string;
      estimatedCostWei: string;
    };
    expect(body.verificationTier).toBe("single");
    expect(body.estimatedCostWei).toBe("360000000000000000");

    const createTask = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    const onChainSteps = createTask.args?.[1] ?? [];
    expect(onChainSteps).toHaveLength(2);
    expect(onChainSteps.map((s) => Number(s.subAgentConfigId))).toEqual([2, 4]);
  });

  it("uses the corroborated template for Somnia ecosystem stats goals", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn();

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(10n),
        readAgent: vi.fn(async (configId: bigint) => corroboratedReadAgent(configId)),
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
    expect(onChainSteps).toHaveLength(3);
    expect(onChainSteps.map((s) => Number(s.subAgentConfigId))).toEqual([2, 3, 4]);
  });

  it("uses the LP risk template for console goals without calling Claude", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn();
    const now = Math.floor(Date.now() / 1000);
    const dataCap = "0x" + "aa".repeat(32);

    const readAgent = vi.fn(async (configId: bigint) => {
      const id = Number(configId);
      const external: Record<
        number,
        { name: string; costWei: bigint; capabilities: readonly `0x${string}`[] }
      > = {
        6: {
          name: "docs-lens",
          costWei: 150000000000000000n,
          capabilities: [dataCap],
        },
        7: {
          name: "dreamdex-mcp",
          costWei: 180000000000000000n,
          capabilities: [dataCap],
        },
        10: {
          name: "briefsmith",
          costWei: 220000000000000000n,
          capabilities: [dataCap],
        },
      };
      if (external[id]) {
        return {
          lane: 1,
          isActive: true,
          suspended: false,
          ...external[id],
        };
      }
      return corroboratedReadAgent(configId);
    });

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(11n),
        readAgent,
        listExternalAgents: vi.fn().mockResolvedValue([
          {
            config_id: "6",
            registrant: "0x1111111111111111111111111111111111111111",
            endpoint_url: "https://docs.example",
            endpoint_hash: "0x" + "11".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
          {
            config_id: "7",
            registrant: "0x2222222222222222222222222222222222222222",
            endpoint_url: "https://dreamdex.example",
            endpoint_hash: "0x" + "22".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
          {
            config_id: "10",
            registrant: "0x3333333333333333333333333333333333333333",
            endpoint_url: "https://brief.example",
            endpoint_hash: "0x" + "33".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
        ]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Assess dreamDEX LP risk for SOMI/USDC liquidity providers",
        personalAgentId: "1",
        budgetWei: "4000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      createTaskCalldata: `0x${string}`;
      verificationTier: string;
      source: string;
    };
    expect(body.source).toBe("template");
    expect(body.verificationTier).toBe("corroborated");

    const createTask = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    const onChainSteps = createTask.args?.[1] ?? [];
    expect(onChainSteps.map((s) => Number(s.subAgentConfigId))).toEqual([
      7, 6, 7, 3, 10,
    ]);
  });

  it("uses the ecosystem health template with dreamdex instead of somnia-oracle", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn();
    const now = Math.floor(Date.now() / 1000);
    const dataCap = "0x" + "aa".repeat(32);

    const readAgent = vi.fn(async (configId: bigint) => {
      const id = Number(configId);
      const external: Record<
        number,
        { name: string; costWei: bigint; capabilities: readonly `0x${string}`[] }
      > = {
        6: {
          name: "docs-lens",
          costWei: 150000000000000000n,
          capabilities: [dataCap],
        },
        7: {
          name: "dreamdex-mcp",
          costWei: 180000000000000000n,
          capabilities: [dataCap],
        },
        10: {
          name: "briefsmith",
          costWei: 220000000000000000n,
          capabilities: [dataCap],
        },
        11: {
          name: "reactivity-lens",
          costWei: 170000000000000000n,
          capabilities: [dataCap],
        },
      };
      if (external[id]) {
        return {
          lane: 1,
          isActive: true,
          suspended: false,
          ...external[id],
        };
      }
      return corroboratedReadAgent(configId);
    });

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(12n),
        readAgent,
        listExternalAgents: vi.fn().mockResolvedValue([
          {
            config_id: "6",
            registrant: "0x1111111111111111111111111111111111111111",
            endpoint_url: "https://docs.example",
            endpoint_hash: "0x" + "11".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
          {
            config_id: "7",
            registrant: "0x2222222222222222222222222222222222222222",
            endpoint_url: "https://dreamdex.example",
            endpoint_hash: "0x" + "22".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
          {
            config_id: "10",
            registrant: "0x3333333333333333333333333333333333333333",
            endpoint_url: "https://brief.example",
            endpoint_hash: "0x" + "33".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
          {
            config_id: "11",
            registrant: "0x4444444444444444444444444444444444444444",
            endpoint_url: "https://reactivity.example",
            endpoint_hash: "0x" + "44".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
        ]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "How healthy is the Somnia ecosystem today?",
        personalAgentId: "1",
        budgetWei: "3000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      createTaskCalldata: `0x${string}`;
      source: string;
      steps: Array<{ configId: number }>;
    };
    expect(body.source).toBe("template");
    expect(body.steps).toHaveLength(5);
    expect(body.steps.map((s) => s.configId)).toEqual([6, 11, 7, 3, 10]);
    expect(body.steps.some((s) => s.configId === 2)).toBe(false);

    const createTask = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    const onChainSteps = createTask.args?.[1] ?? [];
    expect(onChainSteps).toHaveLength(5);
  });

  it("uses the LP risk template when Claude is unavailable for console goals", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockRejectedValue(new Error("planner down"));
    const now = Math.floor(Date.now() / 1000);
    const dataCap = "0x" + "aa".repeat(32);

    const readAgent = vi.fn(async (configId: bigint) => {
      const id = Number(configId);
      const external: Record<
        number,
        { name: string; costWei: bigint; capabilities: readonly `0x${string}`[] }
      > = {
        6: {
          name: "docs-lens",
          costWei: 150000000000000000n,
          capabilities: [dataCap],
        },
        7: {
          name: "dreamdex-mcp",
          costWei: 180000000000000000n,
          capabilities: [dataCap],
        },
        10: {
          name: "briefsmith",
          costWei: 220000000000000000n,
          capabilities: [dataCap],
        },
      };
      if (external[id]) {
        return {
          lane: 1,
          isActive: true,
          suspended: false,
          ...external[id],
        };
      }
      return corroboratedReadAgent(configId);
    });

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit: vi.fn().mockResolvedValue(30000000000000000n),
        readNextConfigId: vi.fn().mockResolvedValue(11n),
        readAgent,
        listExternalAgents: vi.fn().mockResolvedValue([
          {
            config_id: "6",
            registrant: "0x1111111111111111111111111111111111111111",
            endpoint_url: "https://docs.example",
            endpoint_hash: "0x" + "11".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
          {
            config_id: "7",
            registrant: "0x2222222222222222222222222222222222222222",
            endpoint_url: "https://dreamdex.example",
            endpoint_hash: "0x" + "22".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
          {
            config_id: "10",
            registrant: "0x3333333333333333333333333333333333333333",
            endpoint_url: "https://brief.example",
            endpoint_hash: "0x" + "33".repeat(32),
            capabilities: [dataCap],
            is_active: 1,
            is_verified: 1,
            last_verified_at: now,
            last_error: null,
            updated_at: now,
          },
        ]),
        savePlanRequest: vi.fn().mockResolvedValue(undefined),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Assess dreamDEX LP risk for SOMI/USDC liquidity providers",
        personalAgentId: "1",
        budgetWei: "4000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      createTaskCalldata: `0x${string}`;
      source: string;
    };
    expect(body.source).toBe("template");

    const createTask = decodeFunctionData({
      abi: AgentOrchestratorAbi,
      data: body.createTaskCalldata,
    });
    const onChainSteps = createTask.args?.[1] ?? [];
    expect(onChainSteps.map((s) => Number(s.subAgentConfigId))).toEqual([
      7, 6, 7, 3, 10,
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
        readAgent: vi.fn(async (configId: bigint) => corroboratedReadAgent(configId)),
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
    await expect(res.json()).resolves.toMatchObject({
      code: "BUDGET_EXCEEDED",
      error: "planned step costs exceed task budget",
      estimatedCostWei: "240000000000000000",
      budgetWei: "200000000000000000",
      requiredStepCount: 1,
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
    await expect(res.json()).resolves.toMatchObject({
      code: "BUDGET_EXCEEDED",
      error: "planned step costs exceed task budget",
      estimatedCostWei: "180",
      budgetWei: "100",
    });
  });

  it("falls back to template when LLM output is invalid", async () => {
    const { createApp } = await loadApp();
    const create = vi.fn().mockResolvedValue(anthropicReply("not-json"));
    const readAgent = vi.fn(async (configId: bigint) => ({
      lane: 0,
      isActive: true,
      suspended: false,
      name: Number(configId) === 3 ? "analysis-bot@twiin" : "",
      costWei: 70n,
    }));
    const readRequestDeposit = vi.fn().mockResolvedValue(30n);

    const res = await createApp({
      plan: {
        anthropic: { messages: { create } } as never,
        readRequestDeposit,
        readNextConfigId: vi.fn().mockResolvedValue(7n),
        readAgent,
        listExternalAgents: vi.fn().mockResolvedValue([]),
        agentCatalog: makeMockCatalog({ readAgent, readRequestDeposit }) as never,
        savePlanRequest: vi.fn(),
      },
    }).request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "report",
        personalAgentId: "1",
        budgetWei: "1000000000000000000",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("template");
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
        goal: "check third-party sentiment json",
        personalAgentId: "1",
        budgetWei: "1000",
      }),
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
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
        budgetWei: "1000",
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
            payload: "query somnia docs",
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
        readAgent: vi.fn(async (configId: bigint) => {
          if (configId === 6n) {
            return {
              lane: 1,
              isActive: true,
              suspended: false,
              name: "docs-lens",
              costWei: 30n,
              capabilities: [
                "0x211a6f8402f3737c40846db6e3aa0f19dcce37bf9d78695bd89121a2b0c21366",
              ] as const,
            };
          }
          return {
            lane: 0,
            isActive: false,
            suspended: false,
            name: "",
            costWei: 0n,
            capabilities: [] as const,
          };
        }),
        listExternalAgents: vi.fn(async (options?: {
          activeOnly?: boolean;
          verifiedOnly?: boolean;
        }) => {
          if (options?.verifiedOnly) {
            expect(options).toEqual({ activeOnly: true, verifiedOnly: true });
          } else {
            expect(options).toEqual({ activeOnly: true });
          }
          return [
            {
              config_id: "6",
              registrant: "0xabc",
              endpoint_url: "https://docs.example",
              endpoint_hash: "0x" + "44".repeat(32),
              capabilities: [
                "0x211a6f8402f3737c40846db6e3aa0f19dcce37bf9d78695bd89121a2b0c21366",
              ],
              is_active: 1,
              is_verified: 1,
              last_verified_at: Math.floor(Date.now() / 1000),
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
        goal: "query Somnia official docs for validator architecture",
        personalAgentId: "1",
        budgetWei: "1000",
      }),
    });

    expect(res.status).toBe(200);
    const [{ system }] = create.mock.calls[0] ?? [];
    expect(system).toContain("docs-lens");
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
        budgetWei: "1000",
      }),
    });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: "PLANNER_UNAVAILABLE",
    });
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
          lane: 0,
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
          budgetWei: "100",
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
        budgetWei: "100",
      }),
    });

    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({
      error: "rate limit exceeded, try again in 60s",
      code: "RATE_LIMITED",
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
          lane: 0,
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
        budgetWei: "100",
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
        budgetWei: "100",
      }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
