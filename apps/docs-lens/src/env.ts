import { z } from "zod";
import { loadBaseEnv, type ExternalBaseEnv } from "@twiin/external-kit";

const EnvSchema = z.object({
  DOCS_BASE_URL: z.string().url().optional(),
});

export type DocsLensEnv = ExternalBaseEnv & z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): DocsLensEnv {
  const base = loadBaseEnv(source, {
    AGENT_NAME: "docs-lens",
    PORT: 3011,
    AGENT_COST_STT: "0.15",
  });
  return { ...base, ...EnvSchema.parse(source) };
}
