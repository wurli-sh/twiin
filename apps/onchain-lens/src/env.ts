import { z } from "zod";
import { loadBaseEnv, type ExternalBaseEnv } from "@twiin/external-kit";

const EnvSchema = z.object({
  SOMNIA_RPC_URL: z.string().url().optional(),
});

export type OnchainLensEnv = ExternalBaseEnv & z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): OnchainLensEnv {
  const base = loadBaseEnv(source, {
    AGENT_NAME: "onchain-lens",
    PORT: 3013,
    AGENT_COST_STT: "0.16",
  });
  return { ...base, ...EnvSchema.parse(source) };
}
