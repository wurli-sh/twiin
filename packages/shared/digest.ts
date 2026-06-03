import { encodePacked, isHex, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

export interface TwiinDigestParams {
  chainId: bigint;
  orchestrator: Hex;
  taskId: bigint;
  stepIdx: number; // uint8
  externalRequestId: Hex; // bytes32
  result: Hex | Uint8Array | string; // raw result payload
}

/**
 * Returns the 32-byte inner digest for an external result.
 *
 * Matches AgentOrchestrator.submitExternalResult on-chain:
 *   keccak256(abi.encodePacked("\x19Twiin External Result v1\n",
 *     chainId, orchestrator, taskId, stepIdx, externalRequestId, keccak256(result)))
 *
 * Sign with: walletClient.signMessage({ account, message: { raw: buildTwiinDigest(p) } })
 * Recover with: recoverMessageAddress({ message: { raw: digest }, signature })
 */
export function buildTwiinDigest(p: TwiinDigestParams): Hex {
  const resultBytes =
    p.result instanceof Uint8Array
      ? p.result
      : isHex(p.result)
        ? p.result
        : toBytes(p.result);

  const resultHash = keccak256(resultBytes);

  return keccak256(
    encodePacked(
      [
        "string",
        "uint256",
        "address",
        "uint256",
        "uint8",
        "bytes32",
        "bytes32",
      ],
      [
        "\x19Twiin External Result v1\n",
        p.chainId,
        p.orchestrator,
        p.taskId,
        p.stepIdx,
        p.externalRequestId,
        resultHash,
      ],
    ),
  );
}
