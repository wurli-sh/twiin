type ErrorWithCause = {
  message?: string;
  shortMessage?: string;
  details?: string;
  code?: string;
  hostname?: string;
  cause?: unknown;
};

function collectErrorChain(error: unknown): ErrorWithCause[] {
  const chain: ErrorWithCause[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current as ErrorWithCause);
    current = (current as ErrorWithCause).cause;
  }

  return chain;
}

export function isUpstreamAvailabilityError(error: unknown): boolean {
  const joined = collectErrorChain(error)
    .flatMap((entry) => [
      entry.message,
      entry.shortMessage,
      entry.details,
      entry.code,
      entry.hostname,
    ])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    joined.includes("eai_again") ||
    joined.includes("enotfound") ||
    joined.includes("getaddrinfo") ||
    joined.includes("fetch failed") ||
    joined.includes("httprequesterror") ||
    joined.includes("turso.io") ||
    joined.includes("dream-rpc.somnia.network")
  );
}

export function upstreamUnavailableMessage(error: unknown): string {
  if (!isUpstreamAvailabilityError(error)) return "internal server error";
  return "upstream unavailable";
}
