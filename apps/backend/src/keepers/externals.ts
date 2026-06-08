import { parseAbiItem, type AbiEvent } from "viem";
import { publicClient } from "../clients";
import { addresses, defaultStartBlock } from "../contracts";
import {
  deactivateExternalAgent,
  getCursor,
  getExternalAgent,
  listExternalAgents,
  setCursor,
  upsertExternalAgent,
} from "../db";
import { env } from "../env";
import { verifyExternalAgentCacheEntry } from "./relay";

const CHUNK = 500n;
const EXTERNAL_REGISTRY_CURSOR = "externals-registry";
const FAST_FORWARD_LAG = 10_000n;
const FAST_FORWARD_TAIL = 500n;
const STARTUP_VERIFY_INTERVAL_MS = 5_000;
const STARTUP_VERIFY_MAX_ATTEMPTS = 24;
const UNVERIFIED_REFRESH_MS = 30_000;

const externalAgentRegisteredEvent = parseAbiItem(
  "event ExternalAgentRegistered(uint256 indexed configId, address indexed registrant, string endpointUrl, bytes32 endpointHash, bytes32[] caps, uint256 costWei)",
) as AbiEvent;
const externalEndpointUpdatedEvent = parseAbiItem(
  "event ExternalEndpointUpdated(uint256 indexed configId, string newUrl, bytes32 newHash)",
) as AbiEvent;
const externalDeregisteredEvent = parseAbiItem(
  "event ExternalDeregistered(uint256 indexed configId, address indexed registrant)",
) as AbiEvent;

type RegistryLogArgs = Record<
  string,
  bigint | string | `0x${string}` | `0x${string}`[] | null | undefined
>;

type ExternalBootstrapDeps = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<Array<{ args: RegistryLogArgs }>>;
  addresses: { agentRegistry: `0x${string}` };
  startBlock: bigint;
  getExternalAgent: typeof getExternalAgent;
  upsertExternalAgent: typeof upsertExternalAgent;
  deactivateExternalAgent: typeof deactivateExternalAgent;
  listExternalAgents: typeof listExternalAgents;
  getCursor: typeof getCursor;
  setCursor: typeof setCursor;
  verifyExternalAgent: typeof verifyExternalAgentCacheEntry;
  sleep: (ms: number) => Promise<void>;
  startupVerifyIntervalMs: number;
  startupVerifyMaxAttempts: number;
  logger: Pick<Console, "log" | "warn" | "error">;
};

export type ExternalVerificationSummary = {
  total: number;
  verified: number;
  failed: number;
};

export async function verifyExternalAgentsNow(
  overrides: Partial<ExternalBootstrapDeps> = {},
): Promise<ExternalVerificationSummary> {
  const deps = createExternalDeps(overrides);
  return runStartupVerification(deps);
}

function createExternalDeps(
  overrides: Partial<ExternalBootstrapDeps> = {},
): ExternalBootstrapDeps {
  return {
    getBlockNumber: () => publicClient.getBlockNumber(),
    getLogs: (args) =>
      publicClient.getLogs(args) as Promise<Array<{ args: RegistryLogArgs }>>,
    addresses: { agentRegistry: addresses.agentRegistry },
    startBlock: env.START_BLOCK ?? defaultStartBlock,
    getExternalAgent,
    upsertExternalAgent,
    deactivateExternalAgent,
    listExternalAgents,
    getCursor,
    setCursor,
    verifyExternalAgent: verifyExternalAgentCacheEntry,
    sleep,
    startupVerifyIntervalMs: STARTUP_VERIFY_INTERVAL_MS,
    startupVerifyMaxAttempts: STARTUP_VERIFY_MAX_ATTEMPTS,
    logger: console,
    ...overrides,
  };
}

export function createExternalAgentBootstrap(
  overrides: Partial<ExternalBootstrapDeps> = {},
) {
  const deps = createExternalDeps(overrides);

  return {
    async run(): Promise<ExternalVerificationSummary> {
      deps.logger.log("[externals] verifying external agents from cache...");
      const summary = await runStartupVerification(deps);

      void syncRegistryFromChain(deps)
        .then(async () => {
          deps.logger.log("[externals] registry sync complete, re-checking agents...");
          const after = await runStartupVerification(deps);
          deps.logger.log(
            `[externals] post-sync verification: ${after.verified}/${after.total} verified`,
          );
        })
        .catch((error) => {
          deps.logger.error("[externals] registry sync failed:", error);
        });

      return summary;
    },
  };
}

export function startExternalHealthRefresh(
  overrides: Partial<ExternalBootstrapDeps> = {},
): void {
  const deps = createExternalDeps(overrides);

  const tickUnverified = async () => {
    try {
      await verifyPendingExternalAgents(deps, "health refresh");
    } catch (error) {
      deps.logger.error("[externals] health refresh error:", error);
    }
  };

  void tickUnverified();
  setInterval(() => {
    void tickUnverified();
  }, UNVERIFIED_REFRESH_MS);
}

