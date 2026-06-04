import type { PublicClient } from 'viem'

/** Narrow wrapper — bypasses viem EIP-7702 readContract typing noise. */
export async function readContract<T>(
  client: PublicClient,
  params: Record<string, unknown>,
): Promise<T> {
  return client.readContract(params as never) as Promise<T>
}
