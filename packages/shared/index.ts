export * from "./constants";
export * from "./digest";
export * from "./twiin-account";

// ABIs — populated by `pnpm copy-abis` (requires contracts to be compiled first)
export * from "./abis/index";

// Addresses
import { z } from "zod";

const AddrField = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid address");

export const AddressesSchema = z.object({
  chainId: z.string(),
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

export type Addresses = {
  [K in keyof z.infer<typeof AddressesSchema>]: K extends "chainId"
    ? string
    : `0x${string}`;
};

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