async function runStartupVerification(
  deps: ExternalBootstrapDeps,
): Promise<ExternalVerificationSummary> {
  for (let attempt = 1; attempt <= deps.startupVerifyMaxAttempts; attempt++) {
    const activeAgents = await deps.listExternalAgents({ activeOnly: true });
    const pending = activeAgents.filter((agent) => agent.is_verified !== 1);

    if (pending.length === 0) {
      deps.logger.log(
        `[externals] startup verification complete: ${activeAgents.length}/${activeAgents.length} verified`,
      );
      return {
        total: activeAgents.length,
        verified: activeAgents.length,
        failed: 0,
      };
    }

    deps.logger.log(
      `[externals] verifying ${pending.length} external agent(s) at startup (attempt ${attempt}/${deps.startupVerifyMaxAttempts})`,
    );

    await verifyPendingExternalAgents(deps, "startup");

    const remaining = (await deps.listExternalAgents({ activeOnly: true })).filter(
      (agent) => agent.is_verified !== 1,
    );
    if (remaining.length === 0) {
      deps.logger.log(
        `[externals] startup verification complete: ${activeAgents.length}/${activeAgents.length} verified`,
      );
      return {
        total: activeAgents.length,
        verified: activeAgents.length,
        failed: 0,
      };
    }

    if (attempt < deps.startupVerifyMaxAttempts) {
      await deps.sleep(deps.startupVerifyIntervalMs);
    }
  }

  const activeAgents = await deps.listExternalAgents({ activeOnly: true });
  const remaining = activeAgents.filter((agent) => agent.is_verified !== 1);
  deps.logger.warn(
    `[externals] startup verification incomplete: ${remaining.length}/${activeAgents.length} still unverified`,
  );

  return {
    total: activeAgents.length,
    verified: activeAgents.length - remaining.length,
    failed: remaining.length,
  };
}

async function verifyPendingExternalAgents(
  deps: ExternalBootstrapDeps,
  context: "startup" | "health refresh",
): Promise<void> {
  const activeAgents = await deps.listExternalAgents({ activeOnly: true });
  const pending = activeAgents.filter((agent) => agent.is_verified !== 1);

  for (const agent of pending) {
    const ok = await deps.verifyExternalAgent(agent.config_id);
    if (ok) {
      deps.logger.log(
        `[externals] verified config=${agent.config_id} ${agent.endpoint_url}`,
      );
      continue;
    }

    const row = await deps.getExternalAgent(agent.config_id);
    deps.logger.warn(
      `[externals] ${context} verify failed config=${agent.config_id} ${agent.endpoint_url} error=${row?.last_error ?? "unknown"}`,
    );
  }
}

async function syncRegistryFromChain(deps: ExternalBootstrapDeps): Promise<void> {
  deps.logger.log("[externals] syncing registry from chain...");
  const latest = await deps.getBlockNumber();
  const stored = await deps.getCursor(EXTERNAL_REGISTRY_CURSOR);
  let from =
    stored === 0n && deps.startBlock > 0n ? deps.startBlock : stored;
  if (from === 0n) from = deps.startBlock;

  const lag = latest > from ? latest - from : 0n;
  if (lag > FAST_FORWARD_LAG) {
    const fastForwardTo =
      latest > FAST_FORWARD_TAIL ? latest - FAST_FORWARD_TAIL : 0n;
    if (fastForwardTo > from) {
      deps.logger.warn(
        `[externals] registry lag ${lag} blocks; fast-forwarding cursor to ${fastForwardTo}`,
      );
      from = fastForwardTo;
    }
  }

  while (from <= latest) {
    const to = from + CHUNK < latest ? from + CHUNK : latest;
    await processRange(deps, from, to);
    await deps.setCursor(EXTERNAL_REGISTRY_CURSOR, to + 1n);
    from = to + 1n;
  }
}

async function processRange(
  deps: ExternalBootstrapDeps,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<void> {
  const load = (event: AbiEvent) =>
    deps.getLogs({
      address: deps.addresses.agentRegistry,
      event,
      fromBlock,
      toBlock,
    });

  for (const log of await load(externalAgentRegisteredEvent)) {
    const { configId, registrant, endpointUrl, endpointHash, caps } = log.args;
    if (
      configId == null ||
      registrant == null ||
      typeof endpointUrl !== "string" ||
      endpointHash == null
    ) {
      continue;
    }
    await deps.upsertExternalAgent(
      configId.toString(),
      registrant.toString(),
      endpointUrl,
      endpointHash.toString(),
      normalizeCapabilities(caps),
    );
  }

  for (const log of await load(externalEndpointUpdatedEvent)) {
    const { configId, newUrl, newHash } = log.args;
    if (configId == null || typeof newUrl !== "string" || newHash == null) {
      continue;
    }
    const agent = await deps.getExternalAgent(configId.toString());
    if (!agent) continue;
    await deps.upsertExternalAgent(
      configId.toString(),
      agent.registrant,
      newUrl,
      newHash.toString(),
      agent.capabilities,
    );
  }

  for (const log of await load(externalDeregisteredEvent)) {
    const { configId } = log.args;
    if (configId == null) continue;
    await deps.deactivateExternalAgent(configId.toString());
  }
}

function normalizeCapabilities(
  caps: `0x${string}`[] | bigint | string | `0x${string}` | null | undefined,
): string[] {
  return Array.isArray(caps)
    ? caps.filter((value): value is `0x${string}` => typeof value === "string")
    : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
