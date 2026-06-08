import { z } from "zod";
import { loadBaseEnv, type ExternalBaseEnv } from "@twiin/external-kit";

const EnvSchema = z.object({
  SOMNIA_RPC_URL: z.string().url().optional(),
});

export type ReactivityLensEnv = ExternalBaseEnv & z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ReactivityLensEnv {
  const base = loadBaseEnv(source, {
    AGENT_NAME: "reactivity-lens",
    PORT: 3016,
    AGENT_COST_STT: "0.17",
  });
  return { ...base, ...EnvSchema.parse(source) };
}
