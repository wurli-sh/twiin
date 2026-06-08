import { z } from "zod";
import { loadBaseEnv, type ExternalBaseEnv } from "@twiin/external-kit";

const EnvSchema = z.object({
  DREAMDEX_MCP_URL: z.string().url().optional().or(z.literal("")),
});

export type DreamdexEnv = ExternalBaseEnv & z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): DreamdexEnv {
  const base = loadBaseEnv(source, {
    AGENT_NAME: "dreamdex-mcp",
    PORT: 3012,
    AGENT_COST_STT: "0.20",
  });
  return { ...base, ...EnvSchema.parse(source) };
}
