import { z } from "zod";
import { loadBaseEnv, type ExternalBaseEnv } from "@twiin/external-kit";

const EnvSchema = z.object({
  RECEIPTS_BASE_URL: z.string().url().optional(),
});

export type ReceiptAuditorEnv = ExternalBaseEnv & z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ReceiptAuditorEnv {
  const base = loadBaseEnv(source, {
    AGENT_NAME: "receipt-auditor",
    PORT: 3014,
    AGENT_COST_STT: "0.14",
  });
  return { ...base, ...EnvSchema.parse(source) };
}
