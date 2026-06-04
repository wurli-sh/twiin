import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, hexToString } from "viem";
import { AgentOrchestratorAbi, PlanMode, TaskState } from "@twiin/shared";

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
      agents: [
        expect.objectContaining({
          config_id: "6",
          capabilityNames: ["web.scrape.discord"],
        }),
      ],
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
    expect(body.estimatedCostWei).toBe("30");
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
    expect(hexToString(decoded.args?.[1][0].payload as `0x${string}`)).toBe(
      "analyze previous results",
    );
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
      estimatedCostWei: "150",
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
        readAgent: vi.fn(async (configId: bigint) => ({
          isActive: true,
          suspended: false,
          name: configId === 6n ? "discord-bot@twiin" : "bad-bot@twiin",
          costWei: 30n,
        })),
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
