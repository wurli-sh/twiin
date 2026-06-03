import { afterEach, describe, expect, it, vi } from "vitest";

const baseEnv = {
  ANTHROPIC_API_KEY: "test-key",
  KEEPER_PRIVATE_KEY:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  TURSO_DB_URL: "file:./test.db",
};

async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    vi.stubEnv(key, value);
  }
  return import("../src/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env", () => {
  it("normalizes keeper keys missing the 0x prefix", async () => {
    const { env } = await loadEnv({
      KEEPER_PRIVATE_KEY:
        "2222222222222222222222222222222222222222222222222222222222222222",
    });

    expect(env.KEEPER_PRIVATE_KEY).toBe(
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );
  });

  it("rejects malformed keeper keys", async () => {
    await expect(
      loadEnv({
        KEEPER_PRIVATE_KEY: "not-a-key",
      }),
    ).rejects.toThrow(/32-byte hex/);
  });
});
