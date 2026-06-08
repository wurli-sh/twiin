import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { buildTwiinDigest, CHAIN_ID } from "@twiin/shared";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { ExternalBaseEnv } from "./env";
import { buildVerificationResult } from "./payload";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deploymentRaw = require("@twiin/shared/deployments/somniaTestnet.json");

const ExecuteBodySchema = z.object({
  taskId: z.string().regex(/^[0-9]+$/),
  stepIdx: z.number().int().min(0).max(255),
  payload: z.string().regex(/^[0-9a-fA-F]*$/),
  reqId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export type ExternalExecuteInput = {
  taskId: string;
  stepIdx: number;
  payloadHex: string;
  reqId: string;
  env: ExternalBaseEnv;
};

export type ExternalServerOptions = {
  env: ExternalBaseEnv;
  capabilityNames: string[];
  execute: (input: ExternalExecuteInput) => Promise<string>;
};

export function createExternalApp(options: ExternalServerOptions): Hono {
  const { env, capabilityNames, execute } = options;
  const account = privateKeyToAccount(env.EXTERNAL_PRIVATE_KEY as `0x${string}`);
  const orchestrator = deploymentRaw.addresses.orchestrator as `0x${string}`;
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      registrant: account.address,
      agentName: env.AGENT_NAME,
      capabilityNames,
      endpoint: env.EXTERNAL_PUBLIC_URL ?? `http://${env.HOST}:${env.PORT}`,
    }),
  );

  app.post("/execute", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = ExecuteBodySchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "invalid request body" }, 400);

    const body = parsed.data;
    if (body.taskId === "0" && body.stepIdx === 0 && body.payload.length === 0) {
      const result = buildVerificationResult(env.AGENT_NAME, body.reqId);
      const digest = buildTwiinDigest({
        chainId: BigInt(CHAIN_ID),
        orchestrator,
        taskId: 0n,
        stepIdx: 0,
        externalRequestId: body.reqId as `0x${string}`,
        result,
      });
      const signature = await account.signMessage({ message: { raw: digest } });
      return c.json({ registrant: account.address, result, signature });
    }

    try {
      const result = await execute({
        taskId: body.taskId,
        stepIdx: body.stepIdx,
        payloadHex: body.payload,
        reqId: body.reqId,
        env,
      });
      const digest = buildTwiinDigest({
        chainId: BigInt(CHAIN_ID),
        orchestrator,
        taskId: BigInt(body.taskId),
        stepIdx: body.stepIdx,
        externalRequestId: body.reqId as `0x${string}`,
        result,
      });
      const signature = await account.signMessage({ message: { raw: digest } });
      return c.json({ registrant: account.address, result, signature });
    } catch (error) {
      console.error(`[${env.AGENT_NAME}] execute failed:`, error);
      return c.json({ error: String(error) }, 502);
    }
  });

  app.onError((err, c) => {
    console.error(`[${env.AGENT_NAME}] unhandled error:`, err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}

export function startExternalServer(app: Hono, env: ExternalBaseEnv): void {
  serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
    console.log(`[${env.AGENT_NAME}] listening on http://${info.address}:${info.port}`);
  });
}
