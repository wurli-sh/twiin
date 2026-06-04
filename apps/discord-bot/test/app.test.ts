import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { DiscordBotEnv } from "../src/env";

const testEnv: DiscordBotEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 3010,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:3010",
  AGENT_NAME: "discord-bot@twiin",
  AGENT_COST_STT: "0.15",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 150000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
};

describe("discord bot app", () => {
  it("returns a health payload with registrant", async () => {
    const res = await createApp({ env: testEnv }).request("/health");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      agentName: "discord-bot@twiin",
      capabilityNames: ["web.scrape.discord"],
    });
  });

  it("returns a signed mock scrape result", async () => {
    const res = await createApp({ env: testEnv }).request("/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "12",
        stepIdx: 0,
        payload: Buffer.from("check ecosystem health in discord").toString("hex"),
        reqId: "0x" + "12".repeat(32),
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      registrant: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      result: expect.stringContaining("discord-scrape"),
      signature: expect.stringMatching(/^0x[0-9a-fA-F]+$/),
    });
  });
});
