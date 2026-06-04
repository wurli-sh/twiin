export * from "./constants";
export * from "./digest";
export * from "./twiin-account";
export * from "./somnia-agents";

// ABIs — populated by `pnpm copy-abis` (requires contracts to be compiled first)
export * from "./abis/index";

// Addresses
import { z } from "zod";

const AddrField = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid address");
const Bytes32Field = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32");
const NumericString = z.string().regex(/^[0-9]+$/, "must be a numeric string");

export const AddressesSchema = z.object({
  _note: z.string().optional(),
  chainId: NumericString,
  registry6551: AddrField,
  twiinAgent: AddrField,
  twiinAccountImpl: AddrField,
  twiinNames: AddrField,
  agentRegistry: AddrField,
  vault: AddrField,
  policy: AddrField,
  oracleFeed: AddrField,
  orchestrator: AddrField,
  factory: AddrField,
  mUSDC: AddrField,
  mockRouter: AddrField,
});

export const DeploymentManifestSchema = z.object({
  _note: z.string(),
  network: z.string().min(1),
  chainId: NumericString,
  startBlock: NumericString,
  deployer: AddrField,
  keeper: AddrField,
  agentsApi: AddrField,
  deployedAt: z.string().min(1),
  addresses: AddressesSchema,
  txHashes: z.record(z.string(), z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
  capabilities: z.array(
    z.object({
      id: Bytes32Field,
      name: z.string().min(1),
      minTrustTier: z.number().int().nonnegative(),
      nativeOnly: z.boolean(),
    }),
  ),
  nativeAgents: z.array(
    z.object({
      configId: z.number().int().nonnegative(),
      name: z.string().min(1),
      somniaId: NumericString,
      costWei: NumericString,
      capabilities: z.array(Bytes32Field),
      trustTier: z.number().int().nonnegative(),
    }),
  ),
  reservedNames: z.array(z.string().min(1)),
});

type ParsedAddresses = z.infer<typeof AddressesSchema>;

export type Addresses = Omit<ParsedAddresses, "_note"> & {
  chainId: string;
  registry6551: `0x${string}`;
  twiinAgent: `0x${string}`;
  twiinAccountImpl: `0x${string}`;
  twiinNames: `0x${string}`;
  agentRegistry: `0x${string}`;
  vault: `0x${string}`;
  policy: `0x${string}`;
  oracleFeed: `0x${string}`;
  orchestrator: `0x${string}`;
  factory: `0x${string}`;
  mUSDC: `0x${string}`;
  mockRouter: `0x${string}`;
};

export type DeploymentManifest = z.infer<typeof DeploymentManifestSchema>;

/**
 * Validates and returns typed contract addresses.
 * Pass the imported addresses.json as the argument.
 *
 * Backend:  import raw from '../shared/addresses.json'; const addrs = loadAddresses(raw);
 * Frontend: import raw from '@twiin/shared/addresses.json'; const addrs = loadAddresses(raw);
 */
export function loadAddresses(raw: unknown): Addresses {
  return AddressesSchema.parse(raw) as Addresses;
}

export function loadDeploymentManifest(raw: unknown): DeploymentManifest {
  return DeploymentManifestSchema.parse(raw);
}
