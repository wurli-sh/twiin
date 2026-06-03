import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const baseEnv = {
  ANTHROPIC_API_KEY: "test-key",
  KEEPER_PRIVATE_KEY:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
};

async function loadDb(dbUrl: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(baseEnv)) vi.stubEnv(key, value);
  vi.stubEnv("TURSO_DB_URL", dbUrl);
  return import("../src/db");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("db bootstrap", () => {
  it("creates schema and supports plan/step queries on a fresh database", async () => {
    const dbPath = `/tmp/twiin-backend-${randomUUID()}.db`;
    const { ensureSchema, getStepsForTask, savePlanRequest } = await loadDb(
      `file:${dbPath}`,
    );

    await ensureSchema();
    await savePlanRequest("1", "smoke", "[]", "100");

    await expect(getStepsForTask("1")).resolves.toEqual([]);
  });
});
