import { Hono } from "hono";
import { buildTwiinDigest, CHAIN_ID } from "@twiin/shared";
import { privateKeyToAccount } from "viem/accounts";
import { hexToString, isHex, toHex } from "viem";
import { z } from "zod";
import { loadEnv, type DiscordBotEnv } from "./env";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deploymentRaw = require("@twiin/shared/deployments/somniaTestnet.json");

const ExecuteBodySchema = z.object({
  taskId: z.string().regex(/^[0-9]+$/),
  stepIdx: z.number().int().min(0).max(255),
  payload: z.string().regex(/^[0-9a-fA-F]*$/),
  reqId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export type DiscordBotAppDeps = {
  env?: DiscordBotEnv;
};

export function createApp(deps: DiscordBotAppDeps = {}): Hono {
  const runtimeEnv = deps.env ?? loadEnv();
  const account = privateKeyToAccount(runtimeEnv.EXTERNAL_PRIVATE_KEY as `0x${string}`);
  const orchestrator = deploymentRaw.addresses.orchestrator as `0x${string}`;
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      registrant: account.address,
      agentName: runtimeEnv.AGENT_NAME,
      capabilityNames: ["web.scrape.discord"],
      endpoint: runtimeEnv.EXTERNAL_PUBLIC_URL ?? `http://127.0.0.1:${runtimeEnv.PORT}`,
    }),
  );

  app.post("/execute", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = ExecuteBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "invalid request body" }, 400);
    }

    const body = parsed.data;
    const result = buildMockResult(runtimeEnv, body.taskId, body.stepIdx, body.payload, body.reqId);
    const digest = buildTwiinDigest({
      chainId: BigInt(CHAIN_ID),
      orchestrator,
      taskId: BigInt(body.taskId),
      stepIdx: body.stepIdx,
      externalRequestId: body.reqId as `0x${string}`,
      result,
    });
    const signature = await account.signMessage({ message: { raw: digest } });

    return c.json({
      registrant: account.address,
      result,
      signature,
    });
  });

  app.onError((err, c) => {
    console.error("[discord-bot] unhandled error:", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}

function buildMockResult(
  runtimeEnv: DiscordBotEnv,
  taskId: string,
  stepIdx: number,
  payloadHex: string,
  reqId: string,
): string {
  const prompt = decodePayload(payloadHex);
  const now = new Date().toISOString();

  if (taskId === "0" && stepIdx === 0 && payloadHex.length === 0) {
    return JSON.stringify({
      type: "verification",
      agentName: runtimeEnv.AGENT_NAME,
      reqId,
      ts: now,
    });
  }

  return JSON.stringify({
    type: "discord-scrape",
    agentName: runtimeEnv.AGENT_NAME,
    capability: "web.scrape.discord",
    source: "mock",
    prompt,
    reqId,
    ts: now,
    guild: "Twiin Demo Guild",
    channel: "#ecosystem-health",
    findings: [
      "Somnia community discussing validator uptime and new game launches.",
      "Two threads reference oracle freshness and agent routing quality.",
      "Sentiment appears constructive with moderate launch-week noise.",
    ],
    messages: [
      {
        author: "alice",
        excerpt: "Validator latency looks stable after the latest patch.",
      },
      {
        author: "bob",
        excerpt: "Need a cleaner feed for ecosystem health scoring.",
      },
      {
        author: "carol",
        excerpt: "Discord chatter is useful context before posting oracle updates.",
      },
    ],
  });
}

function decodePayload(payloadHex: string): string {
  if (payloadHex.length === 0) return "";
  const normalized = `0x${payloadHex}`;
  if (!isHex(normalized)) return payloadHex;
  try {
    return hexToString(normalized as `0x${string}`);
  } catch {
    return toHex(normalized as `0x${string}`);
  }
}
