import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.doMock("../src/db", () => ({
      getStepsForTask: vi.fn().mockResolvedValue([]),
      savePlanRequest: vi.fn(),
    }));

    const { createApp } = await loadApp();
    const res = await createApp().request("/api/tasks/1/steps");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ taskId: "1", steps: [] });
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
});
