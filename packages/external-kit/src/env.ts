import { parseEther } from "viem";
import { z } from "zod";

const PrivateKeyFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return `0x${trimmed}`;
  return trimmed;
}, z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x-prefixed 32-byte hex"));

const BaseEnvSchema = z.object({
  EXTERNAL_PRIVATE_KEY: PrivateKeyFromEnv,
  SOMNIA_RPC_URL: z
    .string()
    .url()
    .optional()
    .default("https://dream-rpc.somnia.network/"),
  HOST: z.string().min(1).optional().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().optional().default(3010),
  EXTERNAL_PUBLIC_URL: z.string().url().optional(),
  AGENT_NAME: z.string().min(1).max(32),
  AGENT_COST_STT: z.string().optional().default("0.15"),
  REGISTRATION_DEPOSIT_STT: z.string().optional().default("5"),
});

export type ExternalBaseEnv = z.infer<typeof BaseEnvSchema> & {
  AGENT_COST_WEI: bigint;
  REGISTRATION_DEPOSIT_WEI: bigint;
};

function renderDefaults(source: NodeJS.ProcessEnv): Partial<z.infer<typeof BaseEnvSchema>> {
  if (!source.RENDER) return {};
  return {
    HOST: "0.0.0.0",
    ...(source.RENDER_EXTERNAL_URL && !source.EXTERNAL_PUBLIC_URL
      ? { EXTERNAL_PUBLIC_URL: source.RENDER_EXTERNAL_URL }
      : {}),
  };
}

export function loadBaseEnv(
  source: NodeJS.ProcessEnv = process.env,
  defaults?: Partial<z.infer<typeof BaseEnvSchema>>,
): ExternalBaseEnv {
  const parsed = BaseEnvSchema.parse({
    ...renderDefaults(source),
    ...defaults,
    ...source,
  });
  return {
    ...parsed,
    AGENT_COST_WEI: parseEther(parsed.AGENT_COST_STT),
    REGISTRATION_DEPOSIT_WEI: parseEther(parsed.REGISTRATION_DEPOSIT_STT),
  };
}
