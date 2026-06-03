import { z } from "zod";

const BoolFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const KeeperKeyFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return `0x${trimmed}`;
  }
  return trimmed;
}, z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x-prefixed 32-byte hex"));

const EnvSchema = z
  .object({
    KEEPER_PRIVATE_KEY: KeeperKeyFromEnv,
    ANTHROPIC_API_KEY: z.string().min(1),
    SOMNIA_RPC_URL: z
      .string()
      .url()
      .optional()
      .default("https://dream-rpc.somnia.network/"),
    PORT: z.coerce.number().int().positive().optional().default(3001),
    TURSO_DB_URL: z.string().min(1).default("file:./twiin.db"),
    TURSO_AUTH_TOKEN: z.string().optional().default(""),
    START_BLOCK: z.coerce.bigint().optional().default(0n),
    PLAN_SECRET: z.string().optional(),
    TRUST_PROXY: BoolFromEnv.optional().default(false),
    RUN_KEEPERS: BoolFromEnv.optional().default(true),
  })
  .refine(
    (v) =>
      !v.TURSO_DB_URL.startsWith("libsql://") ||
      (v.TURSO_AUTH_TOKEN ?? "") !== "",
    {
      message:
        "TURSO_AUTH_TOKEN is required when TURSO_DB_URL is a remote libsql:// URL",
    },
  );

export type Env = z.infer<typeof EnvSchema>;

export const env = EnvSchema.parse(process.env);
