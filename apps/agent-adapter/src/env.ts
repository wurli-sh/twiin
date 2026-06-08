import { z } from "zod";
import { loadBaseEnv, type ExternalBaseEnv } from "@twiin/external-kit";

const EnvSchema = z.object({
  UPSTREAM_URL: z.string().url().optional(),
});

export type AgentAdapterEnv = ExternalBaseEnv & z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AgentAdapterEnv {
  const base = loadBaseEnv(source, {
    AGENT_NAME: "agent-adapter",
    PORT: 8790,
    AGENT_COST_STT: "0.20",
  });
  return { ...base, ...EnvSchema.parse(source) };
}
