import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  keccak256,
} from "viem";
import type { Address, Hex } from "viem";
import { CHAIN_ID, TWIIN_6551_SALT } from "./constants";

// ERC-1167 minimal proxy bytecode fragments — copied verbatim from ERC6551Registry.sol
// Layout: header(20) | impl(20) | trailer(15) | abi.encode(salt,chainId,tokenContract,tokenId)(128)
const PROXY_HEADER = "0x3d60ad80600a3d3981f3363d3d373d3d3d363d73" as Hex;
const PROXY_TRAILER = "0x5af43d82803e903d91602b57fd5bf3" as Hex;

export interface DeriveTwiinAccountParams {
  registry6551: Address;
  twiinAccountImpl: Address;
  twiinAgent: Address;
  tokenId: bigint;
  chainId?: bigint;
  salt?: Hex;
}

/**
 * Derives the deterministic ERC-6551 TBA address for a given agent NFT.
 *
 * Mirrors ERC6551Registry.account() — CREATE2 with the raw salt (bytes32(0)),
 * not a hash of the footer. The footer is encoded into the initCode bytecode.
 */
export function deriveTwiinAccountAddress(
  p: DeriveTwiinAccountParams,
): Address {
  const salt = p.salt ?? TWIIN_6551_SALT;
  const chainId = p.chainId ?? BigInt(CHAIN_ID);

  // abi.encode(salt, chainId, tokenContract, tokenId) — 4 × 32 bytes = 128 bytes
  const footer = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint256" },
    ],
    [salt, chainId, p.twiinAgent, p.tokenId],
  );

  const initCode = concat([
    PROXY_HEADER,
    p.twiinAccountImpl,
    PROXY_TRAILER,
    footer,
  ]);

  return getContractAddress({
    opcode: "CREATE2",
    from: p.registry6551,
    salt: salt as Hex,
    bytecodeHash: keccak256(initCode),
  });
}
