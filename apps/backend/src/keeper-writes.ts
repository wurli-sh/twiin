/**
 * Serializes on-chain keeper writes and retries transient nonce collisions.
 * Relay, rater, and timeouts all share one keeper EOA.
 */
let writeChain: Promise<unknown> = Promise.resolve();

const NONCE_RETRIES = 5;
const NONCE_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isNonceCollisionError(error: unknown): boolean {
  const message = String(error);
  return message.includes("nonce too low") || message.includes("Nonce provided");
}

async function withNonceRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < NONCE_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isNonceCollisionError(error) || attempt >= NONCE_RETRIES - 1) {
        throw error;
      }
      await sleep(NONCE_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError ?? new Error("exhausted nonce retries");
}

export function enqueueKeeperWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(() => withNonceRetry(fn));
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
