import { z } from "zod";
import { loadBaseEnv, type ExternalBaseEnv } from "@twiin/external-kit";

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  BRIEFSMITH_MODEL: z.string().default("claude-3-5-haiku-20241022"),
});

export type BriefsmithEnv = ExternalBaseEnv & z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): BriefsmithEnv {
  const base = loadBaseEnv(source, {
    AGENT_NAME: "briefsmith",
    PORT: 3015,
    AGENT_COST_STT: "0.22",
  });
  return { ...base, ...EnvSchema.parse(source) };
}
